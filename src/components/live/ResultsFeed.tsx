"use client";

import { cn, money } from "@/lib/format";
import { POOL_LABEL } from "@/lib/types";
import { TeamBadge } from "./TeamBadge";
import { useAuction } from "./useAuction";

export function ResultsFeed({ limit = 10 }: { limit?: number }) {
  const { results, playerById, teamById } = useAuction();
  const recent = [...results].reverse().slice(0, limit);
  return (
    <section aria-labelledby="results-h">
      <h2 id="results-h" className="mb-3 text-lg font-bold">Recent results</h2>
      {recent.length === 0 ? (
        <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-500 ring-1 ring-white/10">No results yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
          {recent.map((r) => {
            const p = playerById.get(r.player_id);
            const t = r.team_id ? teamById.get(r.team_id) : null;
            return (
              <li key={r.id} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", r.undone_at && "opacity-50")}>
                <span className="min-w-0">
                  <span className={cn("block truncate font-semibold", r.undone_at && "line-through")}>{p?.name ?? "Deleted player"}</span>
                  <span className="text-xs text-slate-500">
                    {POOL_LABEL[r.pool]} · Round {r.round}
                    {r.method === "manual" && " · assigned"}
                    {r.undone_at && " · undone"}
                  </span>
                </span>
                {r.outcome === "sold" && t ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <TeamBadge team={t} />
                    <span className="font-bold tabular-nums">{money(r.price)}</span>
                  </span>
                ) : (
                  <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-bold uppercase text-slate-300">Unsold</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
