"use client";

import { useEffect, useState } from "react";
import { cn, initials, money, textOn } from "@/lib/format";
import { useAuction } from "./useAuction";

/**
 * Slim bar pinned under the page tabs on phones, shown only while the block
 * itself is scrolled out of view, so the current bid is always visible.
 */
export function LiveTicker({ watch }: { watch: React.RefObject<HTMLElement | null> }) {
  const { state, player, teamById } = useAuction();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const el = watch.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting), { rootMargin: "-120px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);

  const active = state && player && ["revealed", "bidding", "spinning"].includes(state.phase);
  if (!active || hidden) return null;
  const leader = state.leading_team_id ? teamById.get(state.leading_team_id) : null;

  return (
    <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+6.4rem)] z-20 px-3 lg:hidden">
      <button
        onClick={() => watch.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="toast-in mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl bg-slate-900/95 p-2 pr-3 text-left shadow-xl ring-1 ring-white/15 backdrop-blur"
      >
        {player.photo_url ? (
          <img src={player.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-sm font-bold">{initials(player.name)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
            {state.phase === "bidding" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />}
            {state.phase === "bidding" ? "Live" : "On the block"}
          </span>
          <span className="block truncate font-bold">{player.name}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-black tabular-nums">{money(state.current_bid ?? player.base_price)}</span>
          {leader ? (
            <span className={cn("block max-w-[8rem] truncate rounded px-1.5 text-[11px] font-bold")} style={{ background: leader.color, color: textOn(leader.color) }}>
              {leader.short_name}
            </span>
          ) : (
            <span className="block text-[11px] text-slate-400">{state.phase === "bidding" ? "No bids yet" : "Base price"}</span>
          )}
        </span>
      </button>
    </div>
  );
}
