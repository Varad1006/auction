// Parses players pasted from a spreadsheet (tab-separated), CSV or
// pipe-separated text. A header row is optional; without one the columns are:
//   name, role, grade, batting style, bowling style, base price, notes
// Recognised header names: name, pool/gender, role, grade, batting, bowling,
// base/base price/price, notes/stats.

import { GRADES, PLAYER_ROLES, type Grade, type PlayerRole, type Pool } from "./types";

export interface ImportedPlayer {
  name: string;
  pool: Pool;
  role: PlayerRole;
  grade: Grade;
  batting_style: string | null;
  bowling_style: string | null;
  /** null = use the pool's base price for the grade */
  base_price: number | null;
  notes: string | null;
}

export interface ImportResult {
  players: ImportedPlayer[];
  errors: { line: number; message: string }[];
}

type Field = "name" | "pool" | "role" | "grade" | "batting" | "bowling" | "base" | "notes";

const DEFAULT_ORDER: Field[] = ["name", "role", "grade", "batting", "bowling", "base", "notes"];

const HEADER_ALIASES: Record<string, Field> = {
  name: "name", player: "name", "player name": "name", "full name": "name",
  pool: "pool", gender: "pool", category: "pool",
  role: "role", type: "role", speciality: "role", specialty: "role",
  grade: "grade", category_grade: "grade", tier: "grade",
  batting: "batting", bat: "batting", "batting style": "batting", "batting hand": "batting",
  bowling: "bowling", bowl: "bowling", "bowling style": "bowling",
  base: "base", "base price": "base", baseprice: "base", price: "base", "base_price": "base",
  notes: "notes", stats: "notes", note: "notes", remarks: "notes", "stats/notes": "notes",
};

export function normalizeRole(raw: string): PlayerRole | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (["wk", "wicketkeeper", "keeper", "wkbatter", "wkbat", "wicketkeeperbatter", "wkbatsman"].includes(s)) return "Wicket-keeper";
  if (["ar", "allrounder", "allround", "all"].includes(s)) return "All-rounder";
  if (["bat", "batter", "batsman", "batsmen", "batswoman", "batting"].includes(s)) return "Batter";
  if (["bowl", "bowler", "bowling"].includes(s)) return "Bowler";
  return PLAYER_ROLES.find((r) => r.toLowerCase().replace(/[^a-z]/g, "") === s) ?? null;
}

export function normalizePool(raw: string): Pool | null {
  const s = raw.trim().toLowerCase();
  if (["men", "m", "male", "boys", "boy", "mens", "men's"].includes(s)) return "men";
  if (["women", "w", "f", "female", "girls", "girl", "womens", "women's"].includes(s)) return "women";
  return null;
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter !== ",") return line.split(delimiter).map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parsePlayerImport(text: string, defaultPool: Pool): ImportResult {
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l, line: i + 1 })).filter((l) => l.text.trim() !== "");
  const result: ImportResult = { players: [], errors: [] };
  if (lines.length === 0) return result;

  const delimiter = lines.some((l) => l.text.includes("\t")) ? "\t" : lines.some((l) => l.text.includes("|")) ? "|" : ",";

  let order = DEFAULT_ORDER;
  const firstCells = splitLine(lines[0].text, delimiter).map((c) => c.toLowerCase().trim());
  const headerFields = firstCells.map((c) => HEADER_ALIASES[c]);
  if (headerFields.includes("name") && headerFields.filter(Boolean).length >= 2) {
    order = headerFields as Field[];
    lines.shift();
  }

  for (const { text: raw, line } of lines) {
    const cells = splitLine(raw, delimiter);
    const get = (f: Field) => {
      const idx = order.indexOf(f);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const name = get("name");
    if (!name) {
      result.errors.push({ line, message: "Missing name" });
      continue;
    }
    if (name.length > 80) {
      result.errors.push({ line, message: "Name is longer than 80 characters" });
      continue;
    }
    const role = normalizeRole(get("role"));
    if (!role) {
      result.errors.push({ line, message: `Unknown role "${get("role")}" (use Batter, Bowler, All-rounder or WK)` });
      continue;
    }
    const gradeRaw = get("grade").toUpperCase();
    if (!GRADES.includes(gradeRaw as Grade)) {
      result.errors.push({ line, message: `Grade must be A, B or C (got "${get("grade")}")` });
      continue;
    }
    let pool = defaultPool;
    if (get("pool")) {
      const p = normalizePool(get("pool"));
      if (!p) {
        result.errors.push({ line, message: `Unknown pool "${get("pool")}" (use men or women)` });
        continue;
      }
      pool = p;
    }
    let base: number | null = null;
    const baseRaw = get("base").replace(/[^\d]/g, "");
    if (get("base")) {
      if (!baseRaw) {
        result.errors.push({ line, message: `Base price "${get("base")}" is not a number` });
        continue;
      }
      base = Number(baseRaw);
    }
    const opt = (v: string, max: number) => (v ? v.slice(0, max) : null);
    result.players.push({
      name,
      pool,
      role,
      grade: gradeRaw as Grade,
      batting_style: opt(get("batting"), 40),
      bowling_style: opt(get("bowling"), 40),
      base_price: base,
      notes: opt(get("notes"), 500),
    });
  }
  return result;
}
