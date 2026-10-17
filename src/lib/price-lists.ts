// Previous auctions' prices from the organisers' tracker sheets (the
// "Players list" tab, as .xlsx or .csv). Only name, gender, team and price
// are read; contact details and everything else in the sheet are ignored.

import { parseDelimited } from "./import";
import { nameKey } from "./stats-import";
import type { Pool } from "./types";
import type { Sheet } from "./xlsx";

export interface PastPriceRow {
  pool: Pool;
  name: string;
  team: string | null;
  /** 0 = not sold in the auction (owner, icon player, unsold). */
  price: number;
}

const money = (raw: string | undefined): number => {
  const n = Number(String(raw ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

function genderPool(raw: string | undefined): Pool | null {
  const g = String(raw ?? "").trim().toLowerCase();
  if (/^(m|male|man|men|boy)$/.test(g)) return "men";
  if (/^(f|female|woman|women|girl)$/.test(g)) return "women";
  return null;
}

/** Reads a table (rows of cells) with a header row somewhere near the top. */
export function parsePriceTable(rows: string[][]): { rows: PastPriceRow[]; error: string | null } {
  const headerAt = rows.slice(0, 15).findIndex((r) => r.some((c) => /full\s*name|^\s*name\s*$/i.test(c)) && r.some((c) => /sold|price/i.test(c)));
  if (headerAt < 0) return { rows: [], error: "No header row with a name column and a sold price column" };
  const head = rows[headerAt].map((h) => h.trim());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const nameCol = find(/full\s*name/i) >= 0 ? find(/full\s*name/i) : find(/^name$/i);
  const genderCol = find(/gender|^sex$/i);
  const priceCols = head.map((h, i) => (/sold|price/i.test(h) ? i : -1)).filter((i) => i >= 0);
  // The team column is sometimes headed with a team's name instead of "Team".
  let teamCol = find(/team/i);
  if (teamCol < 0 && priceCols[0] > 0) teamCol = priceCols[0] - 1;

  const out: PastPriceRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = (r[nameCol] ?? "").replace(/\s+/g, " ").trim();
    if (!name || !nameKey(name)) continue;
    const prices = priceCols.map((i) => ({ header: head[i], value: money(r[i]) }));
    const price = Math.max(0, ...prices.map((p) => p.value));
    // Without a gender column, "Male ... Sold For" / "Female ... Sold For" tells.
    const byColumn = prices.find((p) => p.value > 0)?.header ?? "";
    const pool = genderPool(r[genderCol]) ?? (/female|women/i.test(byColumn) ? "women" : /male|men/i.test(byColumn) ? "men" : null);
    if (!pool) continue;
    const team = teamCol >= 0 ? (r[teamCol] ?? "").trim() || null : null;
    out.push({ pool, name: name.slice(0, 120), team: team && !/^\d+$/.test(team) ? team.slice(0, 80) : null, price });
  }
  return { rows: out, error: out.length ? null : "No players found under the header row" };
}

/** Picks the players tab of a workbook ("Players list" if it exists). */
export function parsePriceWorkbook(sheets: Sheet[]): { rows: PastPriceRow[]; sheet: string | null; error: string | null } {
  const ordered = [...sheets.filter((s) => /players?\s*list/i.test(s.name)), ...sheets.filter((s) => !/players?\s*list/i.test(s.name))];
  let firstError: string | null = null;
  for (const s of ordered) {
    const parsed = parsePriceTable(s.rows);
    if (parsed.rows.length) return { rows: parsed.rows, sheet: s.name, error: null };
    firstError ??= parsed.error;
  }
  return { rows: [], sheet: null, error: firstError ?? "The workbook has no sheets" };
}

export function parsePriceCsv(text: string): { rows: PastPriceRow[]; error: string | null } {
  return parsePriceTable(parseDelimited(text.replace(/^﻿/, ""), ",").map((r) => r.cells));
}
