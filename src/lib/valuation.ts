// The price guide: a suggested price range for every player, worked out from
// what they went for in previous auctions (relative to that season's
// average, since purses change), their PPL and CricHeroes stats and their
// availability, scaled so the whole pool adds up to what teams can spend.
// The AI writes the words and may nudge the fair price a little; the numbers
// come from here, so they stay consistent and explainable.

import { nameKey, type PlayerStats } from "./stats-import";
import type { Pool } from "./types";
import type { Tier, Confidence } from "./insights";

export interface PastPrice {
  season: number;
  pool: Pool;
  name: string;
  team: string | null;
  price: number;
}

export interface PricePoint {
  season: number;
  price: number;
  team: string | null;
  /** Price divided by that season's average for the pool. */
  ratio: number;
}

export interface ValuationPlayer {
  id: string;
  name: string;
  pool: Pool;
  basePrice: number;
  stats: PlayerStats | null;
  /** Match days the player can make, out of `matchDays` (null = unknown). */
  availableDays: number | null;
}

export interface ValuationMarket {
  /** Points all teams have left in this pool. */
  purse: number;
  /** Squad places teams must still fill. */
  slots: number;
  /** The most any team can bid on one player right now. */
  maxBid: number;
  /** Price rounding step. */
  step: number;
  matchDays: number;
}

export interface Valuation {
  floor: number;
  fair: number;
  stretch: number;
  tier: Tier;
  confidence: Confidence;
  history: PricePoint[];
  /** Impact per match on the PPL MVP scale (null without stats). */
  impact: number | null;
  /** Relative worth (1 = an average player in a previous auction). */
  ratio: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Average sold price per season and pool (unsold and owners at 0 don't count). */
export function seasonAverages(past: PastPrice[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const p of past) {
    if (p.price <= 0) continue;
    const k = `${p.season}|${p.pool}`;
    const s = sums.get(k) ?? { total: 0, n: 0 };
    s.total += p.price;
    s.n++;
    sums.set(k, s);
  }
  // A handful of prices is no basis for an average.
  return new Map([...sums].filter(([, s]) => s.n >= 5).map(([k, s]) => [k, s.total / s.n]));
}

const tokens = (name: string) => nameKey(name).split(" ").filter(Boolean);

/** The player's sold prices in previous seasons, matched by name within the pool. */
export function priceHistory(player: Pick<ValuationPlayer, "name" | "pool">, past: PastPrice[], averages: Map<string, number>): PricePoint[] {
  const key = nameKey(player.name);
  const mine = tokens(player.name);
  const bySeason = new Map<number, PastPrice[]>();
  for (const p of past) if (p.pool === player.pool) bySeason.set(p.season, [...(bySeason.get(p.season) ?? []), p]);
  const out: PricePoint[] = [];
  for (const [season, rows] of bySeason) {
    const avg = averages.get(`${season}|${player.pool}`);
    if (!avg) continue;
    let hits = rows.filter((r) => nameKey(r.name) === key);
    // "Rohan Vijay Mehta" in one list and "Rohan Mehta" in another: first and last names.
    if (hits.length !== 1 && mine.length >= 2) {
      hits = rows.filter((r) => {
        const t = tokens(r.name);
        return t.length >= 2 && t[0] === mine[0] && t.at(-1) === mine.at(-1);
      });
    }
    if (hits.length !== 1 || hits[0].price <= 0) continue;
    out.push({ season, price: hits[0].price, team: hits[0].team, ratio: hits[0].price / avg });
  }
  return out.sort((a, b) => b.season - a.season);
}

/** MVP points per match in PPL seasons, recent seasons counting most. */
function pplImpact(stats: PlayerStats | null): { value: number; matches: number } | null {
  const seasons = [...(stats?.seasons ?? [])].filter((s) => s.mvp?.total != null).sort((a, b) => b.season - a.season);
  if (!seasons.length) return null;
  const weights = [1, 0.6, 0.4, 0.3];
  let total = 0;
  let weight = 0;
  let matches = 0;
  seasons.forEach((s, i) => {
    const m = Math.max(s.mvp!.matches ?? s.batting?.matches ?? s.bowling?.matches ?? 1, 1);
    const w = weights[i] ?? 0.2;
    total += w * (s.mvp!.total! / m);
    weight += w;
    matches += m;
  });
  return { value: total / weight, matches };
}

/** A rough equivalent from CricHeroes career numbers, on the same scale. */
function careerImpact(stats: PlayerStats | null): number | null {
  const c = stats?.career?.tennis ?? stats?.career?.overall;
  const matches = c?.batting?.matches ?? c?.bowling?.matches ?? 0;
  if (!c || matches < 3) return null;
  const bat = c.batting ? ((c.batting.runs ?? 0) / matches / 10) * clamp((c.batting.strikeRate ?? 100) / 120, 0.5, 2) : 0;
  const bowl = c.bowling?.wickets ? (c.bowling.wickets / matches) * 1.8 * clamp(8 / Math.max(c.bowling.economy ?? 8, 1), 0.6, 1.5) : 0;
  const field = ((c.fielding?.catches ?? 0) / matches) * 0.3;
  return bat + bowl + field;
}

export function impactScore(stats: PlayerStats | null): { value: number; pplMatches: number } | null {
  const ppl = pplImpact(stats);
  const career = careerImpact(stats);
  if (ppl && career !== null) return { value: 0.75 * ppl.value + 0.25 * career, pplMatches: ppl.matches };
  if (ppl) return { value: ppl.value, pplMatches: ppl.matches };
  if (career !== null) return { value: 0.85 * career, pplMatches: 0 };
  return null;
}

/** Suggested prices for every player in a pool. */
export function valuePool(players: ValuationPlayer[], past: PastPrice[], market: ValuationMarket): Map<string, Valuation> {
  const averages = seasonAverages(past);
  const rows = players.map((p) => ({ p, history: priceHistory(p, past, averages), impact: impactScore(p.stats) }));

  // Stats -> relative worth against the pool's typical player; thin PPL
  // samples are pulled towards the middle.
  const typical = median(rows.flatMap((r) => (r.impact ? [r.impact.value] : []))) || 1;
  const relStats = (r: (typeof rows)[number]) => {
    if (!r.impact) return null;
    const m = r.impact.pplMatches;
    // Career numbers from other matches are weaker evidence than PPL itself.
    const shrunk = m === 0 ? (r.impact.value + typical) / 2 : m < 6 ? (m * r.impact.value + (6 - m) * typical) / 6 : r.impact.value;
    return clamp(Math.pow(Math.max(shrunk, 0.01) / typical, 1.3), 0.25, 4);
  };
  const relHistory = (h: PricePoint[]) => {
    if (!h.length) return null;
    const weights = h.map((_, i) => (i === 0 ? 0.65 : 0.35 / (h.length - 1)));
    const w = h.length === 1 ? [1] : weights;
    return clamp(h.reduce((s, x, i) => s + w[i] * x.ratio, 0), 0.2, 5);
  };

  const scored = rows.map((r) => {
    const hist = relHistory(r.history);
    const stats = relStats(r);
    const ratio = hist !== null && stats !== null ? 0.6 * hist + 0.4 * stats : (hist ?? stats);
    const avail = r.p.availableDays !== null && market.matchDays > 0 ? 0.6 + 0.4 * clamp(r.p.availableDays / market.matchDays, 0, 1) : 1;
    return { ...r, ratio, raw: ratio === null ? null : ratio * avail };
  });

  // Scale so the players expected to fill the open places cost what the teams have left.
  const cap = Math.max(market.maxBid, ...players.map((p) => p.basePrice));
  const priceAt = (raw: number | null, base: number, k: number) => (raw === null ? base : clamp(raw * k, base, cap));
  const ranked = [...scored].sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1));
  const top = ranked.slice(0, Math.max(Math.min(market.slots, ranked.length), 0));
  const spend = (k: number) => top.reduce((s, r) => s + priceAt(r.raw, r.p.basePrice, k), 0);
  let lo = 0;
  let hi = Math.max(cap, 1) * 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (spend(mid) > market.purse) hi = mid;
    else lo = mid;
  }
  // No places left to fill, or nothing to spend: everyone at base price.
  const k = top.length && market.purse > 0 ? lo : 0;

  const round = (n: number) => Math.round(n / market.step) * market.step;
  const known = ranked.filter((r) => r.raw !== null);
  const tierOf = (index: number): Tier => {
    const share = (index + 1) / known.length;
    if (share <= 0.05 || index === 0) return known.length >= 10 || index === 0 ? "marquee" : "premium";
    if (share <= 0.2) return "premium";
    if (share <= 0.6) return "solid";
    return "value";
  };

  const out = new Map<string, Valuation>();
  for (const r of scored) {
    const base = r.p.basePrice;
    const fair = clamp(round(priceAt(r.raw, base, k)), base, cap);
    const floor = clamp(round(fair * 0.75), base, fair);
    const stretch = clamp(round(fair * 1.3), fair, Math.max(cap, fair));
    const index = known.indexOf(r);
    const pplMatches = r.impact?.pplMatches ?? 0;
    out.set(r.p.id, {
      floor,
      fair,
      stretch,
      tier: r.raw === null ? "unknown" : tierOf(index),
      confidence: r.history.length && pplMatches >= 4 ? "high" : r.history.length || pplMatches >= 3 ? "medium" : "low",
      history: r.history,
      impact: r.impact ? Math.round(r.impact.value * 100) / 100 : null,
      ratio: r.ratio === null ? null : Math.round(r.ratio * 100) / 100,
    });
  }
  return out;
}

/** "Sold for 17,000 in PPL 2 to P2 Indians (1.4× that season's average)" */
export function historyLine(h: PricePoint): string {
  const team = h.team && !/^(unsold|na|n\/a|-)$/i.test(h.team) ? ` to ${h.team}` : "";
  return `Sold for ${h.price.toLocaleString("en-IN")} in PPL ${h.season}${team} (${h.ratio.toFixed(1)}× that season's average)`;
}
