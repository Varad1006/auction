import { describe, expect, it } from "vitest";
import { classifyHeader, parsePlayerImport, normalizeRole } from "@/lib/import";
import { photoUrlFrom } from "@/lib/photos";
import { checkBid, incrementFor, minNextBid, parseIncrementTiers, quickBidAmounts, teamPoolSummary } from "@/lib/rules";
import type { AuctionState, Player, PoolConfig } from "@/lib/types";

const config: PoolConfig = {
  pool: "men", label: "Men", purse: 100, min_squad: 3, max_squad: 4,
  base_price_a: 50, base_price_b: 30, base_price_c: 20,
  increment_tiers: [{ from: 0, step: 5 }, { from: 100, step: 20 }],
  current_round: 1, updated_at: "",
};

const player = (over: Partial<Player> = {}): Player => ({
  id: "p1", name: "P", pool: "men", role: "Batter", batting_style: null, bowling_style: null,
  grade: "C", base_price: 20, photo_url: null, notes: null, details: [], status: "pool", sold_team_id: null,
  sold_price: null, decided_round: null, created_at: "", updated_at: "", ...over,
});

const state = (over: Partial<AuctionState> = {}): AuctionState => ({
  id: 1, current_pool: "men", phase: "bidding", current_player_id: "p1", current_bid: null,
  leading_team_id: null, bid_count: 0, spin_candidates: null, spin_started_at: null,
  spin_duration_ms: 6000, last_result_id: null, version: 1, updated_at: "", ...over,
});

describe("bid rules (mirror of SQL)", () => {
  it("picks the increment tier by current bid", () => {
    expect(incrementFor(config.increment_tiers, 0)).toBe(5);
    expect(incrementFor(config.increment_tiers, 99)).toBe(5);
    expect(incrementFor(config.increment_tiers, 100)).toBe(20);
  });

  it("computes the next minimum bid", () => {
    expect(minNextBid(state(), player(), config)).toBe(20);
    expect(minNextBid(state({ current_bid: 40 }), player(), config)).toBe(45);
    expect(minNextBid(state({ current_bid: 100 }), player(), config)).toBe(120);
  });

  it("computes the reserve-limited max bid", () => {
    const s = teamPoolSummary("t1", "men", config, [], [player({ id: "x", status: "sold", sold_team_id: "t1", sold_price: 10 })]);
    // remaining 90, after this buy 1 more slot needed at 20 -> max 70
    expect(s).toMatchObject({ remaining: 90, squadCount: 1, maxBid: 70 });
  });

  it("applies per-team overrides", () => {
    const s = teamPoolSummary("t1", "men", config, [{ team_id: "t1", pool: "men", purse: 500, min_squad: 0, max_squad: null }], []);
    expect(s).toMatchObject({ purse: 500, minSquad: 0, maxSquad: 4, maxBid: 500 });
  });

  it("blocks bids in the same order as the server", () => {
    const summary = teamPoolSummary("t1", "men", config, [], []);
    expect(checkBid(20, "t1", state({ phase: "revealed" }), player(), config, summary)).toMatchObject({ code: "not_bidding" });
    expect(checkBid(25, "t1", state({ current_bid: 20, leading_team_id: "t1" }), player(), config, summary)).toMatchObject({ code: "already_leading" });
    expect(checkBid(22, "t1", state({ current_bid: 20, leading_team_id: "t2" }), player(), config, summary)).toMatchObject({ code: "too_low" });
    expect(checkBid(65, "t1", state(), player(), config, summary)).toMatchObject({ code: "reserve" });
    expect(checkBid(60, "t1", state(), player(), config, summary)).toEqual({ ok: true });
  });

  it("offers quick-bid amounts that cross tier boundaries correctly", () => {
    expect(quickBidAmounts(state({ current_bid: 90 }), player(), config)).toEqual([95, 100, 140]);
  });

  it("parses increment tier text", () => {
    expect(parseIncrementTiers("5")).toEqual([{ from: 0, step: 5 }]);
    expect(parseIncrementTiers("100:10, 0:5")).toEqual([{ from: 0, step: 5 }, { from: 100, step: 10 }]);
    expect(parseIncrementTiers("50:10")).toEqual([{ from: 0, step: 10 }, { from: 50, step: 10 }]);
    expect(parseIncrementTiers("abc")).toBeNull();
    expect(parseIncrementTiers("0:0")).toBeNull();
  });
});

describe("bulk import", () => {
  it("parses tab-separated rows with a header", () => {
    const text = "Name\tRole\tGrade\tBatting\tBowling\tBase Price\tNotes\nRohit S\tbat\ta\tRHB\t\t\tOpener\nAnu K\tWK\tB\tLHB\t\t40\t";
    const r = parsePlayerImport(text, "men");
    expect(r.errors).toEqual([]);
    expect(r.players).toEqual([
      { name: "Rohit S", pool: "men", role: "Batter", grade: "A", batting_style: "RHB", bowling_style: null, base_price: null, notes: "Opener", photo_url: null, details: [] },
      { name: "Anu K", pool: "men", role: "Wicket-keeper", grade: "B", batting_style: "LHB", bowling_style: null, base_price: 40, notes: null, photo_url: null, details: [] },
    ]);
  });

  it("parses headerless CSV with quotes and a pool column via header", () => {
    const r = parsePlayerImport('"Doe, Jane",All rounder,C,RHB,"Right-arm, medium",,"Scored 50"', "women");
    expect(r.players[0]).toMatchObject({ name: "Doe, Jane", role: "All-rounder", pool: "women", bowling_style: "Right-arm, medium", notes: "Scored 50" });
    const withPool = parsePlayerImport("name|gender|role|grade\nX|F|Bowler|C", "men");
    expect(withPool.players[0]).toMatchObject({ pool: "women", role: "Bowler" });
  });

  it("reports bad rows with line numbers and keeps good ones", () => {
    const r = parsePlayerImport("A,Batter,A\nB,Spinner,A\nC,Bowler,Z\n,Bowler,A", "men");
    expect(r.players.map((p) => p.name)).toEqual(["A"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });

  it("normalises role spellings", () => {
    expect(["batsman", "Bowl", "AR", "all-rounder", "Wicket Keeper", "wk-batter"].map(normalizeRole)).toEqual([
      "Batter", "Bowler", "All-rounder", "All-rounder", "Wicket-keeper", "Wicket-keeper",
    ]);
  });

  it("imports a Google Form responses sheet: keyword headers, private columns skipped, extras kept", () => {
    const text = [
      "Timestamp\tEmail Address\tFull Name\tGender\tMobile Number\tYear\tBranch\tPlaying Role\tBatting Style\tBowling Style\tUpload your photo\tAchievements",
      '9/1/2025 10:00\ta@x.com\tRohan Patil\tMale\t9999999999\tTE\tCivil\tWicket Keeper Batsman\tRight-hand\tNone\thttps://drive.google.com/open?id=1AbCdEfGhIjKlMnOp\t"Captain 2024\nMoM in final"',
    ].join("\n");
    const r = parsePlayerImport(text, "women");
    expect(r.errors).toEqual([]);
    expect(r.players[0]).toMatchObject({
      name: "Rohan Patil",
      pool: "men",
      role: "Wicket-keeper",
      grade: "C",
      batting_style: "Right-hand",
      photo_url: "https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOp=w800",
      details: [
        { label: "Year", value: "TE" },
        { label: "Branch", value: "Civil" },
        { label: "Achievements", value: "Captain 2024\nMoM in final" },
      ],
    });
    // Private columns never reach the (public) details.
    expect(JSON.stringify(r.players[0])).not.toMatch(/a@x\.com|9999999999/);
    expect(r.columns.find((c) => c.header === "Email Address")?.use).toBe("ignored (private)");
  });

  it("classifies headers and converts photo links", () => {
    expect(["Full Name", "Gender", "Roll No", "WhatsApp number", "Speciality", "Photo"].map(classifyHeader)).toEqual([
      "name", "pool", "skip", "skip", "role", "photo",
    ]);
    expect(photoUrlFrom("https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLk/view?usp=drivesdk")).toBe(
      "https://lh3.googleusercontent.com/d/1ZyXwVuTsRqPoNmLk=w800",
    );
    expect(photoUrlFrom("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(photoUrlFrom("not a link")).toBeNull();
  });
});
