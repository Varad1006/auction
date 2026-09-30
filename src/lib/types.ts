// Row types mirroring supabase/migrations. Keep in sync with the schema.

export type Pool = "men" | "women";
export const POOLS: Pool[] = ["men", "women"];

export type Grade = "A" | "B" | "C";
export const GRADES: Grade[] = ["A", "B", "C"];

export type PlayerRole = "Batter" | "Bowler" | "All-rounder" | "Wicket-keeper";
export const PLAYER_ROLES: PlayerRole[] = ["Batter", "Bowler", "All-rounder", "Wicket-keeper"];

export type PlayerStatus = "pool" | "sold" | "unsold";
export type Phase = "idle" | "spinning" | "revealed" | "bidding" | "sold" | "unsold";
export type Role = "admin" | "owner" | "viewer";

export interface IncrementTier {
  from: number;
  step: number;
}

export interface PoolConfig {
  pool: Pool;
  label: string;
  purse: number;
  min_squad: number;
  max_squad: number;
  base_price_a: number;
  base_price_b: number;
  base_price_c: number;
  increment_tiers: IncrementTier[];
  current_round: number;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface TeamPoolLimit {
  team_id: string;
  pool: Pool;
  purse: number | null;
  min_squad: number | null;
  max_squad: number | null;
}

export interface Player {
  id: string;
  name: string;
  pool: Pool;
  role: PlayerRole;
  batting_style: string | null;
  bowling_style: string | null;
  grade: Grade;
  base_price: number;
  photo_url: string | null;
  notes: string | null;
  status: PlayerStatus;
  sold_team_id: string | null;
  sold_price: number | null;
  decided_round: number | null;
  created_at: string;
  updated_at: string;
}

export interface AuctionState {
  id: number;
  current_pool: Pool;
  phase: Phase;
  current_player_id: string | null;
  current_bid: number | null;
  leading_team_id: string | null;
  bid_count: number;
  spin_candidates: string[] | null;
  spin_started_at: string | null;
  spin_duration_ms: number;
  last_result_id: number | null;
  version: number;
  updated_at: string;
}

export interface Bid {
  id: number;
  player_id: string;
  pool: Pool;
  round: number;
  team_id: string;
  amount: number;
  placed_by_role: "owner" | "admin";
  created_at: string;
  voided_at: string | null;
}

export interface Result {
  id: number;
  player_id: string;
  pool: Pool;
  round: number;
  outcome: "sold" | "unsold";
  team_id: string | null;
  price: number | null;
  method: "auction" | "manual";
  created_at: string;
  undone_at: string | null;
}

export interface OwnerMapping {
  email: string;
  team_id: string;
  label: string | null;
  created_at: string;
}

export interface UserSession {
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  team_id: string | null;
  user_agent: string | null;
  first_seen: string;
  last_seen: string;
}

export interface Me {
  role: Role;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  /** Signed in, but not with Google (e.g. a leftover email login). */
  notGoogle?: boolean;
}

export const POOL_LABEL: Record<Pool, string> = { men: "Men", women: "Women" };
