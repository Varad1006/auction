import { describe, expect, it } from "vitest";
import { teamPoolSummary } from "@/lib/rules";
import type { AuctionState, Player, PoolConfig, Team } from "@/lib/types";
import {
  budgetPlan,
  marketStats,
  nextSpinChance,
  rivalsFor,
  splitWishlist,
  squadGaps,
  squadRoles,
  wishlistCost,
  type WishlistEntry,
} from "@/lib/wishlist";

const config: PoolConfig = {
  pool: "men", label: "Men", purse: 100, min_squad: 3, max_squad: 4,
  base_price_a: 10, base_price_b: 10, base_price_c: 10,
  increment_tiers: [{ from: 0, step: 5 }],
  current_round: 1, updated_at: "",
};

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id, name: id.toUpperCase(), pool: "men", role: "Batter", batting_style: null, bowling_style: null,
  grade: "C", base_price: 10, photo_url: null, notes: null, details: [], status: "pool", sold_team_id: null,
  sold_price: null, decided_round: null, created_at: "", updated_at: "", ...over,
});

const state = (over: Partial<AuctionState> = {}): AuctionState => ({
  id: 1, current_pool: "men", phase: "idle", current_player_id: null, current_bid: null,
  leading_team_id: null, bid_count: 0, spin_candidates: null, spin_started_at: null,
  spin_duration_ms: 6000, last_result_id: null, version: 1, updated_at: "", ...over,
});

const entry = (player_id: string, over: Partial<WishlistEntry> = {}): WishlistEntry => ({
  player_id, priority: 2, max_price: null, note: null, created_at: "", updated_at: "", ...over,
});

const team = (id: string): Team => ({ id, name: id, short_name: id, color: "#000000", sort_order: 0, created_at: "" });

describe("wishlist", () => {
  const players = [
    player("a"),
    player("b", { status: "sold", sold_team_id: "t1", sold_price: 30 }),
    player("c", { status: "sold", sold_team_id: "t2", sold_price: 40 }),
    player("d", { status: "unsold" }),
    player("e"),
  ];
  const byId = new Map(players.map((p) => [p.id, p]));

  it("drops players sold to other teams and puts the one on the block first", () => {
    const entries = [entry("a", { priority: 1 }), entry("b"), entry("c"), entry("d"), entry("e", { priority: 3 })];
    const { active, signed, lost } = splitWishlist(entries, byId, "t1", state({ phase: "bidding", current_player_id: "e" }));
    expect(active.map((i) => [i.player.id, i.status])).toEqual([
      ["e", "up"],
      ["a", "pool"],
      ["d", "unsold"],
    ]);
    expect(signed.map((i) => i.player.id)).toEqual(["b"]);
    expect(lost.map((i) => i.player.id)).toEqual(["c"]);
  });

  it("costs the open wishlist at max prices, base price where unset", () => {
    const { active } = splitWishlist([entry("a", { priority: 1, max_price: 25 }), entry("d")], byId, "t1", null);
    expect(wishlistCost(active, "men")).toEqual({ must: 25, all: 35, count: 2 });
    expect(wishlistCost(active, "women")).toEqual({ must: 0, all: 0, count: 0 });
  });

  it("estimates the chance the next spin is a wishlisted player", () => {
    const { active } = splitWishlist([entry("a"), entry("d")], byId, "t1", null);
    // a is in the pool (d is unsold this round); a and e are the 2 players in the pool.
    expect(nextSpinChance(active, players, "men")).toBe(0.5);
  });
});

describe("planning numbers", () => {
  it("averages purse over the slots still needed", () => {
    const s = teamPoolSummary("t1", "men", config, [], [player("x", { status: "sold", sold_team_id: "t1", sold_price: 40 })]);
    expect(budgetPlan(s)).toEqual({ toMin: 2, toMax: 3, perPlayer: 30 });
  });

  it("flags squad gaps", () => {
    const squad = [
      player("p", { role: "Batter", status: "sold", sold_team_id: "t1", sold_price: 1 }),
      player("q", { role: "Batter", status: "sold", sold_team_id: "t1", sold_price: 1 }),
      player("r", { role: "Batter", status: "sold", sold_team_id: "t1", sold_price: 1 }),
    ];
    const roles = squadRoles(squad, "t1", "men");
    expect(roles.Batter).toBe(3);
    expect(squadGaps(roles, 3)).toEqual(["No wicket-keeper yet", "Light on bowling options"]);
  });

  it("summarises prices by role", () => {
    const list = [
      player("a", { role: "Bowler", status: "sold", sold_team_id: "t1", sold_price: 20 }),
      player("b", { role: "Bowler", status: "sold", sold_team_id: "t2", sold_price: 40 }),
      player("c", { role: "Bowler" }),
      player("d", { role: "Batter", status: "sold", sold_team_id: "t2", sold_price: 90 }),
    ];
    const m = marketStats(list, "men");
    expect(m.sold).toBe(3);
    expect(m.average).toBe(50);
    expect(m.highest?.player.id).toBe("d");
    expect(m.byRole.find((r) => r.role === "Bowler")).toEqual({ role: "Bowler", count: 2, average: 30, left: 1 });
  });

  it("lists rivals who can cover the next bid, skipping me and the leader", () => {
    const teams = [team("me"), team("rich"), team("broke"), team("leader"), team("keen")];
    const players = [
      player("wk", { role: "Wicket-keeper" }),
      player("x", { status: "sold", sold_team_id: "broke", sold_price: 95 }),
      player("y", { role: "Wicket-keeper", status: "sold", sold_team_id: "rich", sold_price: 10 }),
      player("z", { role: "Batter", status: "sold", sold_team_id: "keen", sold_price: 10 }),
    ];
    const sums = new Map(teams.map((t) => [t.id, teamPoolSummary(t.id, "men", config, [], players)]));
    const st = state({ phase: "bidding", current_player_id: "wk", current_bid: 20, leading_team_id: "leader" });
    const rivals = rivalsFor(players[0], st, config, teams, sums, players, "me");
    // "keen" has bought players but no wicket-keeper yet.
    expect(rivals.map((r) => [r.team.id, r.maxBid, r.needsRole])).toEqual([
      ["rich", 80, false],
      ["keen", 80, true],
    ]);
  });
});
