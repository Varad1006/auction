"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn, initials, money } from "@/lib/format";
import { PLAYER_ROLES, POOL_LABEL, POOLS, type Player, type Pool } from "@/lib/types";
import { PlayerDeckCard } from "../live/PlayerDeckCard";
import { TeamBadge } from "../live/TeamBadge";
import { useAuction } from "../live/useAuction";
import { inputClass, Modal } from "../ui";

type Status = "pool" | "sold" | "unsold" | "all";
const STATUS_LABEL: Record<Status, string> = { pool: "Remaining", sold: "Sold", unsold: "Unsold", all: "All" };

export function PlayersPage() {
  const { ready, players, teamById, state } = useAuction();
  const params = useSearchParams();
  const router = useRouter();
  const pool: Pool = params.get("pool") === "women" ? "women" : "men";
  const [status, setStatus] = useState<Status>("pool");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Player | null>(null);

  const inPool = useMemo(() => players.filter((p) => p.pool === pool), [players, pool]);
  const list = useMemo(
    () =>
      inPool
        .filter((p) => status === "all" || p.status === status)
        .filter((p) => !role || p.role === role)
        .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) =>
          status === "sold" ? (b.sold_price ?? 0) - (a.sold_price ?? 0) : a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name),
        ),
    [inPool, status, role, q],
  );
  const count = (s: Status) => (s === "all" ? inPool.length : inPool.filter((p) => p.status === s).length);
  const live = open ? (players.find((p) => p.id === open.id) ?? open) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-white/5 p-1" role="tablist" aria-label="Pool">
          {POOLS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pool === p}
              onClick={() => router.replace(`/players?pool=${p}`, { scroll: false })}
              className={cn("rounded-lg px-5 py-1.5 text-sm font-bold", pool === p ? "bg-amber-400 text-amber-950" : "text-slate-300")}
            >
              {POOL_LABEL[p]} <span className="opacity-60">{players.filter((x) => x.pool === p).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold ring-1",
                status === s ? "bg-white text-slate-900 ring-white" : "text-slate-300 ring-white/15",
              )}
            >
              {STATUS_LABEL[s]} <span className="opacity-60">{count(s)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <input className={inputClass} placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {PLAYER_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>

      {!ready ? (
        <p className="animate-pulse py-10 text-center text-slate-400">Loading players…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl bg-slate-900 p-8 text-center text-slate-500 ring-1 ring-white/10">No players match.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((p) => {
            const team = p.sold_team_id ? teamById.get(p.sold_team_id) : null;
            const onBlock = state?.current_player_id === p.id && ["spinning", "revealed", "bidding"].includes(state.phase);
            return (
              <li key={p.id}>
                <button
                  onClick={() => setOpen(p)}
                  className={cn(
                    "group block w-full overflow-hidden rounded-xl bg-slate-900 text-left ring-1 transition hover:-translate-y-0.5 hover:ring-amber-400/60",
                    onBlock ? "ring-2 ring-rose-500" : "ring-white/10",
                  )}
                >
                  <div className="relative aspect-[4/5] bg-slate-800">
                    {p.photo_url ? (
                      <img src={p.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-3xl font-black text-slate-600">{initials(p.name)}</span>
                    )}
                    <span className="absolute left-2 top-2 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-xs font-black">{p.grade}</span>
                    {onBlock && <span className="absolute right-2 top-2 rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold uppercase">Live</span>}
                    {p.status === "unsold" && (
                      <span className="absolute inset-x-0 bottom-0 bg-slate-950/80 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-slate-300">
                        Unsold
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate font-bold">{p.name}</p>
                    <p className="truncate text-xs text-slate-400">{p.role}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-1 text-xs">
                      {p.status === "sold" && team ? (
                        <>
                          <TeamBadge team={team} />
                          <b className="tabular-nums">{money(p.sold_price)}</b>
                        </>
                      ) : (
                        <span className="text-slate-400">Base {money(p.base_price)}</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={live !== null} onClose={() => setOpen(null)} title={live?.name ?? ""}>
        {live && (
          <div className="space-y-3">
            <PlayerDeckCard
              player={live}
              size="md"
              soldTo={live.status === "sold" && live.sold_team_id && teamById.get(live.sold_team_id) ? { team: teamById.get(live.sold_team_id)!, price: live.sold_price ?? 0 } : null}
              unsold={live.status === "unsold"}
            />
            <p className="text-center text-xs text-slate-500">Tap the card to flip it.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
