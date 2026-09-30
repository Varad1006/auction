"use client";

import { useState } from "react";
import { cn, initials, money, textOn } from "@/lib/format";
import { POOL_LABEL, type Player, type Team } from "@/lib/types";

const THEME = { ring: "from-amber-300 via-yellow-500 to-amber-700", chip: "bg-amber-400 text-amber-950", glow: "shadow-amber-500/30" };

const ROLE_ICON: Record<string, string> = {
  Batter: "🏏",
  Bowler: "🎯",
  "All-rounder": "⚡",
  "Wicket-keeper": "🧤",
};

/**
 * Trading-card style player card. Tap/click (or Enter/Space) flips it to
 * show the full details. Used on the live block and on the Players page.
 */
export function PlayerDeckCard({
  player,
  soldTo,
  unsold,
  reveal,
  size = "lg",
  className,
}: {
  player: Player;
  soldTo?: { team: Team; price: number } | null;
  unsold?: boolean;
  reveal?: boolean;
  size?: "lg" | "md";
  /** Overrides the default max width. */
  className?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const theme = THEME;
  const availability = (player.details ?? []).find((d) => /^availab/i.test(d.label))?.value;
  const facts = [
    player.batting_style && { label: "Batting", value: player.batting_style },
    player.bowling_style && { label: "Bowling", value: player.bowling_style },
    ...(player.details ?? []),
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className={cn("mx-auto w-full [perspective:1200px]", className ?? (size === "lg" ? "max-w-[340px]" : "max-w-[300px]"), reveal && "reveal")}>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={`${player.name} card, ${flipped ? "showing details" : "tap for details"}`}
        aria-pressed={flipped}
        className={cn(
          "relative block aspect-[5/7] w-full rounded-[1.4rem] bg-gradient-to-br p-[3px] text-left shadow-2xl transition-transform duration-700 [transform-style:preserve-3d]",
          theme.ring,
          theme.glow,
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        {/* Front */}
        <div className="absolute inset-[3px] overflow-hidden rounded-[1.25rem] bg-slate-900 [backface-visibility:hidden]">
          {player.photo_url ? (
            <img src={player.photo_url} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-7xl font-black text-slate-500">
              {initials(player.name)}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
          <div className="absolute left-3 right-3 top-3 flex items-start justify-between">
            <span className={cn("rounded-lg px-2.5 py-1.5 text-center font-black leading-none shadow", theme.chip)}>
              <span className="block text-[9px] uppercase tracking-widest">Base</span>
              <span className="mt-0.5 block text-lg tabular-nums">{money(player.base_price).replace(/ .*/, "")}</span>
            </span>
            <span className="rounded-lg bg-slate-950/70 px-2 py-1 text-xs font-bold backdrop-blur">{POOL_LABEL[player.pool]}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-4">
            {availability && (
              <p className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/40">
                <span aria-hidden>📅</span>
                <span className="truncate">{availability}</span>
              </p>
            )}
            <p className="text-sm font-semibold text-amber-300">
              {ROLE_ICON[player.role]} {player.role}
            </p>
            <h3 className={cn("font-black leading-tight tracking-tight text-white", size === "lg" ? "text-3xl" : "text-2xl")}>{player.name}</h3>
            <div className="mt-2 flex items-center justify-end text-sm">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-200">Tap for details ↻</span>
            </div>
          </div>
          {soldTo && (
            <div
              className="stamp absolute right-3 top-16 rotate-[-8deg] rounded-lg px-3 py-1.5 text-right font-black uppercase shadow-xl ring-2 ring-white/40"
              style={{ background: soldTo.team.color, color: textOn(soldTo.team.color) }}
            >
              <span className="block text-[10px] tracking-[0.3em]">Sold</span>
              <span className="block text-sm">{soldTo.team.short_name} · {money(soldTo.price)}</span>
            </div>
          )}
          {unsold && (
            <div className="stamp absolute right-3 top-16 rotate-[-8deg] rounded-lg bg-slate-200 px-3 py-1.5 font-black uppercase tracking-[0.3em] text-slate-900 shadow-xl">
              Unsold
            </div>
          )}
        </div>

        {/* Back */}
        <div className="absolute inset-[3px] flex flex-col overflow-hidden rounded-[1.25rem] bg-slate-900 p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="flex items-center gap-3 border-b border-white/10 pb-3">
            {player.photo_url ? (
              <img src={player.photo_url} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 font-bold">{initials(player.name)}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-lg font-extrabold">{player.name}</span>
              <span className="block text-xs text-slate-400">
                {player.role} · {POOL_LABEL[player.pool]}
              </span>
            </span>
          </div>
          <dl className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
            {facts.map((f, i) => (
              <div key={i}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{f.label}</dt>
                <dd className="whitespace-pre-line text-slate-100">{f.value}</dd>
              </div>
            ))}
            {player.notes && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Notes</dt>
                <dd className="whitespace-pre-line text-slate-100">{player.notes}</dd>
              </div>
            )}
            {facts.length === 0 && !player.notes && <p className="text-slate-500">No extra details yet.</p>}
          </dl>
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-sm">
            <span className="text-slate-400">
              Base <b className="text-white">{money(player.base_price)}</b>
            </span>
            <span className="text-xs text-slate-500">Tap to flip back ↻</span>
          </div>
        </div>
      </button>
    </div>
  );
}
