// Owner wishlists and the numbers behind the owner's planning screen. Pure
// functions over the public live data, so they can run in the browser and be
// unit-tested.

import { minNextBid, type TeamPoolSummary } from "./rules";
import { PLAYER_ROLES, type AuctionState, type Player, type PlayerRole, type Pool, type PoolConfig, type Team } from "./types";

export type Priority = 1 | 2 | 3;
export const PRIORITIES: Priority[] = [1, 2, 3];
export const PRIORITY_LABEL: Record<Priority, string> = { 1: "Must-have", 2: "Want", 3: "Backup" };
export const WISHLIST_MAX = 60;

export interface WishlistEntry {
  player_id: string;
  priority: Priority;
  /** The most the team wants to pay (private target). */
  max_price: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const ON_BLOCK = ["spinning", "revealed", "bidding"];

export function isOnBlock(state: AuctionState | null, playerId: string): boolean {
  return !!state && state.current_player_id === playerId && ON_BLOCK.includes(state.phase);
}

export type EntryStatus = "up" | "pool" | "unsold" | "signed" | "lost";

export function entryStatus(player: Player, teamId: string, state: AuctionState | null): EntryStatus {
  if (player.status === "sold") return player.sold_team_id === teamId ? "signed" : "lost";
  if (isOnBlock(state, player.id)) return "up";
  return player.status === "unsold" ? "unsold" : "pool";
}

export interface WishlistItem {
  entry: WishlistEntry;
  player: Player;
  status: EntryStatus;
}

/**
 * Splits a wishlist into players still to play for (sorted: on the block
 * first, then by priority), players the team signed, and players that went
 * to other teams (these drop off the list; an undone sale brings them back).
 */
export function splitWishlist(
  entries: WishlistEntry[],
  playerById: Map<string, Player>,
  teamId: string,
  state: AuctionState | null,
) {
  const active: WishlistItem[] = [];
  const signed: WishlistItem[] = [];
  const lost: WishlistItem[] = [];
  for (const entry of entries) {
    const player = playerById.get(entry.player_id);
    if (!player) continue;
    const status = entryStatus(player, teamId, state);
    const item = { entry, player, status };
    if (status === "signed") signed.push(item);
    else if (status === "lost") lost.push(item);
    else active.push(item);
  }
  active.sort(
    (a, b) =>
      Number(b.status === "up") - Number(a.status === "up") ||
      a.entry.priority - b.entry.priority ||
      (b.entry.max_price ?? 0) - (a.entry.max_price ?? 0) ||
      a.player.name.localeCompare(b.player.name),
  );
  return { active, signed, lost };
}

/** Role counts in a team's squad for one pool. */
export function squadRoles(players: Player[], teamId: string, pool: Pool): Record<PlayerRole, number> {
  const out = Object.fromEntries(PLAYER_ROLES.map((r) => [r, 0])) as Record<PlayerRole, number>;
  for (const p of players) if (p.pool === pool && p.status === "sold" && p.sold_team_id === teamId) out[p.role]++;
  return out;
}

/** Short hints about gaps in a squad (empty when it looks balanced). */
export function squadGaps(roles: Record<PlayerRole, number>, squadCount: number): string[] {
  const gaps: string[] = [];
  if (roles["Wicket-keeper"] === 0) gaps.push("No wicket-keeper yet");
  const bowling = roles.Bowler + roles["All-rounder"];
  if (squadCount >= 3 && bowling < Math.ceil(squadCount / 2)) gaps.push("Light on bowling options");
  const batting = roles.Batter + roles["All-rounder"] + roles["Wicket-keeper"];
  if (squadCount >= 3 && batting < Math.ceil(squadCount / 2)) gaps.push("Light on batting");
  return gaps;
}

export interface MarketStats {
  sold: number;
  average: number;
  highest: { player: Player; price: number } | null;
  byRole: { role: PlayerRole; count: number; average: number; left: number }[];
}

/** What players have gone for so far in a pool. */
export function marketStats(players: Player[], pool: Pool): MarketStats {
  const sold = players.filter((p) => p.pool === pool && p.status === "sold" && p.sold_price !== null);
  const avg = (list: Player[]) => (list.length ? Math.round(list.reduce((s, p) => s + (p.sold_price ?? 0), 0) / list.length) : 0);
  let highest: MarketStats["highest"] = null;
  for (const p of sold) if (!highest || (p.sold_price ?? 0) > highest.price) highest = { player: p, price: p.sold_price ?? 0 };
  return {
    sold: sold.length,
    average: avg(sold),
    highest,
    byRole: PLAYER_ROLES.map((role) => {
      const ofRole = sold.filter((p) => p.role === role);
      const left = players.filter((p) => p.pool === pool && p.role === role && p.status !== "sold").length;
      return { role, count: ofRole.length, average: avg(ofRole), left };
    }),
  };
}

export interface BudgetPlan {
  /** Players still needed to reach the minimum squad. */
  toMin: number;
  /** Open squad places. */
  toMax: number;
  /** Average the team can spend per player to fill its minimum squad. */
  perPlayer: number;
}

export function budgetPlan(s: TeamPoolSummary): BudgetPlan {
  const toMin = Math.max(s.minSquad - s.squadCount, 0);
  const toMax = Math.max(s.maxSquad - s.squadCount, 0);
  const slots = Math.max(toMin, toMax > 0 ? 1 : 0);
  return { toMin, toMax, perPlayer: slots ? Math.floor(s.remaining / slots) : 0 };
}

/**
 * What the team's open wishlist would cost at its target prices (base price
 * when no target is set), against what it can actually spend.
 */
export function wishlistCost(items: WishlistItem[], pool: Pool) {
  let must = 0;
  let all = 0;
  let count = 0;
  for (const { entry, player } of items) {
    if (player.pool !== pool) continue;
    const price = entry.max_price ?? player.base_price;
    all += price;
    count++;
    if (entry.priority === 1) must += price;
  }
  return { must, all, count };
}

export interface Rival {
  team: Team;
  maxBid: number;
  /** Has bought players but none of this role yet, so likely to chase it. */
  needsRole: boolean;
}

/**
 * Other teams that could still bid on the player on the block (their max bid
 * covers the next bid), strongest first.
 */
export function rivalsFor(
  player: Player,
  state: AuctionState,
  config: PoolConfig,
  teams: Team[],
  summaries: Map<string, TeamPoolSummary>,
  players: Player[],
  myTeamId: string,
): Rival[] {
  const next = minNextBid(state, player, config);
  const out: Rival[] = [];
  for (const team of teams) {
    if (team.id === myTeamId || team.id === state.leading_team_id) continue;
    const s = summaries.get(team.id);
    if (!s || s.maxBid < next) continue;
    out.push({ team, maxBid: s.maxBid, needsRole: s.squadCount > 0 && squadRoles(players, team.id, player.pool)[player.role] === 0 });
  }
  return out.sort((a, b) => b.maxBid - a.maxBid);
}

/** Chance (0-1) that the next spin lands on one of these players. */
export function nextSpinChance(items: WishlistItem[], players: Player[], pool: Pool): number {
  const inPool = players.filter((p) => p.pool === pool && p.status === "pool").length;
  if (!inPool) return 0;
  const mine = items.filter((i) => i.player.pool === pool && i.player.status === "pool").length;
  return mine / inPool;
}
