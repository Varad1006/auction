// Parses players pasted from a spreadsheet (tab-separated, e.g. copied from
// Google Sheets), CSV or pipe-separated text.
//
// With a header row (recommended, e.g. a Google Form responses sheet) columns
// are matched by keyword: name, gender/pool, role, grade, batting, bowling,
// base price, notes/stats, photo. Private columns (email, phone, timestamp,
// roll/ID numbers...) are ignored. Every other column is kept as a card
// detail ("Year: 3rd", "Branch: Civil", ...), which is shown publicly.
//
// Without a header the columns are:
//   name, role, grade, batting style, bowling style, base price, notes

import { photoUrlFrom } from "./photos";
import { GRADES, PLAYER_ROLES, type Grade, type PlayerDetail, type PlayerRole, type Pool } from "./types";

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
  photo_url: string | null;
  details: PlayerDetail[];
}

export interface ImportResult {
  players: ImportedPlayer[];
  errors: { line: number; message: string }[];
  /** How each header was used, for the preview. */
  columns: { header: string; use: string }[];
}

type Field = "name" | "pool" | "role" | "grade" | "batting" | "bowling" | "base" | "notes" | "photo" | "skip" | "detail";

const DEFAULT_ORDER: Field[] = ["name", "role", "grade", "batting", "bowling", "base", "notes"];

const PRIVATE = /e-?mail|phone|mobile|contact|whats ?app|timestamp|roll|prn|aadha?r|enrol|\bid\b|password|address|dob|date of birth|parent|guardian|upi|payment|transaction|fee|signature|declaration|agree|consent/;

/** Maps a header cell to a field by keyword. */
export function classifyHeader(raw: string): Field {
  const h = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!h) return "skip";
  if (PRIVATE.test(h)) return "skip";
  if (/photo|picture|image|pic\b|selfie/.test(h)) return "photo";
  if (/^(full |player |your )?name\b|name of (the )?player|^player$/.test(h)) return "name";
  if (/gender|^pool$|^sex$|men women|category/.test(h) && !/grade/.test(h)) return "pool";
  if (/grade|^tier$/.test(h)) return "grade";
  if (/base ?price|^base$|^price$/.test(h)) return "base";
  if (/batting|bat hand|batting hand|^bat$/.test(h)) return "batting";
  if (/bowling|^bowl$/.test(h)) return "bowling";
  if (/role|speciali|specialty|you play as|playing as|^type$/.test(h)) return "role";
  if (/^notes?$|remarks?|^stats$|stats notes|about/.test(h)) return "notes";
  return "detail";
}

export function normalizeRole(raw: string): PlayerRole | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s.includes("keep") || s.startsWith("wk")) return "Wicket-keeper";
  if (s.includes("allround") || s === "ar" || s === "all") return "All-rounder";
  if (s.includes("bowl")) return "Bowler";
  if (s.includes("bat")) return "Batter";
  return PLAYER_ROLES.find((r) => r.toLowerCase().replace(/[^a-z]/g, "") === s) ?? null;
}

export function normalizePool(raw: string): Pool | null {
  const s = raw.trim().toLowerCase();
  if (["men", "m", "male", "boys", "boy", "mens", "men's", "man"].includes(s)) return "men";
  if (["women", "w", "f", "female", "girls", "girl", "womens", "women's", "woman"].includes(s)) return "women";
  return null;
}

/** Splits delimited text into rows of cells, honouring quotes (incl. newlines inside quotes). */
export function parseDelimited(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === delimiter) {
      cells.push(cur.trim());
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cur.trim());
      if (cells.some((c) => c !== "")) rows.push({ cells, line: rowLine });
      cells = [];
      cur = "";
      line++;
      rowLine = line;
    } else cur += ch;
  }
  cells.push(cur.trim());
  if (cells.some((c) => c !== "")) rows.push({ cells, line: rowLine });
  return rows;
}

export function parsePlayerImport(text: string, defaultPool: Pool): ImportResult {
  const result: ImportResult = { players: [], errors: [], columns: [] };
  if (!text.trim()) return result;
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = text.includes("\t") ? "\t" : firstLine.includes("|") ? "|" : ",";
  const rows = parseDelimited(text, delimiter);
  if (rows.length === 0) return result;

  let order: Field[] = DEFAULT_ORDER;
  let headers: string[] = [];
  const classified = rows[0].cells.map(classifyHeader);
  if (classified.includes("name") && classified.filter((f) => f !== "detail").length >= 2) {
    order = classified;
    headers = rows[0].cells;
    result.columns = headers.map((h, i) => ({
      header: h,
      use: classified[i] === "skip" ? "ignored (private)" : classified[i] === "detail" ? "card detail" : classified[i],
    }));
    rows.shift();
  }
  const hasColumn = (f: Field) => order.includes(f);

  for (const { cells, line } of rows) {
    const get = (f: Field) => {
      const idx = order.indexOf(f);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const name = get("name").replace(/\s+/g, " ");
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
    // Registration forms usually have no grade; organisers set it later.
    const gradeRaw = get("grade").toUpperCase().replace(/^GRADE\s*/, "");
    if (hasColumn("grade") && gradeRaw && !GRADES.includes(gradeRaw as Grade)) {
      result.errors.push({ line, message: `Grade must be A, B or C (got "${get("grade")}")` });
      continue;
    }
    const grade = (GRADES.includes(gradeRaw as Grade) ? gradeRaw : "C") as Grade;
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
    if (get("base")) {
      const baseRaw = get("base").replace(/[^\d]/g, "");
      if (!baseRaw) {
        result.errors.push({ line, message: `Base price "${get("base")}" is not a number` });
        continue;
      }
      base = Number(baseRaw);
    }
    const details: PlayerDetail[] = [];
    order.forEach((f, i) => {
      const value = (cells[i] ?? "").trim();
      if (f === "detail" && value && headers[i]) {
        details.push({ label: headers[i].slice(0, 60), value: value.slice(0, 300) });
      }
    });
    const opt = (v: string, max: number) => (v ? v.slice(0, max) : null);
    result.players.push({
      name,
      pool,
      role,
      grade,
      batting_style: opt(get("batting"), 40),
      bowling_style: opt(get("bowling"), 40),
      base_price: base,
      notes: opt(get("notes"), 500),
      photo_url: photoUrlFrom(get("photo")),
      details: details.slice(0, 20),
    });
  }
  return result;
}
