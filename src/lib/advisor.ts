// The owners' AI suggestions panel: live bid advice, a squad check and a
// rival watch for one team. Pure functions over the public live data, the
// price guide and the team's own wishlist, so they run in the browser (each
// owner only ever computes their own team's advice) and can be unit-tested.

import { money } from "./format";
import type { PlayerInsight } from "./insights";
import { incrementFor, minNextBid, type TeamPoolSummary } from "./rules";
import type { AuctionState, Player, PlayerRole, Pool, PoolConfig, Team } from "./types";
import { budgetPlan, PRIORITY_LABEL, squadRoles, type WishlistEntry } from "./wishlist";

const BOWLING: PlayerRole[] = ["Bowler", "All-rounder"];
const BATTING: PlayerRole[] = ["Batter", "All-rounder", "Wicket-keeper"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface Need {
  kind: "keeper" | "bowling" | "batting";
  count: number;
  label: string;
}

export interface SquadCheck {
  /** Everyone on the team in this pool, playing owners and the star included. */
  roles: Record<PlayerRole, number>;
  bought: number;
  owners: number;
  stars: number;
  /** The full team once the squad is complete. */
  teamSize: number;
  toMin: number;
  toMax: number;
  remaining: number;
  maxBid: number;
  /** Average the team can spend per place still to fill. */
  perPlayer: number;
  /** What the squad still lacks, most important first. */
  needs: Need[];
  /** More gaps than places left: players who cover two needs help. */
  tight: boolean;
}

/**
 * A rough balance check: a keeper, and about 40% of the full team able to
 * bowl and 40% able to bat (all-rounders count for both). Roles are what
 * players gave when registering.
 */
export function squadCheck(summary: TeamPoolSummary, players: Player[], teamId: string, pool: Pool): SquadCheck {
  const roles = squadRoles(players, teamId, pool);
  const plan = budgetPlan(summary);
  const teamSize = summary.maxSquad + summary.owners + summary.stars;
  const target = Math.ceil(teamSize * 0.4);
  const bowling = BOWLING.reduce((s, r) => s + roles[r], 0);
  const batting = BATTING.reduce((s, r) => s + roles[r], 0);
  const needs: Need[] = [];
  if (teamSize >= 6 && roles["Wicket-keeper"] === 0) needs.push({ kind: "keeper", count: 1, label: "a wicket-keeper" });
  if (bowling < target) needs.push({ kind: "bowling", count: target - bowling, label: `${plural(target - bowling, "more bowling option")}` });
  if (batting < target) needs.push({ kind: "batting", count: target - batting, label: `${plural(target - batting, "more batter")}` });
  const gaps = Math.max(0, ...needs.map((n) => n.count)) + (needs.some((n) => n.kind === "keeper") ? 1 : 0);
  return {
    roles,
    bought: summary.squadCount,
    owners: summary.owners,
    stars: summary.stars,
    teamSize,
    toMin: plan.toMin,
    toMax: plan.toMax,
    remaining: summary.remaining,
    maxBid: summary.maxBid,
    perPlayer: plan.perPlayer,
    needs: plan.toMax > 0 ? needs : [],
    tight: plan.toMax > 0 && gaps > plan.toMax,
  };
}

/** The need a player of this role would fill, if any. */
export function fillsNeed(role: PlayerRole, needs: Need[]): Need | null {
  return needs.find((n) => (n.kind === "keeper" ? role === "Wicket-keeper" : n.kind === "bowling" ? BOWLING.includes(role) : BATTING.includes(role))) ?? null;
}

export interface RivalInfo {
  team: Team;
  remaining: number;
  maxBid: number;
  placesLeft: number;
  needs: Need[];
  /** Leading the bidding on the player on the block. */
  leading: boolean;
  /** Can cover the next bid on the player on the block. */
  canBid: boolean;
  /** The player on the block fills one of their gaps. */
  needsRole: boolean;
}

/** The other teams, those who can still bid on the player on the block first. */
export function rivalWatch(a: {
  teams: Team[];
  summaries: Map<string, TeamPoolSummary>;
  players: Player[];
  pool: Pool;
  teamId: string;
  player?: Player | null;
  state?: AuctionState | null;
  config?: PoolConfig | null;
}): RivalInfo[] {
  const next = a.player && a.state && a.config ? minNextBid(a.state, a.player, a.config) : null;
  const out: RivalInfo[] = [];
  for (const team of a.teams) {
    const s = a.summaries.get(team.id);
    if (team.id === a.teamId || !s) continue;
    const check = squadCheck(s, a.players, team.id, a.pool);
    const leading = !!a.player && a.state?.leading_team_id === team.id;
    out.push({
      team,
      remaining: s.remaining,
      maxBid: s.maxBid,
      placesLeft: check.toMax,
      needs: check.needs,
      leading,
      canBid: next !== null && !leading && check.toMax > 0 && s.maxBid >= next,
      needsRole: !!a.player && !!fillsNeed(a.player.role, check.needs),
    });
  }
  return out.sort((x, y) => Number(y.leading) - Number(x.leading) || Number(y.canBid) - Number(x.canBid) || y.maxBid - x.maxBid);
}

export type Verdict = "bid" | "leading" | "let-go" | "cant-afford" | "full";

export interface BidAdvice {
  verdict: Verdict;
  /** The most this team should go to (null when it can't bid at all). */
  limit: number | null;
  /** The next valid bid. */
  next: number;
  /** No bid yet: `next` is the opening price. */
  opening: boolean;
  headline: string;
  reasons: string[];
}

/** Rounds down to an amount the bidding can actually reach. */
function onStep(amount: number, base: number, config: PoolConfig): number {
  if (amount <= base) return base;
  const step = incrementFor(config.increment_tiers, amount);
  return Math.max(base, Math.floor(amount / step) * step);
}

/**
 * How far this team should go for the player on the block. The team's own
 * wishlist max wins; otherwise the price guide, chosen by priority and
 * squad need, kept affordable for the places still to fill.
 */
export function bidAdvice(a: {
  player: Player;
  state: AuctionState;
  config: PoolConfig;
  teamId: string;
  mine: TeamPoolSummary;
  squad: SquadCheck;
  insight: PlayerInsight | null;
  entry: WishlistEntry | null;
  rivals: RivalInfo[];
}): BidAdvice {
  const { player, state, config, mine, squad, insight, entry } = a;
  const next = minNextBid(state, player, config);
  const leading = state.leading_team_id === a.teamId;
  const current = state.current_bid;
  if (mine.squadCount >= mine.maxSquad) {
    return { verdict: "full", limit: null, next, opening: current === null, headline: "Your squad is full", reasons: [`You have all ${mine.maxSquad} auction places filled.`] };
  }

  const base = player.base_price;
  const guide = insight?.priceFair != null ? { floor: insight.priceFloor ?? base, fair: insight.priceFair, stretch: insight.priceStretch ?? insight.priceFair } : null;
  const need = fillsNeed(player.role, squad.needs);
  const reasons: string[] = [];

  let limit: number;
  if (entry?.max_price != null) {
    limit = entry.max_price;
  } else if (guide) {
    limit = entry?.priority === 1 ? guide.stretch : entry?.priority === 2 ? guide.fair : entry?.priority === 3 ? guide.floor : need ? guide.fair : guide.floor;
  } else {
    limit = base;
  }

  // Without a max of their own, keep enough for the places still to fill.
  if (entry?.max_price == null && entry?.priority !== 1 && squad.toMin > 1) {
    const cap = Math.max(squad.perPlayer * 2, guide?.floor ?? base);
    if (limit > cap) {
      limit = cap;
      reasons.push(`Kept to about twice your average per place (${money(squad.perPlayer)}) so you can still fill ${plural(squad.toMin, "place")}.`);
    }
  }
  if (limit > mine.maxBid) {
    limit = mine.maxBid;
    reasons.push(`The most you can bid now is ${money(mine.maxBid)}; the rest is kept for your other places.`);
  }
  limit = onStep(limit, base, config);

  if (guide) {
    reasons.unshift(
      `Price guide: fair ${money(guide.fair)}, likely ${money(guide.floor)}–${money(guide.stretch)}${insight?.hasNote ? " (with the AI's view)" : ""}.`,
    );
    if (insight?.history[0]) reasons.push(`${insight.history[0]}.`);
  } else {
    reasons.unshift("No price guide for this player yet: going by base price.");
  }
  reasons.push(
    entry
      ? `On your wishlist as ${PRIORITY_LABEL[entry.priority]}${entry.max_price != null ? ` with your max at ${money(entry.max_price)}` : ""}.`
      : "Not on your wishlist.",
  );
  if (need) reasons.push(`Fills a gap: your squad needs ${need.label}.`);
  else if (squad.needs.length) {
    const role = player.role.toLowerCase();
    reasons.push(`Your squad needs ${squad.needs.map((n) => n.label).join(" and ")} more than ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.`);
  }

  const past = a.rivals.filter((r) => (r.canBid || r.leading) && r.maxBid > limit);
  const chasing = past.filter((r) => r.needsRole);
  if (past.length) {
    reasons.push(
      `${plural(past.length, "rival")} can go past ${money(limit)}: ${past.map((r) => r.team.name).join(", ")}${chasing.length ? `; ${chasing.map((r) => r.team.name).join(", ")} need${chasing.length === 1 ? "s" : ""} a player like this` : ""}.`,
    );
  } else {
    reasons.push(`No other team can go past ${money(limit)}: you may get them for less.`);
  }

  const opening = current === null;
  if (leading) {
    return { verdict: "leading", limit, next, opening, headline: `You're leading at ${money(current)}. Your limit is ${money(limit)}`, reasons };
  }
  if (mine.maxBid < next) {
    return { verdict: "cant-afford", limit: mine.maxBid, next, opening, headline: `You can't cover the next bid of ${money(next)}`, reasons };
  }
  if (next > limit) {
    return { verdict: "let-go", limit, next, opening, headline: current !== null ? `Let go: bidding is past your limit of ${money(limit)}` : `Let go: past your limit of ${money(limit)}`, reasons };
  }
  return { verdict: "bid", limit, next, opening, headline: `Go up to ${money(limit)}`, reasons };
}
