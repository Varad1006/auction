"use client";

import { useEffect } from "react";
import { cn, money } from "@/lib/format";
import { TIER_LABEL, type PlayerInsight, type Tier } from "@/lib/insights";
import { useInsight, useInsights } from "./InsightsProvider";

const TIER_STYLE: Record<Tier, string> = {
  marquee: "bg-amber-400 text-amber-950",
  premium: "bg-violet-500/30 text-violet-100",
  solid: "bg-sky-500/25 text-sky-100",
  value: "bg-emerald-500/25 text-emerald-100",
  unknown: "bg-white/10 text-slate-300",
};

const short = (n: number) => (n >= 1000 ? `${Number.isInteger(n / 1000) ? n / 1000 : (n / 1000).toFixed(1)}k` : String(n));

/** "✨ 12k" (AI note) or "📊 12k" (price guide only) next to a player's price, for owners and admins. */
export function AiPriceChip({ playerId, className }: { playerId: string; className?: string }) {
  const insight = useInsight(playerId);
  if (!insight?.priceFair) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 rounded-md bg-fuchsia-500/20 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-fuchsia-100", className)}
      title={`Suggested price about ${money(insight.priceFair)} (range ${money(insight.priceFloor)}–${money(insight.priceStretch)})`}
    >
      {insight.hasNote ? "✨" : "📊"} {short(insight.priceFair)}
    </span>
  );
}

/**
 * The suggested price range for one player, with the AI's scouting note.
 * Opening a player without a note asks the AI to write one.
 */
export function AiScoutCard({ playerId, compact = false, className }: { playerId: string; compact?: boolean; className?: string }) {
  const insight = useInsight(playerId);
  const { requestNote, writing } = useInsights();
  const needsNote = !!insight && !insight.hasNote;
  useEffect(() => {
    if (needsNote) requestNote(playerId);
  }, [needsNote, playerId, requestNote]);
  if (!insight) return null;
  return <ScoutCard insight={insight} compact={compact} className={className} writing={writing.has(playerId)} />;
}

export function ScoutCard({ insight, compact, className, writing }: { insight: PlayerInsight; compact?: boolean; className?: string; writing?: boolean }) {
  return (
    <section className={cn("rounded-xl bg-fuchsia-950/30 p-3 text-sm ring-1 ring-fuchsia-400/25", className)} aria-label={insight.hasNote ? "AI scout" : "Price guide"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-200">
          {insight.hasNote ? "✨ AI scout" : "📊 Price guide"}
          {insight.tier && <span className={cn("rounded px-1.5 py-0.5 text-[10px] tracking-normal", TIER_STYLE[insight.tier])}>{TIER_LABEL[insight.tier]}</span>}
        </p>
        {insight.confidence && <span className="text-[11px] text-slate-400">{insight.confidence} confidence</span>}
      </div>

      {insight.priceFair !== null && (
        <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
          <p>
            <span className="block text-[11px] text-slate-400">Fair price</span>
            <span className="text-2xl font-black tabular-nums">{money(insight.priceFair)}</span>
          </p>
          <p className="pb-1 text-xs text-slate-300">
            Likely from <b className="tabular-nums">{money(insight.priceFloor)}</b> · worth up to <b className="tabular-nums">{money(insight.priceStretch)}</b> if you need them
          </p>
        </div>
      )}

      {insight.summary && <p className="mt-2 text-slate-200">{insight.summary}</p>}
      {writing && <p className="mt-2 animate-pulse text-xs text-fuchsia-200">✨ The AI is writing a note on this player…</p>}
      {!insight.hasNote && !insight.history.length && !insight.statLines.length && (
        <p className="mt-2 text-xs text-slate-400">No previous auction price or stats on record.</p>
      )}
      {insight.roleFit && <p className="mt-1 text-xs text-slate-400">Role: {insight.roleFit}</p>}

      {!compact && (insight.strengths.length > 0 || insight.concerns.length > 0) && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {insight.strengths.map((s) => (
            <li key={`s-${s}`} className="text-emerald-200">
              ✓ {s}
            </li>
          ))}
          {insight.concerns.map((s) => (
            <li key={`c-${s}`} className="text-amber-200">
              ! {s}
            </li>
          ))}
        </ul>
      )}

      {insight.history.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-300" aria-label="Previous auctions">
          {insight.history.map((l) => (
            <li key={l}>🔨 {l}</li>
          ))}
        </ul>
      )}

      {!compact && insight.statLines.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[11px] text-slate-400">
          {insight.statLines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] text-slate-500">
        {insight.hasNote ? "AI suggestion from previous prices and stats" : "Worked out from previous auction prices and stats"}: use your own judgement.
        {!compact && insight.cricheroesUrl && (
          <>
            {" "}
            <a href={insight.cricheroesUrl} target="_blank" rel="noreferrer noopener" className="underline">
              CricHeroes profile
            </a>
          </>
        )}
      </p>
    </section>
  );
}
