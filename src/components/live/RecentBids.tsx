"use client";

import { cn, money, timeAgo } from "@/lib/format";
import { useAuction } from "./useAuction";

/** Bids on any player, newest first. Voided (undone) bids are struck through. */
export function RecentBids({ limit = 20, title = "Recent bids" }: { limit?: number; title?: string }) {
  const { recentBids, playerById, teamById, state } = useAuction();
  const rows = recentBids.slice(0, limit);
  return (
    <section aria-labelledby="bids-h">
      <h2 id="bids-h" className="mb-3 text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-500 ring-1 ring-white/10">No bids yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
          {rows.map((b) => {
            const t = teamById.get(b.team_id);
            const p = playerById.get(b.player_id);
            const onBlock = state?.current_player_id === b.player_id && state.phase === "bidding";
            return (
              <li key={b.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", b.voided_at && "opacity-40")}>
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: t?.color ?? "#64748b" }} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-semibold", b.voided_at && "line-through")}>
                    {t?.name ?? "Team"} <span className="font-normal text-slate-400">bid on</span> {p?.name ?? "a player"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {timeAgo(b.created_at)}
                    {b.voided_at && " · undone"}
                    {onBlock && !b.voided_at && <span className="ml-1 text-emerald-400">· live</span>}
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums">{money(b.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
