"use client";

import { cn, money, textOn } from "@/lib/format";
import { useAuction } from "./useAuction";

export function BidStatus() {
  const { state, player, teamById, activeBids } = useAuction();
  if (!state || !player) return null;
  const leader = state.leading_team_id ? teamById.get(state.leading_team_id) : null;
  const open = state.phase === "bidding";

  return (
    <section className="@container rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {open ? (leader ? "Current bid" : "Opening bid") : state.phase === "sold" ? "Final price" : "Bidding"}
          </p>
          <p key={state.current_bid ?? "none"} className="bump whitespace-nowrap text-4xl font-black tabular-nums">
            {state.current_bid !== null ? money(state.current_bid) : money(player.base_price)}
          </p>
        </div>
        {leader ? (
          <div
            className="max-w-full rounded-xl px-3 py-2 shadow"
            style={{ background: leader.color, color: textOn(leader.color) }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              {state.phase === "sold" ? "Bought by" : "Leading"}
            </p>
            <p className="truncate text-lg font-extrabold leading-tight">
              <span className="@sm:hidden">{leader.short_name}</span>
              <span className="hidden @sm:inline">{leader.name}</span>
            </p>
          </div>
        ) : (
          <p className={cn("rounded-lg px-3 py-2 text-sm font-semibold", open ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-400")}>
            {open ? "Bidding open" : state.phase === "unsold" ? "No bids" : "Not open yet"}
          </p>
        )}
      </div>
      {activeBids.length > 0 && (
        <ol className="mt-4 space-y-1.5 text-sm">
          {activeBids.slice(0, 6).map((b, i) => {
            const t = teamById.get(b.team_id);
            return (
              <li key={b.id} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-1.5", i === 0 ? "bg-white/10" : "bg-white/[0.03] text-slate-400")}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t?.color ?? "#64748b" }} />
                  <span className="truncate">{t?.name ?? "Unknown team"}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money(b.amount)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
