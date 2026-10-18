"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { cricheroesShort, type CricHeroesCareer } from "@/lib/insights";
import { useInsight } from "../owner/InsightsProvider";

// Players' CricHeroes careers and PPL 1-2 performances, shown to everyone.
// Owners and admins see them inside the AI scout card instead.

export interface PublicPlayerStats {
  playerId: string;
  /** One line per PPL season. */
  statLines: string[];
  cricheroes: CricHeroesCareer[];
  cricheroesUrl: string | null;
}

// Loaded once per page visit and shared by every card on it.
let loading: Promise<Map<string, PublicPlayerStats>> | null = null;
function loadStats(): Promise<Map<string, PublicPlayerStats>> {
  loading ??= fetch("/api/stats")
    .then((r) => (r.ok ? r.json() : { stats: [] }))
    .then((d: { stats: PublicPlayerStats[] }) => new Map(d.stats.map((s) => [s.playerId, s])))
    .catch(() => {
      loading = null;
      return new Map();
    });
  return loading;
}

function usePlayerStats(playerId: string): PublicPlayerStats | null {
  const [stats, setStats] = useState<Map<string, PublicPlayerStats> | null>(null);
  useEffect(() => {
    let live = true;
    void loadStats().then((m) => {
      if (live) setStats(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return stats?.get(playerId) ?? null;
}

/**
 * A player's CricHeroes career and PPL seasons. Hidden when this viewer
 * already gets the AI scout card for the player (it includes both), unless
 * `always` is set.
 */
export function PlayerStats({ playerId, compact = false, always = false, className }: { playerId: string; compact?: boolean; always?: boolean; className?: string }) {
  const stats = usePlayerStats(playerId);
  const insight = useInsight(playerId);
  if (!stats || (insight && !always) || (!stats.cricheroes.length && !stats.statLines.length)) return null;
  return (
    <section className={cn("rounded-xl bg-slate-900 p-3 text-sm ring-1 ring-white/10", className)} aria-label="Player stats">
      {stats.statLines.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-300">📈 PPL performances</p>
          <PplSeasons lines={compact ? stats.statLines.slice(0, 2) : stats.statLines} className="mt-1.5" />
        </>
      )}
      {stats.cricheroes.length > 0 && <CricHeroes careers={stats.cricheroes} url={stats.cricheroesUrl} compact={compact} />}
    </section>
  );
}

/** "PPL 2 · P2 Royals: 177 runs in 8 inns (SR 173.5) …", latest season first. */
export function PplSeasons({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <ul className={cn("space-y-0.5 text-[11px] text-slate-400", className)} aria-label="PPL seasons">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

const num = (n: number | null, digits = 0) => (n === null ? "–" : digits && !Number.isInteger(n) ? n.toFixed(digits) : n.toLocaleString("en-IN"));

/** The player's CricHeroes career numbers: one line when compact, a small table otherwise. */
export function CricHeroes({ careers, url, compact }: { careers: CricHeroesCareer[]; url: string | null; compact?: boolean }) {
  const link = url && (
    <a href={url} target="_blank" rel="noreferrer noopener" className="underline">
      profile
    </a>
  );
  if (compact) {
    const c = careers[0];
    return (
      <p className="mt-2 text-xs text-sky-100" aria-label="CricHeroes stats">
        🏏 CricHeroes ({c.label.toLowerCase()}): {cricheroesShort(c)}
        {link && <> · {link}</>}
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-sky-500/10 p-2.5 ring-1 ring-sky-400/20" role="group" aria-label="CricHeroes stats">
      <p className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-sky-200">
        🏏 CricHeroes career
        {link && <span className="font-medium normal-case tracking-normal">{link}</span>}
      </p>
      {careers.map((c) => (
        <div key={c.label}>
          <p className="text-xs font-semibold text-slate-200">
            {c.label} · {c.matches} matches
          </p>
          <dl className="mt-1 flex flex-wrap gap-1 text-[11px] tabular-nums">
            {[
              ...(c.batting
                ? [
                    ["Runs", num(c.batting.runs)],
                    ["Avg", num(c.batting.average, 1)],
                    ["SR", num(c.batting.strikeRate, 1)],
                    ["Best", c.batting.highest ?? "–"],
                    ["50s", num(c.batting.fifties)],
                    ["6s", num(c.batting.sixes)],
                  ]
                : []),
              ...(c.bowling
                ? [
                    ["Wkts", num(c.bowling.wickets)],
                    ["Econ", num(c.bowling.economy, 1)],
                    ["Best", c.bowling.best ?? "–"],
                  ]
                : []),
              ...(c.fielding ? [["Catches", num(c.fielding.catches)], ...(c.fielding.stumpings ? [["Stumpings", num(c.fielding.stumpings)]] : [])] : []),
            ].map(([label, value], i) => (
              <div key={`${label}-${i}`} className="rounded bg-slate-950/50 px-1.5 py-0.5">
                <dt className="inline text-slate-400">{label} </dt>
                <dd className="inline font-semibold text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
