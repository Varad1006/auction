import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parsePriceCsv, parsePriceTable, parsePriceWorkbook } from "@/lib/price-lists";
import { historyLine, priceHistory, seasonAverages, valuePool, type PastPrice, type ValuationPlayer } from "@/lib/valuation";
import { readXlsx } from "@/lib/xlsx";

// Made-up players and prices (real data stays out of the repo).

/** A workbook shaped like Google Sheets' "Download as Excel". */
function workbook(): Uint8Array {
  const shared = ["Summary", "Full Name", "Gender", "P2 Royals", "Sold For", "Arjun Kale", "M", "Bina &amp; Co", "Unsold", "Chirag Desai"];
  const si = shared.map((t, i) => (i === 3 ? `<si><r><t>P2 </t></r><r><rPr/><t>Royals</t></r><rPh><t>x</t></rPh></si>` : `<si><t>${t}</t></si>`)).join("");
  const cell = (ref: string, v: string, t?: string) => (t === "inlineStr" ? `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>` : `<c r="${ref}"${t ? ` t="${t}"` : ""}><v>${v}</v></c>`);
  const players = [
    `<row r="1">${cell("A1", "0", "s")}</row>`,
    // Header on row 3; column C is empty, and the team column is headed with a team's name.
    `<row r="3">${cell("A3", "1", "s")}${cell("B3", "2", "s")}${cell("D3", "3", "s")}${cell("E3", "4", "s")}</row>`,
    `<row r="4">${cell("A4", "5", "s")}${cell("B4", "6", "s")}${cell("D4", "Super Kings", "inlineStr")}${cell("E4", "17000")}</row>`,
    `<row r="5">${cell("A5", "7", "s")}${cell("B5", "Female", "inlineStr")}${cell("D5", "8", "s")}<c r="E5"/></row>`,
    `<row r="6">${cell("A6", "9", "s")}${cell("B6", "Male", "inlineStr")}${cell("D6", "P2 Indians", "inlineStr")}${cell("E6", "4500.0")}</row>`,
  ].join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Players list" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(`<sst>${si}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1">${cell("A1", "0", "s")}</row></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet><sheetData>${players}</sheetData></worksheet>`),
    "xl/media/image1.png": new Uint8Array(1000),
  });
}

describe("price lists", () => {
  it("reads the cells of an Excel workbook", () => {
    const sheets = readXlsx(workbook());
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Players list"]);
    const rows = sheets[1].rows;
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["Full Name", "Gender", "", "P2 Royals", "Sold For"]);
    expect(rows[3]).toEqual(["Arjun Kale", "M", "", "Super Kings", "17000"]);
    expect(rows[4]).toEqual(["Bina & Co", "Female", "", "Unsold", ""]);
    expect(() => readXlsx(zipSync({ "a.txt": strToU8("x") }))).toThrow();
  });

  it("takes the players tab: names, pools, teams and prices", () => {
    const parsed = parsePriceWorkbook(readXlsx(workbook()));
    expect(parsed.sheet).toBe("Players list");
    expect(parsed.rows).toEqual([
      { pool: "men", name: "Arjun Kale", team: "Super Kings", price: 17000 },
      { pool: "women", name: "Bina & Co", team: "Unsold", price: 0 },
      { pool: "men", name: "Chirag Desai", team: "P2 Indians", price: 4500 },
    ]);
  });

  it("reads a CSV, telling the pool from the price column when there's no gender", () => {
    const csv = "﻿Sr,Name,Phone,Team,Male Sold For,Female Sold For\n1,Arjun Kale,99999,P2 Royals,\"₹ 12,500\",\n2,Bina Rao,88888,P2 Indians,,6000\n3,Nobody,77777,Unsold,,\n";
    expect(parsePriceCsv(csv).rows).toEqual([
      { pool: "men", name: "Arjun Kale", team: "P2 Royals", price: 12500 },
      { pool: "women", name: "Bina Rao", team: "P2 Indians", price: 6000 },
    ]);
    expect(parsePriceTable([["Player", "Phone"], ["A", "1"]]).error).toMatch(/No header row/);
  });
});

describe("price guide", () => {
  const past: PastPrice[] = [
    // Season 1 men average 10,000; season 2 men average 20,000.
    ...[6000, 8000, 10000, 12000, 14000].map((price, i) => ({ season: 1, pool: "men" as const, name: `Old Player ${i}`, team: "P2 Royals", price })),
    { season: 1, pool: "men", name: "Arjun Kale", team: "P2 Royals", price: 20000 },
    { season: 1, pool: "men", name: "Chirag Desai", team: null, price: 0 },
    ...[10000, 15000, 20000, 25000, 30000].map((price, i) => ({ season: 2, pool: "men" as const, name: `New Player ${i}`, team: "P2 Indians", price })),
    { season: 2, pool: "men", name: "Arjun S. Kale", team: "P2 Indians", price: 40000 },
    { season: 2, pool: "men", name: "Dev Shah", team: "P2 Indians", price: 10000 },
    // Too few women's prices for an average.
    { season: 2, pool: "women", name: "Bina Rao", team: "P2 Indians", price: 9000 },
  ];

  it("compares prices with each season's average", () => {
    const averages = seasonAverages(past);
    expect(averages.get("1|men")).toBeCloseTo(11666.67, 1);
    expect(averages.has("2|women")).toBe(false);
    const history = priceHistory({ name: "Arjun Kale", pool: "men" }, past, averages);
    // "Arjun S. Kale" is matched by first and last name.
    expect(history.map((h) => [h.season, h.price])).toEqual([
      [2, 40000],
      [1, 20000],
    ]);
    expect(history[0].ratio).toBeCloseTo(40000 / (150000 / 7), 3);
    expect(priceHistory({ name: "Bina Rao", pool: "women" }, past, averages)).toEqual([]);
    expect(priceHistory({ name: "Dev Shah", pool: "women" }, past, averages)).toEqual([]);
    expect(priceHistory({ name: "Chirag Desai", pool: "men" }, past, averages)).toEqual([]);
    expect(historyLine({ season: 2, price: 17000, team: "P2 Indians", ratio: 1.42 })).toBe("Sold for 17,000 in PPL 2 to P2 Indians (1.4× that season's average)");
    expect(historyLine({ season: 1, price: 5000, team: "Unsold", ratio: 0.5 })).toBe("Sold for 5,000 in PPL 1 (0.5× that season's average)");
  });

  const player = (id: string, name: string, extra: Partial<ValuationPlayer> = {}): ValuationPlayer => ({
    id,
    name,
    pool: "men",
    basePrice: 4000,
    stats: null,
    availableDays: null,
    ...extra,
  });
  const players = [
    player("a", "Arjun Kale"),
    player("d", "Dev Shah"),
    player("n0", "New Player 0"),
    player("n2", "New Player 2"),
    player("n4", "New Player 4"),
    player("n4-away", "Old Player 4", { availableDays: 1 }),
    player("x", "Unknown One"),
    player("y", "Unknown Two"),
  ];
  const market = { purse: 120000, slots: 6, maxBid: 45000, step: 500, matchDays: 4 };

  it("prices the pool so the open places add up to the purse", () => {
    const v = valuePool(players, past, market);
    const fair = players.map((p) => v.get(p.id)!.fair).sort((a, b) => b - a);
    const top = fair.slice(0, market.slots).reduce((s, n) => s + n, 0);
    expect(Math.abs(top - market.purse)).toBeLessThanOrEqual(market.step * market.slots);
    for (const p of players) {
      const x = v.get(p.id)!;
      expect(x.fair % 500).toBe(0);
      expect(x.floor).toBeGreaterThanOrEqual(4000);
      expect(x.floor).toBeLessThanOrEqual(x.fair);
      expect(x.stretch).toBeGreaterThanOrEqual(x.fair);
      expect(x.stretch).toBeLessThanOrEqual(market.maxBid);
    }
    // The dearest last time is the dearest now; nothing known means base price.
    expect(v.get("a")).toMatchObject({ tier: "marquee", confidence: "medium" });
    expect(v.get("a")!.fair).toBe(fair[0]);
    expect(v.get("n4")!.fair).toBeGreaterThan(v.get("n2")!.fair);
    expect(v.get("n2")!.fair).toBeGreaterThan(v.get("n0")!.fair);
    expect(v.get("x")).toMatchObject({ floor: 4000, fair: 4000, tier: "unknown", confidence: "low", ratio: null });
  });

  it("marks down players who can't make most match days", () => {
    const v = valuePool(players, past, market);
    // Similar ratios (14,000 of ~11,667 vs 30,000 of ~21,429), but available 1 day of 4.
    expect(v.get("n4-away")!.fair).toBeLessThan(v.get("n4")!.fair * 0.8);
  });

  it("falls back to base price when there's nothing left to fill", () => {
    const v = valuePool(players, past, { ...market, slots: 0 });
    expect(new Set(players.map((p) => v.get(p.id)!.fair))).toEqual(new Set([4000]));
    const broke = valuePool(players, past, { ...market, purse: 10000 });
    expect(broke.get("a")!.fair).toBe(4000);
  });
});
