import { describe, expect, it } from "vitest";
import { bidAdvice, fillsNeed, rivalWatch, squadCheck } from "@/lib/advisor";
import type { PlayerInsight } from "@/lib/insights";
import { teamPoolSummary } from "@/lib/rules";
import type { AuctionState, Player, PoolConfig, Team } from "@/lib/types";
import type { WishlistEntry } from "@/lib/wishlist";

const config: PoolConfig = {
  pool: "men", label: "Men", purse: 1000, min_squad: 4, max_squad: 5,
  base_price_a: 20, base_price_b: 20, base_price_c: 20,
  increment_tiers: [{ from: 0, step: 10 }, { from: 200, step: 25 }],
  current_round: 1, updated_at: "",
};

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id, name: id.toUpperCase(), pool: "men", role: "Batter", batting_style: null, bowling_style: null,
  grade: "C", base_price: 20, photo_url: null, notes: null, details: [], status: "pool", sold_team_id: null,
  sold_price: null, decided_round: null, waitlisted_at: null, signing: null, created_at: "", updated_at: "", ...over,
});
const sold = (id: string, team: string, price: number, over: Partial<Player> = {}) => player(id, { status: "sold", sold_team_id: team, sold_price: price, ...over });

const state = (over: Partial<AuctionState> = {}): AuctionState => ({
  id: 1, current_pool: "men", phase: "revealed", current_player_id: "k", current_bid: null,
  leading_team_id: null, bid_count: 0, spin_candidates: null, spin_started_at: null,
  spin_duration_ms: 6000, last_result_id: null, version: 1, updated_at: "", ...over,
});
const entry = (over: Partial<WishlistEntry> = {}): WishlistEntry => ({
  player_id: "k", priority: 2, max_price: null, note: null, created_at: "", updated_at: "", ...over,
});
const insight = (over: Partial<PlayerInsight> = {}): PlayerInsight => ({
  playerId: "k", summary: "Safe hands.", strengths: [], concerns: [], roleFit: null, tier: "premium",
  priceFloor: 150, priceFair: 200, priceStretch: 260, confidence: "high", generatedAt: "2026-10-01", hasNote: true,
  history: ["Sold for 9,000 in PPL 2 (1.2× that season's average)"], statLines: [], cricheroes: [], cricheroesUrl: null, ...over,
});
const team = (id: string): Team => ({ id, name: id.toUpperCase(), short_name: id, color: "#000000", sort_order: 0, created_at: "" });
const teams = [team("t1"), team("t2"), team("t3")];

// t1 (us): a playing owner, the star and one buy. t2: four buys, one place left. t3: nothing yet.
const players = [
  sold("owner", "t1", 100, { signing: "owner" }),
  sold("star", "t1", 150, { signing: "star", role: "Bowler" }),
  sold("b1", "t1", 100),
  ...["x1", "x2", "x3", "x4"].map((id) => sold(id, "t2", 150)),
  player("k", { role: "Wicket-keeper" }),
  player("big", { role: "Wicket-keeper" }),
];
const summaries = new Map(teams.map((t) => [t.id, teamPoolSummary(t.id, "men", config, [], players)]));
const mine = summaries.get("t1")!;
const squad = squadCheck(mine, players, "t1", "men");
const k = players.find((p) => p.id === "k")!;

const advise = (over: { s?: AuctionState; insight?: PlayerInsight | null; entry?: WishlistEntry | null; player?: Player } = {}) => {
  const s = over.s ?? state();
  const p = over.player ?? k;
  const rivals = rivalWatch({ teams, summaries, players, pool: "men", teamId: "t1", player: p, state: s, config });
  return bidAdvice({ player: p, state: s, config, teamId: "t1", mine, squad, insight: over.insight === undefined ? insight() : over.insight, entry: over.entry ?? null, rivals });
};

describe("squad check", () => {
  it("counts owners and the star, and says what's missing", () => {
    expect(squad).toMatchObject({ bought: 1, owners: 1, stars: 1, teamSize: 7, toMin: 3, toMax: 4, remaining: 650, maxBid: 610, perPlayer: 216, tight: false });
    expect(squad.roles).toEqual({ Batter: 2, Bowler: 1, "All-rounder": 0, "Wicket-keeper": 0 });
    expect(squad.needs.map((n) => n.label)).toEqual(["a wicket-keeper", "2 more bowling options", "1 more batter"]);
    expect(fillsNeed("All-rounder", squad.needs)?.kind).toBe("bowling");
    expect(fillsNeed("Wicket-keeper", squad.needs)?.kind).toBe("keeper");
  });

  it("has no needs once the squad is full", () => {
    const more = [...players, sold("x5", "t2", 10)];
    const full = squadCheck(teamPoolSummary("t2", "men", config, [], more), more, "t2", "men");
    expect(full.toMax).toBe(0);
    expect(full.needs).toEqual([]);
  });
});

describe("bid advice", () => {
  it("goes to the fair price for a player who fills a gap", () => {
    const a = advise();
    expect(a).toMatchObject({ verdict: "bid", limit: 200, next: 20, opening: true, headline: "Go up to 200 pts" });
    expect(a.reasons).toContain("Price guide: fair 200 pts, likely 150 pts–260 pts (with the AI's view).");
    expect(a.reasons).toContain("Sold for 9,000 in PPL 2 (1.2× that season's average).");
    expect(a.reasons).toContain("Not on your wishlist.");
    expect(a.reasons).toContain("Fills a gap: your squad needs a wicket-keeper.");
    expect(a.reasons).toContain("2 rivals can go past 200 pts: T3, T2; T3 needs a player like this.");
  });

  it("follows the wishlist: the owner's max first, then priority", () => {
    expect(advise({ entry: entry({ max_price: 330 }) }).limit).toBe(325); // on the 25 step
    expect(advise({ entry: entry({ priority: 1 }) }).limit).toBe(250); // stretch 260, on the step
    expect(advise({ entry: entry({ priority: 3 }) }).limit).toBe(150); // floor
    expect(advise({ entry: entry({ priority: 1, max_price: 400 }) }).reasons).toContain("On your wishlist as Must-have with your max at 400 pts.");
  });

  it("keeps money for the places still to fill", () => {
    const a = advise({ player: players.find((p) => p.id === "big")!, insight: insight({ playerId: "big", priceFloor: 450, priceFair: 600, priceStretch: 780 }) });
    expect(a.limit).toBe(450); // capped at max(2 × 216, floor 450)
    expect(a.reasons).toContain("Kept to about twice your average per place (216 pts) so you can still fill 3 places.");
    const must = advise({ player: players.find((p) => p.id === "big")!, insight: insight({ priceFair: 600, priceStretch: 780 }), entry: entry({ player_id: "big", priority: 1 }) });
    expect(must.limit).toBe(600); // a must-have isn't capped, but can't pass the max bid (610) on the step
    expect(must.reasons).toContain("The most you can bid now is 610 pts; the rest is kept for your other places.");
  });

  it("says when to let go, when you're leading and when you can't afford it", () => {
    expect(advise({ s: state({ phase: "bidding", current_bid: 300, leading_team_id: "t3" }) })).toMatchObject({
      verdict: "let-go",
      next: 325,
      opening: false,
      headline: "Let go: bidding is past your limit of 200 pts",
    });
    expect(advise({ s: state({ phase: "bidding", current_bid: 150, leading_team_id: "t1" }) })).toMatchObject({ verdict: "leading", headline: "You're leading at 150 pts. Your limit is 200 pts" });
    expect(advise({ s: state({ phase: "bidding", current_bid: 700, leading_team_id: "t3" }) })).toMatchObject({ verdict: "cant-afford", next: 725, limit: 610 });
  });

  it("goes by base price without a price guide", () => {
    const a = advise({ insight: null });
    expect(a.limit).toBe(20);
    expect(a.reasons[0]).toBe("No price guide for this player yet: going by base price.");
  });

  it("knows when the squad is full", () => {
    const full = teamPoolSummary("t1", "men", { ...config, max_squad: 1 }, [], players);
    const s = state();
    const a = bidAdvice({ player: k, state: s, config, teamId: "t1", mine: full, squad, insight: insight(), entry: null, rivals: [] });
    expect(a).toMatchObject({ verdict: "full", limit: null });
  });
});

describe("rival watch", () => {
  it("puts the leader and the teams who can still bid first", () => {
    const s = state({ phase: "bidding", current_bid: 300, leading_team_id: "t3" });
    const r = rivalWatch({ teams, summaries, players, pool: "men", teamId: "t1", player: k, state: s, config });
    expect(r.map((x) => [x.team.id, x.leading, x.canBid, x.maxBid, x.placesLeft])).toEqual([
      ["t3", true, false, 940, 5],
      ["t2", false, true, 400, 1],
    ]);
    expect(r[1].needs.map((n) => n.label)).toEqual(["2 more bowling options"]);
  });

  it("without a player on the block, shows every rival's money and places", () => {
    const r = rivalWatch({ teams, summaries, players, pool: "men", teamId: "t1" });
    expect(r.map((x) => [x.team.id, x.remaining, x.canBid])).toEqual([
      ["t3", 1000, false],
      ["t2", 400, false],
    ]);
  });
});
