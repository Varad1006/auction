"use client";

import Link from "next/link";
import { cn, initials, money, textOn } from "@/lib/format";
import { POOL_LABEL, POOLS, type Pool } from "@/lib/types";
import { RecentBids } from "../live/RecentBids";
import { ResultsFeed } from "../live/ResultsFeed";
import { TeamBadge } from "../live/TeamBadge";
import { useAuction } from "../live/useAuction";

export function OverviewPage() {
  const a = useAuction();
  const { ready, error, state, player, teamById, players, configs, summaries, teams } = a;

  if (!ready) {
    return <p className="animate-pulse py-16 text-center text-slate-400">{error ? `Can't load the auction: ${error}` : "Loading auction…"}</p>;
  }

  const onBlock = state && ["spinning", "revealed", "bidding"].includes(state.phase) ? player : null;
  const leader = state?.leading_team_id ? teamById.get(state.leading_team_id) : null;
  const sold = players.filter((p) => p.status === "sold");
  const topBuys = [...sold].sort((x, y) => (y.sold_price ?? 0) - (x.sold_price ?? 0)).slice(0, 5);
  const totalSpent = sold.reduce((s, p) => s + (p.sold_price ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Now */}
      <Link
        href="/live"
        className="block overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 p-5 ring-1 ring-white/10 transition hover:ring-amber-400/50"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-300">
            {onBlock && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
            {onBlock ? (state?.phase === "bidding" ? "Live bidding" : "On the block") : "Up next"}
          </p>
          <span className="text-sm font-semibold text-amber-300">Watch live →</span>
        </div>
        {onBlock ? (
          <div className="mt-3 flex items-center gap-4">
            {onBlock.photo_url ? (
              <img src={onBlock.photo_url} alt="" className="h-20 w-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-20 w-16 items-center justify-center rounded-xl bg-slate-700 text-xl font-bold">{initials(onBlock.name)}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xl font-black">{onBlock.name}</p>
              <p className="text-sm text-slate-400">
                {onBlock.role} · Grade {onBlock.grade} · {POOL_LABEL[onBlock.pool]}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tabular-nums">{money(state?.current_bid ?? onBlock.base_price)}</p>
              {leader ? (
                <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: leader.color, color: textOn(leader.color) }}>
                  {leader.name}
                </span>
              ) : (
                <span className="text-xs text-slate-400">{state?.phase === "bidding" ? "Opening bid" : "Base price"}</span>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xl font-bold">Waiting for the next spin</p>
        )}
      </Link>

      {/* Pools */}
      <div className="grid gap-4 sm:grid-cols-2">
        {POOLS.map((p) => (
          <PoolStats key={p} pool={p} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top buys */}
        <section>
          <h2 className="mb-3 text-lg font-bold">Top buys</h2>
          {topBuys.length === 0 ? (
            <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-500 ring-1 ring-white/10">No players sold yet.</p>
          ) : (
            <ol className="divide-y divide-white/5 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
              {topBuys.map((p, i) => {
                const t = p.sold_team_id ? teamById.get(p.sold_team_id) : null;
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-5 text-center font-black text-slate-500">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                    {t && <TeamBadge team={t} />}
                    <span className="w-20 text-right font-bold tabular-nums">{money(p.sold_price)}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-2 text-xs text-slate-500">Total spent so far: {money(totalSpent)}</p>
        </section>

        {/* Standings */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Teams</h2>
            <Link href="/teams" className="text-sm font-semibold text-amber-300">All teams →</Link>
          </div>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
            {teams.map((t) => {
              const counts = POOLS.map((p) => summaries(p).get(t.id));
              const spent = counts.reduce((s, c) => s + (c?.spent ?? 0), 0);
              return (
                <li key={t.id}>
                  <Link href={`/teams/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                    <span className="text-xs text-slate-400">
                      {POOLS.map((p, i) => `${POOL_LABEL[p][0]} ${counts[i]?.squadCount ?? 0}/${counts[i]?.maxSquad ?? 0}`).join(" · ")}
                    </span>
                    <span className="w-20 text-right font-bold tabular-nums">{money(spent)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Squad counts (Men · Women) and total spent.</p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentBids limit={6} />
        <ResultsFeed limit={6} />
      </div>
      {configs.men === undefined && <p className="text-sm text-rose-300">Pool settings are missing.</p>}
    </div>
  );
}

function PoolStats({ pool }: { pool: Pool }) {
  const { players, configs, state } = useAuction();
  const list = players.filter((p) => p.pool === pool);
  const n = (s: string) => list.filter((p) => p.status === s).length;
  const soldCount = n("sold");
  const pct = list.length ? Math.round((soldCount / list.length) * 100) : 0;
  const current = state?.current_pool === pool;
  return (
    <Link
      href={`/players?pool=${pool}`}
      className={cn("block rounded-2xl bg-slate-900 p-4 ring-1 transition hover:ring-amber-400/50", current ? "ring-amber-400/40" : "ring-white/10")}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{POOL_LABEL[pool]}</h2>
        <span className="text-xs font-semibold text-slate-400">
          Round {configs[pool]?.current_round ?? 1}
          {current && <span className="ml-2 rounded bg-amber-400 px-1.5 py-0.5 text-amber-950">Now</span>}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          ["Total", list.length],
          ["Remaining", n("pool")],
          ["Sold", soldCount],
          ["Unsold", n("unsold")],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg bg-white/5 py-2">
            <p className="text-xl font-black tabular-nums">{value}</p>
            <p className="text-[11px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" aria-label={`${pct}% sold`}>
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-slate-500">{pct}% sold · view players →</p>
    </Link>
  );
}
