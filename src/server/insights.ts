import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import {
  batchRequest,
  marketBrief,
  OUTPUT_SCHEMA,
  readAnswer,
  statLines,
  SYSTEM_PROMPT,
  type BriefPlayer,
  type Market,
  type PlayerInsight,
} from "@/lib/insights";
import { matchPlayers, parseStatsFiles, type PlayerStats } from "@/lib/stats-import";
import { POOL_LABEL, type Player, type Pool, type PoolConfig, type Team, type TeamPoolLimit } from "@/lib/types";
import { registrationSettings } from "./registration";

export const AI_MODEL = "claude-opus-5-5";
/**
 * Players per request: small enough to finish inside a 60 s function. The
 * admin page asks for fewer if a request still runs out of time.
 */
export const BATCH_SIZE = 4;
/** Give up on the AI before the platform stops the function. */
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 50_000;

export class InsightError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ---------------------------------------------------------------------------
// Importing stats
// ---------------------------------------------------------------------------

const MAX_FILE = 20 * 1024 * 1024;
const WANTED = /(all_players\.json|ppl[\s_-]*\d+[\s_-]*(batting|bowling|fielding|mvp)[^/]*\.csv)$/i;

/** The relevant text files from an upload: a zip of the export, or the files themselves. */
export function filesFromUpload(uploads: { name: string; data: Uint8Array }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const u of uploads) {
    if (/\.zip$/i.test(u.name)) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(u.data, {
          filter: (f) =>
            WANTED.test(f.name) && !/(^|\/)(__MACOSX\/|\._)/.test(f.name) && f.originalSize <= MAX_FILE && (f.compression === 0 || f.compression === 8),
        });
      } catch {
        throw new InsightError(400, "bad_zip", `${u.name} couldn't be opened as a zip file`);
      }
      for (const [name, data] of Object.entries(entries)) out[name] = strFromU8(data);
    } else if (WANTED.test(u.name)) {
      out[u.name] = strFromU8(u.data);
    }
  }
  return out;
}

export interface ImportReport {
  matched: number;
  seasons: number[];
  /** Names in the file with no auction player of that name/id. */
  unmatched: string[];
  /** Auction players (pool or unsold) with no stats in the file. */
  withoutStats: string[];
  warnings: string[];
}

export async function importStats(db: SupabaseClient, files: Record<string, string>): Promise<ImportReport> {
  const parsed = parseStatsFiles(files);
  if (!parsed.players.length) {
    throw new InsightError(400, "no_players", parsed.warnings[0] ?? "No players found in the upload");
  }
  const { data: players, error } = await db.from("players").select("id, name, pool, status");
  if (error) throw new InsightError(500, "db_error", "Could not load players");
  const { matched, unmatched } = matchPlayers(parsed.players, players as { id: string; name: string; pool: string }[]);
  if (matched.length) {
    const now = new Date().toISOString();
    const rows = matched.map(({ player, record }) => ({
      player_id: player.id,
      stats: record.stats,
      cricheroes_url: record.cricheroesUrl?.slice(0, 300) ?? null,
      imported_at: now,
    }));
    const { error: upsertError } = await db.from("player_insights").upsert(rows, { onConflict: "player_id" });
    if (upsertError) {
      console.error("Saving stats failed", upsertError);
      throw new InsightError(500, "db_error", "Could not save the stats");
    }
  }
  const got = new Set(matched.map((m) => m.player.id));
  const withoutStats = (players as { id: string; name: string; status: string }[])
    .filter((p) => (p.status === "pool" || p.status === "unsold") && !got.has(p.id))
    .map((p) => p.name)
    .sort();
  return { matched: matched.length, seasons: parsed.seasons, unmatched: unmatched.map((u) => u.name), withoutStats, warnings: parsed.warnings };
}

// ---------------------------------------------------------------------------
// Generating notes
// ---------------------------------------------------------------------------

interface InsightRow {
  player_id: string;
  stats: PlayerStats | Record<string, never>;
  cricheroes_url: string | null;
  summary: string | null;
  strengths: string[];
  concerns: string[];
  role_fit: string | null;
  tier: PlayerInsight["tier"];
  price_floor: number | null;
  price_fair: number | null;
  price_stretch: number | null;
  confidence: PlayerInsight["confidence"];
  generated_at: string | null;
}

const hasStats = (s: InsightRow["stats"] | undefined): s is PlayerStats => !!s && "seasons" in s;

async function poolContext(db: SupabaseClient, pool: Pool) {
  const [players, teams, cfg, limits, insights, settings] = await Promise.all([
    db.from("players").select("*").eq("pool", pool).order("name"),
    db.from("teams").select("*").order("sort_order").order("name"),
    db.from("pool_config").select("*").eq("pool", pool).single(),
    db.from("team_pool_limits").select("*").eq("pool", pool),
    db.from("player_insights").select("*"),
    registrationSettings(db),
  ]);
  const failed = [players, teams, cfg, limits, insights].find((r) => r.error);
  if (failed?.error) throw new InsightError(500, "db_error", "Could not load the auction data");
  const all = players.data as Player[];
  const config = cfg.data as PoolConfig;
  const market: Market = {
    pool,
    poolLabel: POOL_LABEL[pool],
    teams: (teams.data as Team[]).map((t) => {
      const lim = (limits.data as TeamPoolLimit[]).find((l) => l.team_id === t.id);
      const mine = all.filter((p) => p.status === "sold" && p.sold_team_id === t.id);
      return {
        name: t.name,
        purseLeft: (lim?.purse ?? config.purse) - mine.reduce((s, p) => s + (p.sold_price ?? 0), 0),
        bought: mine.filter((p) => !p.signing).length,
        minSquad: lim?.min_squad ?? config.min_squad,
        maxSquad: lim?.max_squad ?? config.max_squad,
      };
    }),
    basePrices: { A: config.base_price_a, B: config.base_price_b, C: config.base_price_c },
    sold: all.filter((p) => p.status === "sold" && !p.signing).map((p) => ({ name: p.name, price: p.sold_price ?? 0 })),
  };
  const rows = new Map((insights.data as InsightRow[]).map((r) => [r.player_id, r]));
  const available = all.filter((p) => p.status === "pool" || p.status === "unsold");
  const brief: BriefPlayer[] = available.map((p, i) => ({
    ref: `P${String(i + 1).padStart(2, "0")}`,
    id: p.id,
    name: p.name,
    role: p.role,
    battingStyle: p.batting_style,
    bowlingStyle: p.bowling_style,
    grade: p.grade,
    basePrice: p.base_price,
    details: p.details ?? [],
    notes: p.notes,
    stats: (() => {
      const s = rows.get(p.id)?.stats;
      return hasStats(s) ? s : null;
    })(),
  }));
  return { market, brief, rows, matchDays: settings.availability_options.length };
}

function client(): Anthropic {
  // One attempt per request: the admin page retries, and a function has 60 s.
  return new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
}

function friendly(e: unknown): InsightError {
  if (e instanceof InsightError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new InsightError(502, "ai_key_rejected", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.");
  }
  if (e instanceof Anthropic.RateLimitError) return new InsightError(429, "ai_busy", "The AI is rate-limited right now. Try again in a minute.");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new InsightError(504, "ai_timeout", "The AI took too long. Try again.");
  if (e instanceof Anthropic.APIConnectionError) return new InsightError(502, "ai_unreachable", "Couldn't reach the AI service. Try again.");
  if (e instanceof Anthropic.InternalServerError) return new InsightError(503, "ai_busy", "The AI service is busy. Try again shortly.");
  if (e instanceof Anthropic.BadRequestError) {
    console.error("AI request rejected", e.message);
    return new InsightError(502, "ai_rejected", "The AI service rejected the request.");
  }
  if (e instanceof Anthropic.APIError) {
    console.error("AI error", e.status, e.message);
    return new InsightError(502, "ai_error", `The AI service returned an error (${e.status ?? "unknown"}).`);
  }
  console.error("Generating insights failed", e);
  return new InsightError(500, "internal", "Generating notes failed.");
}

export interface BatchResult {
  generated: number;
  remaining: number;
  total: number;
}

/** Writes notes for the next few players in the pool that don't have any yet. */
export async function generateBatch(db: SupabaseClient, pool: Pool, size = BATCH_SIZE): Promise<BatchResult> {
  if (!aiConfigured()) throw new InsightError(503, "ai_not_configured", "Add ANTHROPIC_API_KEY in Vercel to turn on AI suggestions.");
  const ctx = await poolContext(db, pool);
  const pending = ctx.brief.filter((p) => !ctx.rows.get(p.id)?.generated_at);
  if (!pending.length) return { generated: 0, remaining: 0, total: ctx.brief.length };
  const batch = pending.slice(0, Math.min(Math.max(size, 1), BATCH_SIZE));
  const priced = ctx.brief
    .map((p) => ({ name: p.name, fair: ctx.rows.get(p.id)?.price_fair ?? null }))
    .filter((p): p is { name: string; fair: number } => p.fair !== null);
  const largestPurse = Math.max(0, ...ctx.market.teams.map((t) => t.purseLeft));

  let text: string;
  try {
    const response = await client().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            // Identical for every batch of a pool, so later batches read it from the cache.
            { type: "text", text: marketBrief(ctx.market, ctx.brief, ctx.matchDays), cache_control: { type: "ephemeral" } },
            { type: "text", text: batchRequest(batch, priced) },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new InsightError(502, "ai_refused", "The AI declined to answer. Try again.");
    if (response.stop_reason === "max_tokens") throw new InsightError(502, "ai_too_long", "The AI's answer was cut off. Try again.");
    text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  } catch (e) {
    throw friendly(e);
  }

  let generated;
  try {
    generated = readAnswer(text, batch, largestPurse);
  } catch (e) {
    console.error("Unreadable AI answer", e instanceof Error ? e.message : e);
    throw new InsightError(502, "ai_unreadable", "The AI's answer couldn't be read. Try again.");
  }
  if (!generated.length) throw new InsightError(502, "ai_empty", "The AI didn't return notes for these players. Try again.");

  const now = new Date().toISOString();
  const { error } = await db.from("player_insights").upsert(
    generated.map((g) => ({
      player_id: g.playerId,
      summary: g.summary,
      strengths: g.strengths,
      concerns: g.concerns,
      role_fit: g.roleFit,
      tier: g.tier,
      price_floor: g.priceFloor,
      price_fair: g.priceFair,
      price_stretch: g.priceStretch,
      confidence: g.confidence,
      generated_at: now,
      model: AI_MODEL,
    })),
    { onConflict: "player_id" },
  );
  if (error) {
    console.error("Saving insights failed", error);
    throw new InsightError(500, "db_error", "Could not save the notes");
  }
  return { generated: generated.length, remaining: pending.length - generated.length, total: ctx.brief.length };
}

/** Clears the notes (not the stats) for a pool, ready to generate again. */
export async function clearInsights(db: SupabaseClient, pool: Pool): Promise<number> {
  const { data: ids } = await db.from("players").select("id").eq("pool", pool);
  const list = (ids ?? []).map((r) => r.id as string);
  if (!list.length) return 0;
  const { data, error } = await db
    .from("player_insights")
    .update({
      summary: null,
      strengths: [],
      concerns: [],
      role_fit: null,
      tier: null,
      price_floor: null,
      price_fair: null,
      price_stretch: null,
      confidence: null,
      generated_at: null,
      model: null,
    })
    .in("player_id", list)
    .select("player_id");
  if (error) throw new InsightError(500, "db_error", "Could not clear the notes");
  return data?.length ?? 0;
}

/** Every player's notes, as owners see them. */
export async function loadInsights(db: SupabaseClient): Promise<PlayerInsight[]> {
  const { data, error } = await db.from("player_insights").select("*");
  if (error) {
    // Before the migration is run the table doesn't exist: nothing to show.
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new InsightError(500, "db_error", "Could not load the notes");
  }
  return (data as InsightRow[]).map((r) => ({
    playerId: r.player_id,
    summary: r.summary,
    strengths: r.strengths ?? [],
    concerns: r.concerns ?? [],
    roleFit: r.role_fit,
    tier: r.tier,
    priceFloor: r.price_floor,
    priceFair: r.price_fair,
    priceStretch: r.price_stretch,
    confidence: r.confidence,
    generatedAt: r.generated_at,
    statLines: hasStats(r.stats) ? statLines(r.stats) : [],
    // Only ever link to CricHeroes itself.
    cricheroesUrl: r.cricheroes_url && /^https:\/\/(www\.)?cricheroes\.(com|in)\//.test(r.cricheroes_url) ? r.cricheroes_url : null,
  }));
}
