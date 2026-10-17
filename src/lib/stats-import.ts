// Reads previous seasons' stats from the files the organisers export:
//   - all_players.json: one record per auction player with their CricHeroes
//     profile stats (career "OVERALL" and "TENNIS BALL" tables), and
//   - pplN_{batting,bowling,fielding,mvp}_leaderboard.csv: the tournament's
//     own leaderboards for season N, keyed by CricHeroes player id (MVP by name).
// Pure functions only, so it can be unit-tested without a database.

import { parseDelimited } from "./import";

export type Num = number | null;

export interface CareerTable {
  batting?: { matches: Num; innings: Num; notOut: Num; runs: Num; highest: string | null; average: Num; strikeRate: Num; fifties: Num; thirties: Num; fours: Num; sixes: Num; ducks: Num };
  bowling?: { matches: Num; innings: Num; overs: Num; runs: Num; wickets: Num; best: string | null; economy: Num; strikeRate: Num; average: Num; dots: Num; wides: Num; noBalls: Num };
  fielding?: { matches: Num; catches: Num; runOuts: Num; stumpings: Num };
  captain?: { matches: Num; winPct: Num };
}

export interface SeasonStats {
  season: number;
  team: string | null;
  batting?: { matches: Num; innings: Num; runs: Num; highest: Num; average: Num; notOut: Num; strikeRate: Num; balls: Num; fours: Num; sixes: Num; fifties: Num; runsRank: string };
  bowling?: { matches: Num; overs: Num; wickets: Num; runs: Num; economy: Num; strikeRate: Num; average: Num; dots: Num; maidens: Num; best: Num; wicketsRank: string };
  fielding?: { matches: Num; catches: Num; runOuts: Num; stumpings: Num; dismissals: Num };
  mvp?: { matches: Num; batting: Num; bowling: Num; fielding: Num; total: Num; role: string | null; rank: string };
}

export interface PlayerStats {
  cricheroesId: string | null;
  career: { overall?: CareerTable; tennis?: CareerTable };
  seasons: SeasonStats[];
}

/** One player from all_players.json with their stats joined from the leaderboards. */
export interface ImportedPlayer {
  /** The auction's player id, when the file has it. */
  id: string | null;
  name: string;
  pool: string | null;
  cricheroesUrl: string | null;
  stats: PlayerStats;
}

export interface StatsImport {
  players: ImportedPlayer[];
  seasons: number[];
  /** Problems worth showing the admin (unreadable files, etc.). */
  warnings: string[];
}

const num = (raw: unknown): Num => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[*%,]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const text = (raw: unknown): string | null => {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  return s === "" || s === "-" || s.toLowerCase() === "none" ? null : s;
};

/** "Rohan  Mehta" and "rohan mehta" are the same name. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

export function cricheroesId(url: string | null | undefined): string | null {
  const m = /player-profile\/(\d+)/.exec(url ?? "");
  return m ? m[1] : null;
}

type Tab = { tables?: { section?: string; rows?: unknown[][] }[] };

/** The "Total" row of a section, keyed by the section's column headings. */
function totalRow(tab: Tab | undefined, section: string): Record<string, string> | null {
  const table = tab?.tables?.find((t) => (t.section ?? "").toUpperCase() === section);
  const rows = table?.rows ?? [];
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => String(h ?? "").trim());
  const total = rows.find((r, i) => i > 0 && String(r[0] ?? "").trim().toLowerCase() === "total") ?? (rows.length === 2 ? rows[1] : null);
  if (!total) return null;
  return Object.fromEntries(head.map((h, i) => [h, String(total[i] ?? "")]));
}

function careerTable(tabs: Record<string, Tab> | undefined, section: string): CareerTable | undefined {
  if (!tabs) return undefined;
  const bat = totalRow(tabs.Batting, section);
  const bowl = totalRow(tabs.Bowling, section);
  const field = totalRow(tabs.Fielding, section);
  const cap = totalRow(tabs.Captain, section);
  const out: CareerTable = {};
  if (bat) {
    out.batting = {
      matches: num(bat.Mat), innings: num(bat.Inns), notOut: num(bat.NO), runs: num(bat.Runs), highest: text(bat.HS),
      average: num(bat.Avg), strikeRate: num(bat.SR), fifties: num(bat["50s"]), thirties: num(bat["30s"]),
      fours: num(bat["4s"]), sixes: num(bat["6s"]), ducks: num(bat.Ducks),
    };
  }
  if (bowl) {
    out.bowling = {
      matches: num(bowl.Mat), innings: num(bowl.Inns), overs: num(bowl.Overs), runs: num(bowl.Runs), wickets: num(bowl.Wkts),
      best: text(bowl.BB), economy: num(bowl.Eco), strikeRate: num(bowl.SR), average: num(bowl.Avg), dots: num(bowl.Dots),
      wides: num(bowl.WD), noBalls: num(bowl.NB),
    };
  }
  if (field) out.fielding = { matches: num(field.Mat), catches: num(field.Catches), runOuts: num(field["R/O"]), stumpings: num(field.St) };
  if (cap) out.captain = { matches: num(cap.Mat), winPct: num(cap["Win %"]) };
  return Object.keys(out).length ? out : undefined;
}

type Row = Record<string, string>;

function csvRows(text: string): Row[] {
  const rows = parseDelimited(text.replace(/^﻿/, ""), ",");
  if (rows.length < 2) return [];
  const head = rows[0].cells.map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r.cells[i] ?? ""])));
}

/** Rank of a value within a leaderboard column, as "3/96" (1 = highest). */
function rankOf(rows: Row[], column: string, row: Row): string {
  const mine = num(row[column]) ?? 0;
  const better = rows.filter((r) => (num(r[column]) ?? 0) > mine).length;
  return `${better + 1}/${rows.length}`;
}

const LEADERBOARD = /(?:^|\/)ppl[\s_-]*(\d+)[\s_-]*(batting|bowling|fielding|mvp)[^/]*\.csv$/i;

/**
 * Builds the import from the uploaded files (name -> text). Files it doesn't
 * recognise are ignored, so a whole export zip can be passed in.
 */
export function parseStatsFiles(files: Record<string, string>): StatsImport {
  const warnings: string[] = [];
  const boards = new Map<number, { batting?: Row[]; bowling?: Row[]; fielding?: Row[]; mvp?: Row[] }>();
  let playersJson: unknown = null;
  let playersFile = false;

  for (const [path, content] of Object.entries(files)) {
    if (/(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path)) continue;
    const board = LEADERBOARD.exec(path);
    if (board) {
      const season = Number(board[1]);
      const kind = board[2].toLowerCase() as "batting" | "bowling" | "fielding" | "mvp";
      const entry = boards.get(season) ?? {};
      entry[kind] = csvRows(content);
      boards.set(season, entry);
    } else if (/(^|\/)all_players\.json$/i.test(path)) {
      playersFile = true;
      try {
        playersJson = JSON.parse(content);
      } catch {
        warnings.push("all_players.json isn't valid JSON");
      }
    }
  }
  if (!Array.isArray(playersJson)) {
    if (!playersFile) warnings.push("all_players.json wasn't found in the upload");
    else if (playersJson !== null) warnings.push("all_players.json should be a list of players");
    return { players: [], seasons: [...boards.keys()].sort(), warnings };
  }

  const seasons = [...boards.keys()].sort((a, b) => a - b);
  const players: ImportedPlayer[] = [];
  for (const item of playersJson as Record<string, unknown>[]) {
    const row = (item?.auction_row ?? {}) as Record<string, unknown>;
    const name = text(row.name);
    if (!name) continue;
    const url = text(row.cricheroes_url) ?? text(item.stats_url);
    const chId = cricheroesId(url);
    const tabs = item.tabs as Record<string, Tab> | undefined;
    const stats: PlayerStats = {
      cricheroesId: chId,
      career: { overall: careerTable(tabs, "OVERALL"), tennis: careerTable(tabs, "TENNIS BALL") },
      seasons: [],
    };

    for (const season of seasons) {
      const b = boards.get(season)!;
      const byId = (rows?: Row[]) => (chId && rows ? rows.find((r) => String(r.player_id ?? "").trim() === chId) : undefined);
      const bat = byId(b.batting);
      const bowl = byId(b.bowling);
      const field = byId(b.fielding);
      // MVP rows have no player id: match the name the leaderboards use for them.
      const boardName = bat?.name ?? bowl?.name ?? field?.name;
      const mvp = boardName && b.mvp ? b.mvp.find((r) => nameKey(r["Player Name"] ?? "") === nameKey(boardName)) : undefined;
      if (!bat && !bowl && !field && !mvp) continue;
      const s: SeasonStats = { season, team: text(bat?.team_name ?? bowl?.team_name ?? field?.team_name ?? mvp?.["Team Name"]) };
      if (bat) {
        s.batting = {
          matches: num(bat.total_match), innings: num(bat.innings), runs: num(bat.total_runs), highest: num(bat.highest_run),
          average: num(bat.average), notOut: num(bat.not_out), strikeRate: num(bat.strike_rate), balls: num(bat.ball_faced),
          fours: num(bat["4s"]), sixes: num(bat["6s"]), fifties: num(bat["50s"]), runsRank: rankOf(b.batting!, "total_runs", bat),
        };
      }
      if (bowl) {
        s.bowling = {
          matches: num(bowl.total_match), overs: num(bowl.overs), wickets: num(bowl.total_wickets), runs: num(bowl.runs),
          economy: num(bowl.economy), strikeRate: num(bowl.SR), average: num(bowl.avg), dots: num(bowl.dot_balls),
          maidens: num(bowl.maidens), best: num(bowl.highest_wicket), wicketsRank: rankOf(b.bowling!, "total_wickets", bowl),
        };
      }
      if (field) {
        s.fielding = {
          matches: num(field.total_match), catches: num(field.total_catches ?? field.catches), runOuts: num(field.run_outs),
          stumpings: num(field.stumpings), dismissals: num(field.total_dismissal),
        };
      }
      if (mvp) {
        s.mvp = {
          matches: num(mvp.Matches), batting: num(mvp.Batting), bowling: num(mvp.Bowling), fielding: num(mvp.Fielding),
          total: num(mvp.Total), role: text(mvp["Player Role"]), rank: rankOf(b.mvp!, "Total", mvp),
        };
      }
      stats.seasons.push(s);
    }

    players.push({ id: text(row.id), name, pool: text(row.pool), cricheroesUrl: url, stats });
  }
  return { players, seasons, warnings };
}

export interface MatchTarget {
  id: string;
  name: string;
  pool: string;
}

/**
 * Pairs imported records with auction players: by id first (the export
 * comes from this app's database), then by name within the pool.
 */
export function matchPlayers(imported: ImportedPlayer[], players: MatchTarget[]) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const byName = new Map<string, MatchTarget[]>();
  for (const p of players) byName.set(`${p.pool}|${nameKey(p.name)}`, [...(byName.get(`${p.pool}|${nameKey(p.name)}`) ?? []), p]);
  const used = new Set<string>();
  const matched: { player: MatchTarget; record: ImportedPlayer }[] = [];
  const unmatched: ImportedPlayer[] = [];
  for (const record of imported) {
    let player = record.id ? byId.get(record.id) : undefined;
    if (!player) {
      const candidates = (byName.get(`${record.pool ?? ""}|${nameKey(record.name)}`) ?? []).filter((p) => !used.has(p.id));
      if (candidates.length === 1) player = candidates[0];
    }
    if (player && !used.has(player.id)) {
      used.add(player.id);
      matched.push({ player, record });
    } else unmatched.push(record);
  }
  return { matched, unmatched };
}
