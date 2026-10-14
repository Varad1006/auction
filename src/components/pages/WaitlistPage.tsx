"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { callAction } from "@/lib/api";
import { cn } from "@/lib/format";
import { POOL_LABEL, POOLS, type Player, type Pool } from "@/lib/types";
import { PlayerAvatar } from "../live/PlayerCard";
import { PlayerDeckCard } from "../live/PlayerDeckCard";
import { useAuction } from "../live/useAuction";
import { useMe } from "../MeProvider";
import { Button, Modal, useRunner } from "../ui";

/** Everyone waiting for a place in the auction, next in line first. */
export function WaitlistPage() {
  const { ready, waitlist } = useAuction();
  const { me } = useMe();
  const isAdmin = me?.role === "admin";
  const { busy, run } = useRunner();
  const params = useSearchParams();
  const router = useRouter();
  const pool: Pool = params.get("pool") === "women" ? "women" : "men";
  const [open, setOpen] = useState<Player | null>(null);

  const list = waitlist.filter((p) => p.pool === pool);
  const live = open ? (waitlist.find((p) => p.id === open.id) ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black">Waitlist</h1>
          <p className="text-sm text-slate-400">
            Players waiting for a place in the auction, in order. They aren&apos;t on the wheel until the organisers move them in.
          </p>
        </div>
        <div className="flex rounded-xl bg-white/5 p-1" role="tablist" aria-label="Pool">
          {POOLS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pool === p}
              onClick={() => router.replace(`/waitlist?pool=${p}`, { scroll: false })}
              className={cn("rounded-lg px-5 py-1.5 text-sm font-bold", pool === p ? "bg-sky-400 text-sky-950" : "text-slate-300")}
            >
              {POOL_LABEL[p]} <span className="opacity-60">{waitlist.filter((x) => x.pool === p).length}</span>
            </button>
          ))}
        </div>
      </div>

      {!ready ? (
        <p className="animate-pulse py-10 text-center text-slate-400">Loading waitlist…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl bg-slate-900 p-8 text-center text-slate-500 ring-1 ring-white/10">
          Nobody is on the {POOL_LABEL[pool].toLowerCase()}&apos;s waitlist.
        </p>
      ) : (
        <ol className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10" aria-label={`${POOL_LABEL[pool]} waitlist`}>
          {list.map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <span className="w-8 shrink-0 text-center text-lg font-black tabular-nums text-sky-300">{i + 1}</span>
              <button onClick={() => setOpen(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <PlayerAvatar player={p} className="h-12 w-11 shrink-0 rounded-lg text-sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-slate-400">{p.role}</span>
                </span>
              </button>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="primary"
                  busy={busy === p.id}
                  onClick={() => run(p.id, () => callAction("player.setWaitlist", { id: p.id, waitlisted: false }), `${p.name} moved to players`)}
                >
                  Move to players
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}

      <Modal open={live !== null} onClose={() => setOpen(null)} title={live?.name ?? ""}>
        {live && (
          <div className="space-y-3">
            <PlayerDeckCard player={live} size="md" />
            <p className="text-center text-xs text-slate-500">Tap the card to flip it.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
