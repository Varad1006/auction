import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import {
  batchBrief,
  marketNumbers,
  OUTPUT_SCHEMA,
  priceStep,
  readAnswer,
  statLines,
  SYSTEM_PROMPT,
  type BriefPlayer,
  type Market,
  type PlayerInsight,
} from "@/lib/insights";
import { parsePriceCsv, parsePriceWorkbook, type PastPriceRow } from "@/lib/price-lists";
import { teamPoolSummary } from "@/lib/rules";
import { matchPlayers, parseStatsFiles, type PlayerStats } from "@/lib/stats-import";
import { POOL_LABEL, type Player, type Pool, type PoolConfig, type Team, type TeamPoolLimit } from "@/lib/types";
import { historyLine, priceHistory, seasonAverages, valuePool, type PastPrice, type Valuation } from "@/lib/valuation";
import { readXlsx } from "@/lib/xlsx";
import { AiError, aiProvider, batchSizeFor, completeJson, modelName, type Provider } from "./ai";
import { registrationSettings } from "./registration";

/** Saved as the model of prices worked out without the AI. */
export const GUIDE_MODEL = "price-guide";

export class InsightError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Seconds to wait before trying again (AI rate limits). */
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

// Tables and columns from a migration that hasn't been run yet.
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";
const missingColumn = (code?: string) => code === "42703" || code === "PGRST204";
const needsMigration = () => new InsightError(503, "migration_needed", "Run the latest SQL update in Supabase first.");

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
// Importing previous auctions' prices
// ---------------------------------------------------------------------------

const MAX_PRICE_FILE = 10 * 1024 * 1024;

/** Reads an uploaded tracker sheet (.xlsx or .csv): names, pools, teams and prices only. */
export function parsePriceUpload(upload: { name: string; data: Uint8Array }): { rows: PastPriceRow[]; sheet: string | null } {
  if (upload.data.length > MAX_PRICE_FILE) throw new InsightError(413, "too_large", "The file is too large (10 MB at most)");
  let parsed: { rows: PastPriceRow[]; sheet: string | null; error: string | null };
  if (/\.xlsx$/i.test(upload.name)) {
    let sheets;
    try {
      sheets = readXlsx(upload.data);
    } catch {
      throw new InsightError(400, "bad_file", `${upload.name} couldn't be opened as an Excel file`);
    }
    parsed = parsePriceWorkbook(sheets);
  } else if (/\.csv$/i.test(upload.name)) {
    parsed = { ...parsePriceCsv(strFromU8(upload.data)), sheet: null };
  } else {
    throw new InsightError(400, "bad_file", "Upload the sheet as an Excel (.xlsx) or .csv file");
  }
  if (!parsed.rows.length) throw new InsightError(400, "no_prices", parsed.error ?? "No players found in the file");
  return { rows: parsed.rows.slice(0, 2000), sheet: parsed.sheet };
}

export interface PriceReport {
  season: number;
  sheet: string | null;
  /** Players read from the file. */
  players: number;
  /** Of those, sold in that auction (a price above 0). */
  sold: number;
  averages: Partial<Record<Pool, number>>;
  /** This year's auction players found in the list with a price. */
  matched: number;
  /** This year's auction players (in the pool or unsold). */
  available: number;
}

/** Replaces one season's prices with those in the uploaded sheet. */
export async function importPrices(db: SupabaseClient, season: number, upload: { name: string; data: Uint8Array }): Promise<PriceReport> {
  const { rows, sheet } = parsePriceUpload(upload);
  const removed = await db.from("past_prices").delete().eq("season", season);
  if (removed.error) {
    if (missingTable(removed.error.code)) throw needsMigration();
    console.error("Clearing prices failed", removed.error);
    throw new InsightError(500, "db_error", "Could not save the prices");
  }
  const { error } = await db.from("past_prices").insert(rows.map((r) => ({ season, pool: r.pool, name: r.name, team: r.team, price: r.price })));
  if (error) {
    console.error("Saving prices failed", error);
    throw new InsightError(500, "db_error", "Could not save the prices");
  }

  const past: PastPrice[] = rows.map((r) => ({ season, ...r }));
  const averages = seasonAverages(past);
  const { data: players } = await db.from("players").select("name, pool, status");
  const available = ((players ?? []) as Pick<Player, "name" | "pool" | "status">[]).filter((p) => p.status === "pool" || p.status === "unsold");
  const average = (pool: Pool) => averages.get(`${season}|${pool}`);
  return {
    season,
    sheet,
    players: rows.length,
    sold: rows.filter((r) => r.price > 0).length,
    averages: Object.fromEntries((["men", "women"] as Pool[]).flatMap((p) => (average(p) ? [[p, Math.round(average(p)!)]] : []))),
    matched: available.filter((p) => priceHistory(p, past, averages).length > 0).length,
    available: available.length,
  };
}

async function loadPastPrices(db: SupabaseClient): Promise<PastPrice[]> {
  const { data, error } = await db.from("past_prices").select("season, pool, name, team, price").order("id").limit(5000);
  if (error) {
    if (missingTable(error.code)) return [];
    throw new InsightError(500, "db_error", "Could not load the previous prices");
  }
  return data as PastPrice[];
}

// ---------------------------------------------------------------------------
// The price guide and the AI's notes
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
  /** Missing before migration 0017. */
  valuation?: Valuation | null;
}

const hasStats = (s: InsightRow["stats"] | undefined): s is PlayerStats => !!s && "seasons" in s;

/** Match days a player picked in "Availability" when registering. */
function availableDays(p: Player): number | null {
  const value = (p.details ?? []).find((d) => d.label.toLowerCase() === "availability")?.value;
  return value ? value.split(",").map((d) => d.trim()).filter(Boolean).length : null;
}

async function poolContext(db: SupabaseClient, pool: Pool) {
  const [players, teams, cfg, limits, insights, settings, past] = await Promise.all([
    db.from("players").select("*").eq("pool", pool).order("name"),
    db.from("teams").select("*").order("sort_order").order("name"),
    db.from("pool_config").select("*").eq("pool", pool).single(),
    db.from("team_pool_limits").select("*").eq("pool", pool),
    db.from("player_insights").select("*"),
    registrationSettings(db),
    loadPastPrices(db),
  ]);
  const failed = [players, teams, cfg, limits, insights].find((r) => r.error);
  if (failed?.error) throw new InsightError(500, "db_error", "Could not load the auction data");
  const all = players.data as Player[];
  const config = cfg.data as PoolConfig;
  const summaries = (teams.data as Team[]).map((t) => ({ team: t, s: teamPoolSummary(t.id, pool, config, limits.data as TeamPoolLimit[], all) }));
  const market: Market = {
    pool,
    poolLabel: POOL_LABEL[pool],
    teams: summaries.map(({ team, s }) => ({ name: team.name, purseLeft: s.remaining, bought: s.squadCount, minSquad: s.minSquad, maxSquad: s.maxSquad })),
    basePrices: { A: config.base_price_a, B: config.base_price_b, C: config.base_price_c },
    sold: all.filter((p) => p.status === "sold" && !p.signing).map((p) => ({ name: p.name, price: p.sold_price ?? 0 })),
  };
  const rows = new Map((insights.data as InsightRow[]).map((r) => [r.player_id, r]));
  const statsOf = (id: string) => {
    const s = rows.get(id)?.stats;
    return hasStats(s) ? s : null;
  };
  const matchDays = settings.availability_options.length;
  const numbers = marketNumbers(market);
  const maxBid = Math.max(0, ...summaries.map(({ s }) => s.maxBid));
  const step = priceStep(Math.max(0, ...market.teams.map((t) => t.purseLeft)));

  const available = all.filter((p) => p.status === "pool" || p.status === "unsold");
  const valuations = valuePool(
    available.map((p) => ({ id: p.id, name: p.name, pool, basePrice: p.base_price, stats: statsOf(p.id), availableDays: availableDays(p) })),
    past,
    { purse: numbers.purse, slots: numbers.slotsMin, maxBid, step, matchDays },
  );
  const brief: BriefPlayer[] = available.map((p, i) => ({
    ref: `P${String(i + 1).padStart(2, "0")}`,
    id: p.id,
    name: p.name,
    role: p.role,
    battingStyle: p.batting_style,
    bowlingStyle: p.bowling_style,
    basePrice: p.base_price,
    details: p.details ?? [],
    notes: p.notes,
    stats: statsOf(p.id),
    valuation: valuations.get(p.id)!,
  }));
  return { market, brief, rows, matchDays, maxBid, step };
}

const guideRow = (playerId: string, v: Valuation, now: string) => ({
  player_id: playerId,
  tier: v.tier,
  price_floor: v.floor,
  price_fair: v.fair,
  price_stretch: v.stretch,
  confidence: v.confidence,
  valuation: v,
  generated_at: now,
  model: GUIDE_MODEL,
});

function friendly(e: unknown): InsightError {
  if (e instanceof InsightError) return e;
  if (e instanceof AiError) return new InsightError(e.status, e.code, e.message, e.retryAfter);
  console.error("Generating insights failed", e);
  return new InsightError(500, "internal", "Generating notes failed.");
}

export interface BatchResult {
  /** AI notes written by this call. */
  generated: number;
  /** Players still without an AI note. */
  remaining: number;
  /** Players in the pool (or unsold). */
  total: number;
  /** Players with a price guide. */
  priced: number;
  /** False when no AI key is set: prices only. */
  ai: boolean;
}

/**
 * Recalculates the price guide for every player without an AI note (the
 * market moves as players are sold), then has the AI write notes for the next
 * few of them, if an AI key is set.
 */
export async function generateBatch(db: SupabaseClient, pool: Pool, size?: number): Promise<BatchResult> {
  const ctx = await poolContext(db, pool);
  const now = new Date().toISOString();
  const pending = ctx.brief.filter((p) => !ctx.rows.get(p.id)?.summary);
  if (pending.length) {
    const { error } = await db.from("player_insights").upsert(
      pending.map((p) => guideRow(p.id, p.valuation, now)),
      { onConflict: "player_id" },
    );
    if (error) {
      if (missingColumn(error.code)) throw needsMigration();
      console.error("Saving the price guide failed", error);
      throw new InsightError(500, "db_error", "Could not save the prices");
    }
  }
  const total = ctx.brief.length;
  const provider: Provider | null = aiProvider();
  if (!provider || !pending.length) return { generated: 0, remaining: pending.length, total, priced: total, ai: !!provider };

  const most = batchSizeFor(provider);
  const batch = pending.slice(0, Math.min(Math.max(Math.floor(size ?? most), 1), most));
  let reply: { text: string; model: string };
  try {
    reply = await completeJson(provider, {
      system: SYSTEM_PROMPT,
      user: batchBrief(ctx.market, batch, ctx.matchDays),
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (e) {
    throw friendly(e);
  }

  let generated;
  try {
    generated = readAnswer(reply.text, batch, ctx.maxBid, ctx.step);
  } catch (e) {
    console.error("Unreadable AI answer", e instanceof Error ? e.message : e);
    throw new InsightError(502, "ai_unreadable", "The AI's answer couldn't be read. Try again.");
  }
  if (!generated.length) throw new InsightError(502, "ai_empty", "The AI didn't return notes for these players. Try again.");

  const valuation = new Map(batch.map((p) => [p.id, p.valuation]));
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
      valuation: valuation.get(g.playerId),
      generated_at: now,
      model: reply.model.slice(0, 100),
    })),
    { onConflict: "player_id" },
  );
  if (error) {
    console.error("Saving insights failed", error);
    throw new InsightError(500, "db_error", "Could not save the notes");
  }
  return { generated: generated.length, remaining: pending.length - generated.length, total, priced: total, ai: true };
}

/** Clears the notes and prices (not the stats) for a pool, ready to generate again. */
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
      valuation: null,
      generated_at: null,
      model: null,
    })
    .in("player_id", list)
    .select("player_id");
  if (error) {
    if (missingColumn(error.code)) throw needsMigration();
    throw new InsightError(500, "db_error", "Could not clear the notes");
  }
  return data?.length ?? 0;
}

/** Every player's notes and prices, as owners see them. */
export async function loadInsights(db: SupabaseClient): Promise<PlayerInsight[]> {
  const { data, error } = await db.from("player_insights").select("*");
  if (error) {
    // Before the migration is run the table doesn't exist: nothing to show.
    if (missingTable(error.code)) return [];
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
    hasNote: !!r.summary,
    history: (r.valuation?.history ?? []).map(historyLine),
    statLines: hasStats(r.stats) ? statLines(r.stats) : [],
    // Only ever link to CricHeroes itself.
    cricheroesUrl: r.cricheroes_url && /^https:\/\/(www\.)?cricheroes\.(com|in)\//.test(r.cricheroes_url) ? r.cricheroes_url : null,
  }));
}

export interface SeasonPrices {
  season: number;
  pool: Pool;
  players: number;
  sold: number;
  average: number | null;
}

export interface AdminStatus {
  provider: Provider | null;
  model: string | null;
  batchSize: number;
  /** Previous auctions' price lists uploaded so far. */
  seasons: SeasonPrices[];
}

export async function adminStatus(db: SupabaseClient): Promise<AdminStatus> {
  const provider = aiProvider();
  const past = await loadPastPrices(db);
  const averages = seasonAverages(past);
  const groups = new Map<string, SeasonPrices>();
  for (const p of past) {
    const k = `${p.season}|${p.pool}`;
    const g = groups.get(k) ?? { season: p.season, pool: p.pool, players: 0, sold: 0, average: averages.has(k) ? Math.round(averages.get(k)!) : null };
    g.players++;
    if (p.price > 0) g.sold++;
    groups.set(k, g);
  }
  const seasons = [...groups.values()].sort((a, b) => a.season - b.season || a.pool.localeCompare(b.pool));
  return { provider, model: modelName(provider), batchSize: batchSizeFor(provider), seasons };
}
