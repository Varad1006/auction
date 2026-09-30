// Client-side copy of the bid rules in
// supabase/migrations/20260930000002_auction_functions.sql. The database is
// authoritative; this copy only drives what the bid buttons show.

import type { AuctionState, Grade, IncrementTier, Player, Pool, PoolConfig, TeamPoolLimit } from "./types";

export function incrementFor(tiers: IncrementTier[], amount: number): number {
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  let step = sorted[0]?.step ?? 1;
  for (const t of sorted) if (t.from <= amount) step = t.step;
  return step;
}

export function basePriceFor(config: PoolConfig, grade: Grade): number {
  return grade === "A" ? config.base_price_a : grade === "B" ? config.base_price_b : config.base_price_c;
}

export function poolMinBase(config: PoolConfig): number {
  return Math.min(config.base_price_a, config.base_price_b, config.base_price_c);
}

export interface TeamPoolSummary {
  teamId: string;
  pool: Pool;
  purse: number;
  minSquad: number;
  maxSquad: number;
  spent: number;
  remaining: number;
  squadCount: number;
  /** Largest bid allowed right now (purse minus reserve for the minimum squad). */
  maxBid: number;
}

export function teamPoolSummary(
  teamId: string,
  pool: Pool,
  config: PoolConfig,
  limits: TeamPoolLimit[],
  players: Player[],
): TeamPoolSummary {
  const lim = limits.find((l) => l.team_id === teamId && l.pool === pool);
  const purse = lim?.purse ?? config.purse;
  const minSquad = lim?.min_squad ?? config.min_squad;
  const maxSquad = lim?.max_squad ?? config.max_squad;
  let spent = 0;
  let squadCount = 0;
  for (const p of players) {
    if (p.status === "sold" && p.sold_team_id === teamId && p.pool === pool) {
      spent += p.sold_price ?? 0;
      squadCount++;
    }
  }
  const remaining = purse - spent;
  const reserve = Math.max(minSquad - squadCount - 1, 0) * poolMinBase(config);
  const maxBid = squadCount >= maxSquad ? 0 : Math.max(remaining - reserve, 0);
  return { teamId, pool, purse, minSquad, maxSquad, spent, remaining, squadCount, maxBid };
}

/** Smallest acceptable next bid on the player currently on the block. */
export function minNextBid(state: Pick<AuctionState, "current_bid">, player: Player, config: PoolConfig): number {
  return state.current_bid === null
    ? player.base_price
    : state.current_bid + incrementFor(config.increment_tiers, state.current_bid);
}

export type BidBlock =
  | { ok: true }
  | { ok: false; code: "not_bidding" | "already_leading" | "squad_full" | "insufficient_purse" | "reserve" | "too_low"; message: string };

export function checkBid(
  amount: number,
  teamId: string,
  state: AuctionState,
  player: Player,
  config: PoolConfig,
  summary: TeamPoolSummary,
): BidBlock {
  if (state.phase !== "bidding" || state.current_player_id !== player.id) {
    return { ok: false, code: "not_bidding", message: "Bidding is not open" };
  }
  if (state.leading_team_id === teamId) {
    return { ok: false, code: "already_leading", message: "You hold the highest bid" };
  }
  if (amount < minNextBid(state, player, config)) {
    return { ok: false, code: "too_low", message: `Minimum bid is ${minNextBid(state, player, config)}` };
  }
  if (summary.squadCount >= summary.maxSquad) {
    return { ok: false, code: "squad_full", message: `Squad full (${summary.squadCount}/${summary.maxSquad})` };
  }
  if (amount > summary.remaining) {
    return { ok: false, code: "insufficient_purse", message: `Only ${summary.remaining} left` };
  }
  if (amount > summary.maxBid) {
    return { ok: false, code: "reserve", message: `Max bid ${summary.maxBid} (reserve for minimum squad)` };
  }
  return { ok: true };
}

/** Quick-bid amounts for the one-tap buttons: next minimum, then +1 and +3 steps. */
export function quickBidAmounts(state: AuctionState, player: Player, config: PoolConfig): number[] {
  const first = minNextBid(state, player, config);
  const out = [first];
  let a = first;
  for (const extra of [1, 2]) {
    for (let i = 0; i < extra; i++) a += incrementFor(config.increment_tiers, a);
    out.push(a);
  }
  return out;
}

export function parseIncrementTiers(text: string): IncrementTier[] | null {
  // "5" or "0:5, 100:10, 300:25"
  const parts = text.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const tiers: IncrementTier[] = [];
  for (const p of parts) {
    const m = /^(?:(\d+)\s*[:=]\s*)?(\d+)$/.exec(p);
    if (!m) return null;
    const step = Number(m[2]);
    if (step <= 0) return null;
    tiers.push({ from: m[1] === undefined ? 0 : Number(m[1]), step });
  }
  tiers.sort((a, b) => a.from - b.from);
  if (tiers[0].from !== 0) tiers.unshift({ from: 0, step: tiers[0].step });
  return tiers;
}

export function formatIncrementTiers(tiers: IncrementTier[]): string {
  return tiers.map((t) => `${t.from}:${t.step}`).join(", ");
}
