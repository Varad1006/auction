"use client";

import Link from "next/link";
import { cn, initials, money, textOn } from "@/lib/format";
import { POOL_LABEL, POOLS, type Player } from "@/lib/types";
import { useAuction } from "../live/useAuction";

export function TeamsPage() {
  const { ready, teams, players, summaries, state } = useAuction();
  if (!ready) return <p className="animate-pulse py-16 text-center text-slate-400">Loading teams…</p>;
  const sums = Object.fromEntries(POOLS.map((p) => [p, summaries(p)]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Teams</h1>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => {
          const roster = players.filter((p) => p.status === "sold" && p.sold_team_id === t.id);
          const spent = roster.reduce((s, p) => s + (p.sold_price ?? 0), 0);
          const leading = state?.phase === "bidding" && state.leading_team_id === t.id;
          return (
            <li key={t.id}>
              <Link
                href={`/teams/${t.id}`}
                className={cn("block overflow-hidden rounded-2xl bg-slate-900 ring-1 transition hover:ring-amber-400/50", leading ? "leading-glow ring-emerald-400" : "ring-white/10")}
              >
                <div className="flex items-center justify-between px-4 py-3" style={{ background: t.color, color: textOn(t.color) }}>
                  <span className="text-lg font-black">{t.name}</span>
                  <span className="text-sm font-bold opacity-80">{t.short_name}</span>
                </div>
                <div className="grid grid-cols-2 gap-px bg-white/5">
                  {POOLS.map((p) => {
                    const s = sums[p].get(t.id);
                    return (
                      <div key={p} className="bg-slate-900 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{POOL_LABEL[p]}</p>
                        <p className="text-xl font-black tabular-nums">{money(s?.remaining)}</p>
                        <p className="text-xs text-slate-400">
                          left · squad {s?.squadCount ?? 0}/{s?.maxSquad ?? 0} · max bid {money(s?.maxBid)}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex -space-x-2">
                    {roster.slice(0, 8).map((p) => (
                      <Avatar key={p.id} player={p} className="h-8 w-8 ring-2 ring-slate-900" />
                    ))}
                    {roster.length === 0 && <span className="text-sm text-slate-500">No players yet</span>}
                  </div>
                  <span className="text-sm text-slate-400">
                    {roster.length} players · <b className="text-slate-100">{money(spent)}</b>
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TeamDetailPage({ teamId }: { teamId: string }) {
  const { ready, teamById, players, summaries } = useAuction();
  if (!ready) return <p className="animate-pulse py-16 text-center text-slate-400">Loading team…</p>;
  const team = teamById.get(teamId);
  if (!team) {
    return (
      <p className="py-16 text-center text-slate-400">
        Team not found. <Link href="/teams" className="text-amber-300 underline">All teams</Link>
      </p>
    );
  }
  return (
    <div className="space-y-5">
      <Link href="/teams" className="text-sm text-slate-400 hover:text-slate-200">← All teams</Link>
      <div className="rounded-2xl px-5 py-5" style={{ background: team.color, color: textOn(team.color) }}>
        <p className="text-sm font-bold opacity-80">{team.short_name}</p>
        <h1 className="text-3xl font-black">{team.name}</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {POOLS.map((pool) => {
          const s = summaries(pool).get(team.id);
          const roster = players
            .filter((p) => p.status === "sold" && p.sold_team_id === team.id && p.pool === pool)
            .sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0));
          return (
            <section key={pool} className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10">
              <h2 className="text-lg font-bold">{POOL_LABEL[pool]}</h2>
              {s && (
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Purse left", money(s.remaining)],
                    ["Spent", money(s.spent)],
                    ["Squad", `${s.squadCount}/${s.maxSquad}`],
                    ["Max bid", money(s.maxBid)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-white/5 px-1 py-2">
                      <p className="text-sm font-black tabular-nums sm:text-base">{value}</p>
                      <p className="text-[11px] text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
              )}
              {s && s.squadCount < s.minSquad && (
                <p className="mt-2 text-xs text-amber-300">Needs {s.minSquad - s.squadCount} more to reach the minimum squad of {s.minSquad}.</p>
              )}
              <ul className="mt-4 divide-y divide-white/5">
                {roster.length === 0 && <li className="py-3 text-sm text-slate-500">No players bought yet.</li>}
                {roster.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <Avatar player={p} className="h-10 w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="text-xs text-slate-400">
                        {p.role} · Grade {p.grade} · Round {p.decided_round ?? "–"}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">{money(p.sold_price)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Avatar({ player, className }: { player: Player; className?: string }) {
  return player.photo_url ? (
    <img src={player.photo_url} alt={player.name} title={player.name} referrerPolicy="no-referrer" className={cn("rounded-full object-cover", className)} />
  ) : (
    <span title={player.name} className={cn("flex items-center justify-center rounded-full bg-slate-700 text-xs font-bold", className)}>
      {initials(player.name)}
    </span>
  );
}
