"use client";

import { useState } from "react";
import { cn, money } from "@/lib/format";
import { POOL_LABEL, POOLS, type Pool } from "@/lib/types";
import { useAuction } from "./useAuction";

export function TeamsBoard({ highlightTeamId }: { highlightTeamId?: string | null }) {
  const { teams, players, pool: currentPool, summaries, state } = useAuction();
  const [chosenPool, setPool] = useState<Pool | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const pool = chosenPool ?? currentPool;
  const sums = summaries(pool);

  return (
    <section aria-labelledby="teams-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="teams-h" className="text-lg font-bold">Teams</h2>
        <div className="flex rounded-lg bg-white/5 p-0.5 text-sm" role="tablist">
          {POOLS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pool === p}
              onClick={() => setPool(p)}
              className={cn("rounded-md px-3 py-1 font-medium", pool === p ? "bg-white/15 text-white" : "text-slate-400")}
            >
              {POOL_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {teams.map((t) => {
          const s = sums.get(t.id);
          const roster = players
            .filter((p) => p.status === "sold" && p.sold_team_id === t.id && p.pool === pool)
            .sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0));
          const leading = state?.phase === "bidding" && state.leading_team_id === t.id;
          const expanded = open === t.id;
          return (
            <li
              key={t.id}
              className={cn(
                "overflow-hidden rounded-xl bg-slate-900 ring-1",
                highlightTeamId === t.id ? "ring-2 ring-amber-400" : "ring-white/10",
                leading && "leading-glow",
              )}
            >
              <button
                className="flex w-full items-stretch text-left"
                onClick={() => setOpen(expanded ? null : t.id)}
                aria-expanded={expanded}
              >
                <span className="w-1.5 shrink-0" style={{ background: t.color }} />
                <span className="flex-1 p-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold">{t.name}</span>
                    {leading && <span className="rounded bg-emerald-500 px-1.5 text-[10px] font-bold uppercase text-emerald-950">Leading</span>}
                  </span>
                  {s && (
                    <span className="mt-1.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                      <span className="whitespace-nowrap">
                        <span className="block text-xl font-extrabold leading-tight tabular-nums">{money(s.remaining)}</span>
                        <span className="text-xs text-slate-400">purse left</span>
                      </span>
                      <span className="whitespace-nowrap text-right text-xs leading-5 text-slate-400">
                        <span className="block">
                          Squad <b className="tabular-nums text-slate-100">{s.squadCount}/{s.maxSquad}</b>
                          <span className="text-slate-500"> (min {s.minSquad})</span>
                        </span>
                        <span className="block">
                          Max bid <b className="tabular-nums text-slate-100">{money(s.maxBid)}</b>
                        </span>
                      </span>
                    </span>
                  )}
                </span>
              </button>
              {expanded && (
                <ul className="border-t border-white/5 px-4 py-2 text-sm">
                  {roster.length === 0 && <li className="py-1 text-slate-500">No {POOL_LABEL[pool].toLowerCase()} players yet</li>}
                  {roster.map((p) => (
                    <li key={p.id} className="flex justify-between py-1">
                      <span>
                        {p.name} <span className="text-slate-500">· {p.role}</span>
                      </span>
                      <span className="tabular-nums text-slate-300">{money(p.sold_price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
