// A small .xlsx reader: just enough to read the cell text of each sheet (no
// formulas, styles or images). Google Sheets' "Download as Excel" works.

import { strFromU8, unzipSync } from "fflate";

export interface Sheet {
  name: string;
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

/** Text of all <t> runs inside a string item, ignoring phonetic hints. */
function runText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const MAX_PART = 20 * 1024 * 1024;

export function readXlsx(data: Uint8Array): Sheet[] {
  const parts = unzipSync(data, {
    filter: (f) =>
      (f.name === "xl/workbook.xml" ||
        f.name === "xl/_rels/workbook.xml.rels" ||
        f.name === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/[^/]+\.xml$/.test(f.name)) &&
      f.originalSize <= MAX_PART &&
      (f.compression === 0 || f.compression === 8),
  });
  const text = (name: string) => (parts[name] ? strFromU8(parts[name]) : "");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("Not an Excel workbook");

  const targets = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]));

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const path = targets.get(attr(m[0], "r:id") ?? "");
    const xml = path ? text(path) : "";
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNum = Number(attr(r[0], "r")) || rows.length + 1;
      const cells: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(`<c${c[1]}>`, "r");
        const type = attr(`<c${c[1]}>`, "t");
        const body = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = runText(body);
        else if (v !== undefined) value = unescapeXml(v);
        const col = ref ? columnIndex(ref) : cells.length;
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      while (rows.length < rowNum - 1) rows.push([]);
      rows[rowNum - 1] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
