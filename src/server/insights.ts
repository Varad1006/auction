import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import {
  applyNudge,
  batchBrief,
  cricheroesCareers,
  marketNumbers,
  OUTPUT_SCHEMA,
  priceStep,
  readAnswer,
  statLines,
  SYSTEM_PROMPT,
  type BriefPlayer,
  type GeneratedInsight,
  type Market,
  type PlayerInsight,
} from "@/lib/insights";
import { parsePriceCsv, parsePriceWorkbook, type PastPriceRow } from "@/lib/price-lists";
import { teamPoolSummary } from "@/lib/rules";
import { matchPlayers, parseStatsFiles, type PlayerStats } from "@/lib/stats-import";
import { POOL_LABEL, POOLS, type Player, type Pool, type PoolConfig, type Team, type TeamPoolLimit } from "@/lib/types";
import { historyLine, priceHistory, seasonAverages, valuePool, type PastPrice, type Valuation } from "@/lib/valuation";
import { readXlsx } from "@/lib/xlsx";
import { AiError, aiProvider, batchSizeFor, completeJson, modelName, type Provider } from "./ai";
import { registrationSettings } from "./registration";

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
const missingFunction = (code?: string) => code === "42883" || code === "PGRST202";
const needsMigration = () => new InsightError(503, "migration_needed", "Run the latest SQL update in Supabase first.");

// Every owner reloads at once after a sale: one calculation serves them all.
// Cleared whenever this server changes the data behind it.
let cached: { at: number; data: PlayerInsight[] } | null = null;
const CACHE_MS = 3000;

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
  cached = null;
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

  cached = null;
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
// The price guide, worked out live
// ---------------------------------------------------------------------------

/** The guide as it stood when the AI wrote a note, with the AI's adjustment. */
type StoredValuation = Valuation & { nudge?: number };

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
  valuation?: StoredValuation | null;
  /** Missing before migration 0018. */
  note_claimed_at?: string | null;
}

const hasStats = (s: InsightRow["stats"] | undefined): s is PlayerStats => !!s && "seasons" in s;

/** Match days a player picked in "Availability" when registering. */
function availableDays(p: Player): number | null {
  const value = (p.details ?? []).find((d) => d.label.toLowerCase() === "availability")?.value;
  return value ? value.split(",").map((d) => d.trim()).filter(Boolean).length : null;
}

interface MarketData {
  players: Player[];
  teams: Team[];
  configs: PoolConfig[];
  limits: TeamPoolLimit[];
  rows: Map<string, InsightRow>;
  past: PastPrice[];
  matchDays: number;
  /** The player on the block, if any. */
  onBlock: string | null;
}

async function loadMarket(db: SupabaseClient): Promise<MarketData> {
  const [players, teams, configs, limits, insights, state, settings, past] = await Promise.all([
    db.from("players").select("*").order("name"),
    db.from("teams").select("*").order("sort_order").order("name"),
    db.from("pool_config").select("*"),
    db.from("team_pool_limits").select("*"),
    db.from("player_insights").select("*"),
    db.from("auction_state").select("current_player_id, phase").limit(1).maybeSingle(),
    registrationSettings(db),
    loadPastPrices(db),
  ]);
  const failed = [players, teams, configs, limits, state].find((r) => r.error);
  if (failed?.error) throw new InsightError(500, "db_error", "Could not load the auction data");
  // Before the migration is run the table doesn't exist: nothing stored yet.
  if (insights.error && !missingTable(insights.error.code)) throw new InsightError(500, "db_error", "Could not load the notes");
  const s = state.data as { current_player_id: string | null; phase: string } | null;
  return {
    players: players.data as Player[],
    teams: teams.data as Team[],
    configs: configs.data as PoolConfig[],
    limits: limits.data as TeamPoolLimit[],
    rows: new Map(((insights.data ?? []) as InsightRow[]).map((r) => [r.player_id, r])),
    past,
    matchDays: settings.availability_options.length,
    onBlock: s && ["spinning", "revealed", "bidding"].includes(s.phase) ? s.current_player_id : null,
  };
}

interface PoolContext {
  market: Market;
  /** Players still to be auctioned, with their price guide. */
  brief: BriefPlayer[];
  maxBid: number;
  step: number;
  matchDays: number;
  /** Some player has stats or a previous price: without any, there's no guide. */
  hasData: boolean;
}

function poolContext(m: MarketData, pool: Pool): PoolContext | null {
  const config = m.configs.find((c) => c.pool === pool);
  if (!config) return null;
  const all = m.players.filter((p) => p.pool === pool);
  const summaries = m.teams.map((t) => ({ team: t, s: teamPoolSummary(t.id, pool, config, m.limits, all) }));
  const market: Market = {
    pool,
    poolLabel: POOL_LABEL[pool],
    teams: summaries.map(({ team, s }) => ({ name: team.name, purseLeft: s.remaining, bought: s.squadCount, minSquad: s.minSquad, maxSquad: s.maxSquad })),
    basePrices: { A: config.base_price_a, B: config.base_price_b, C: config.base_price_c },
    sold: all.filter((p) => p.status === "sold" && !p.signing).map((p) => ({ name: p.name, price: p.sold_price ?? 0 })),
  };
  const statsOf = (id: string) => {
    const s = m.rows.get(id)?.stats;
    return hasStats(s) ? s : null;
  };
  const numbers = marketNumbers(market);
  const maxBid = Math.max(0, ...summaries.map(({ s }) => s.maxBid));
  const step = priceStep(Math.max(0, ...market.teams.map((t) => t.purseLeft)));

  const available = all.filter((p) => p.status === "pool" || p.status === "unsold");
  const valuations = valuePool(
    available.map((p) => ({ id: p.id, name: p.name, pool, basePrice: p.base_price, stats: statsOf(p.id), availableDays: availableDays(p) })),
    m.past,
    { purse: numbers.purse, slots: numbers.slotsMin, maxBid, step, matchDays: m.matchDays },
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
  return { market, brief, maxBid, step, matchDays: m.matchDays, hasData: brief.some((p) => p.stats || p.valuation.history.length) };
}

/** The AI's adjustment to the guide for a player with a note. */
function nudgeOf(r: InsightRow): number {
  if (r.valuation?.nudge) return r.valuation.nudge;
  // Notes written before the adjustment was kept: work it out from the saved prices.
  return r.valuation?.fair && r.price_fair ? Math.min(Math.max(r.price_fair / r.valuation.fair, 0.8), 1.2) : 1;
}


/**
 * Every player's prices and notes, as owners see them. Prices for players
 * still to be auctioned are worked out now, so they follow the market as
 * players are sold; players already sold keep what was saved.
 */
export async function loadInsights(db: SupabaseClient): Promise<PlayerInsight[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const m = await loadMarket(db);
  const live = new Map<string, { p: BriefPlayer; ctx: PoolContext }>();
  for (const pool of POOLS) {
    const ctx = poolContext(m, pool);
    if (ctx?.hasData) for (const p of ctx.brief) live.set(p.id, { p, ctx });
  }
  const out: PlayerInsight[] = [];
  for (const id of new Set([...m.rows.keys(), ...live.keys()])) {
    const r = m.rows.get(id);
    const l = live.get(id);
    const v = l?.p.valuation;
    const prices = l
      ? applyNudge(l.p.valuation, r?.summary ? nudgeOf(r) : 1, l.p.basePrice, l.ctx.maxBid, l.ctx.step)
      : r?.price_fair != null
        ? { floor: r.price_floor, fair: r.price_fair, stretch: r.price_stretch }
        : null;
    out.push({
      playerId: id,
      summary: r?.summary ?? null,
      strengths: r?.strengths ?? [],
      concerns: r?.concerns ?? [],
      roleFit: r?.role_fit ?? null,
      tier: v?.tier ?? r?.tier ?? null,
      priceFloor: prices?.floor ?? null,
      priceFair: prices?.fair ?? null,
      priceStretch: prices?.stretch ?? null,
      confidence: v?.confidence ?? r?.confidence ?? null,
      generatedAt: r?.summary ? r.generated_at : null,
      hasNote: !!r?.summary,
      history: (v?.history ?? r?.valuation?.history ?? []).map(historyLine),
      statLines: hasStats(r?.stats) ? statLines(r.stats) : [],
      cricheroes: hasStats(r?.stats) ? cricheroesCareers(r.stats) : [],
      // Only ever link to CricHeroes itself.
      cricheroesUrl: r?.cricheroes_url && /^https:\/\/(www\.)?cricheroes\.(com|in)\//.test(r.cricheroes_url) ? r.cricheroes_url : null,
    });
  }
  cached = { at: Date.now(), data: out };
  return out;
}

// ---------------------------------------------------------------------------
// AI notes, written automatically
// ---------------------------------------------------------------------------

function friendly(e: unknown): InsightError {
  if (e instanceof InsightError) return e;
  if (e instanceof AiError) return new InsightError(e.status, e.code, e.message, e.retryAfter);
  console.error("Writing notes failed", e);
  return new InsightError(500, "internal", "Writing notes failed.");
}

/** A note claimed by another request in the last 2 minutes. */
const claimedRecently = (r: InsightRow | undefined) => !!r?.note_claimed_at && Date.now() - Date.parse(r.note_claimed_at) < 120_000;

/** How many teams have each player on their wishlist (to write those notes first). */
async function wishlistCounts(db: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await db.from("wishlist").select("player_id");
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { player_id: string }[]) out.set(r.player_id, (out.get(r.player_id) ?? 0) + 1);
  return out;
}

async function releaseClaims(db: SupabaseClient, ids: string[]) {
  if (ids.length) await db.from("player_insights").update({ note_claimed_at: null }).in("player_id", ids).is("summary", null);
}

/** Pauses every AI request (a rate limit, or a key that needs fixing). */
async function pauseAi(db: SupabaseClient, seconds: number) {
  await db.from("ai_status").update({ blocked_until: new Date(Date.now() + seconds * 1000).toISOString() }).eq("id", 1);
}

/** Seconds until the AI may be asked again. */
async function secondsToWait(db: SupabaseClient, gap: number): Promise<number> {
  const { data } = await db.from("ai_status").select("last_call_at, blocked_until").eq("id", 1).maybeSingle();
  const until = (t: string | null | undefined) => (t ? Math.ceil((Date.parse(t) - Date.now()) / 1000) : 0);
  return Math.max(until(data?.blocked_until), data?.last_call_at ? until(data.last_call_at) + gap : 0, 1);
}

export interface NoteResult {
  status: "written" | "done" | "busy" | "off";
  written: number;
  /** Players still to be auctioned without a note (in pools with data). */
  remaining: number;
  /** Seconds before another try makes sense. */
  wait: number | null;
}

export interface NoteOptions {
  /** These players only (on demand); otherwise the most useful ones still pending. */
  ids?: string[];
  pool?: Pool;
  size: number;
  /** Seconds that must pass since the last AI request (0 = go now). */
  gap: number;
  timeoutMs?: number;
}

/**
 * Writes AI notes for players still to be auctioned that don't have one.
 * Players on the block, then those on wishlists, then the dearest go first.
 * Two requests never write the same note, and nothing is sent while the AI
 * is paused by a rate limit.
 */
export async function writeNotes(db: SupabaseClient, opts: NoteOptions): Promise<NoteResult> {
  const provider = aiProvider();
  if (!provider) return { status: "off", written: 0, remaining: 0, wait: null };
  const m = await loadMarket(db);
  const contexts = POOLS.map((p) => poolContext(m, p)).filter((c): c is PoolContext => !!c?.hasData && (!opts.pool || c.market.pool === opts.pool));
  const pending = contexts.flatMap((ctx) => ctx.brief.filter((p) => !m.rows.get(p.id)?.summary).map((p) => ({ p, ctx })));
  if (!pending.length) return { status: "done", written: 0, remaining: 0, wait: null };

  let wanted = pending;
  if (opts.ids) {
    wanted = pending.filter((x) => opts.ids!.includes(x.p.id));
    if (!wanted.length) return { status: "done", written: 0, remaining: pending.length, wait: null };
  } else {
    const wished = await wishlistCounts(db);
    wanted = pending
      .filter((x) => !claimedRecently(m.rows.get(x.p.id)))
      .sort(
        (a, b) =>
          Number(b.p.id === m.onBlock) - Number(a.p.id === m.onBlock) ||
          (wished.get(b.p.id) ?? 0) - (wished.get(a.p.id) ?? 0) ||
          b.p.valuation.fair - a.p.valuation.fair,
      );
    if (!wanted.length) return { status: "busy", written: 0, remaining: pending.length, wait: 15 };
  }
  // One pool per request: the brief describes that pool's market.
  const ctx = wanted[0].ctx;
  const batch = wanted.filter((x) => x.ctx === ctx).slice(0, Math.max(opts.size, 1)).map((x) => x.p);
  const { data: claimed, error } = await db.rpc("claim_insight_notes", { p_players: batch.map((p) => p.id), p_gap_seconds: opts.gap });
  if (error) {
    if (missingFunction(error.code) || missingTable(error.code)) throw needsMigration();
    console.error("Claiming notes failed", error);
    throw new InsightError(500, "db_error", "Could not start the AI");
  }
  const ids = new Set(((claimed ?? []) as unknown[]).map((c) => (typeof c === "string" ? c : String(Object.values(c as object)[0]))));
  const mine = batch.filter((p) => ids.has(p.id));
  if (!mine.length) return { status: "busy", written: 0, remaining: pending.length, wait: await secondsToWait(db, opts.gap) };

  let generated: GeneratedInsight[];
  let model: string;
  try {
    const reply = await completeJson(provider, {
      system: SYSTEM_PROMPT,
      user: batchBrief(ctx.market, mine, ctx.matchDays),
      schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      players: mine.length,
      timeoutMs: opts.timeoutMs,
    });
    model = reply.model;
    try {
      generated = readAnswer(reply.text, mine, ctx.maxBid, ctx.step);
    } catch (e) {
      console.error("Unreadable AI answer", e instanceof Error ? e.message : e);
      throw new InsightError(502, "ai_unreadable", "The AI's answer couldn't be read. Try again.");
    }
    if (!generated.length) throw new InsightError(502, "ai_empty", "The AI didn't return notes for these players. Try again.");
  } catch (e) {
    await releaseClaims(db, mine.map((p) => p.id));
    const err = friendly(e);
    const pause =
      err.code === "ai_rate_limited"
        ? (err.retryAfter ?? 30)
        : err.code === "ai_key_rejected" || err.code === "ai_model_missing"
          ? 600
          : ["ai_busy", "ai_unreachable", "ai_timeout"].includes(err.code)
            ? 20
            : 0;
    if (pause) await pauseAi(db, pause);
    throw err;
  }

  const now = new Date().toISOString();
  const guide = new Map(mine.map((p) => [p.id, p.valuation]));
  const { error: saveError } = await db.from("player_insights").upsert(
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
      valuation: { ...guide.get(g.playerId), nudge: g.nudge },
      generated_at: now,
      model: model.slice(0, 100),
      note_claimed_at: null,
    })),
    { onConflict: "player_id" },
  );
  const done = new Set(saveError ? [] : generated.map((g) => g.playerId));
  await releaseClaims(db, mine.filter((p) => !done.has(p.id)).map((p) => p.id));
  if (saveError) {
    console.error("Saving notes failed", saveError);
    throw new InsightError(500, "db_error", "Could not save the notes");
  }
  cached = null;
  return { status: "written", written: done.size, remaining: pending.length - done.size, wait: null };
}


/** The admin's "write the rest now": goes ahead even while the AI is paused. */
export async function writeNotesNow(db: SupabaseClient, pool: Pool, size: number): Promise<NoteResult> {
  await db.from("ai_status").update({ blocked_until: null }).eq("id", 1);
  return writeNotes(db, { pool, size, gap: 0 });
}

/** Clears the notes (not the stats) for a pool, ready to write again. */
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
  cached = null;
  return data?.length ?? 0;
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
  /** Previous auctions' price lists loaded so far. */
  seasons: SeasonPrices[];
  /** Seconds until the AI is asked again after a rate limit (null = not paused). */
  pausedFor: number | null;
}

export async function adminStatus(db: SupabaseClient): Promise<AdminStatus> {
  const provider = aiProvider();
  const [past, status] = await Promise.all([loadPastPrices(db), db.from("ai_status").select("blocked_until").eq("id", 1).maybeSingle()]);
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
  const blocked = status.data?.blocked_until ? Math.ceil((Date.parse(status.data.blocked_until) - Date.now()) / 1000) : 0;
  return { provider, model: modelName(provider), batchSize: batchSizeFor(provider), seasons, pausedFor: blocked > 0 ? blocked : null };
}
