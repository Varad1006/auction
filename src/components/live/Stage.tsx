"use client";

import { useState } from "react";
import { POOL_LABEL } from "@/lib/types";
import { BidStatus } from "./BidStatus";
import { PlayerDeckCard } from "./PlayerDeckCard";
import { useAuction } from "./useAuction";
import { Wheel } from "./Wheel";

/** The "block": wheel while spinning, then the player card and bid status. */
export function Stage() {
  const { ready, state, player, players, playerById, teamById, pool, config, counts, lastResult, error } = useAuction();
  const [revealedSpin, setRevealedSpin] = useState<string | null>(null);
  // Result already on screen when this page was opened. A fresh visit shows the
  // wheel for the next player rather than the last one sold; people who were
  // watching still see the SOLD/UNSOLD card until the next spin.
  const [resultAtLoad, setResultAtLoad] = useState<number | null | undefined>(undefined);
  if (ready && state && resultAtLoad === undefined) {
    setResultAtLoad(state.phase === "sold" || state.phase === "unsold" ? state.last_result_id : null);
  }

  if (!ready) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl bg-slate-900 ring-1 ring-white/10">
        <p className="animate-pulse text-slate-400">{error ? `Can't load the auction: ${error}` : "Loading auction…"}</p>
      </div>
    );
  }
  if (!state) return null;

  const spinKey = state.spin_started_at;
  const showWheel =
    state.phase === "spinning" && !!spinKey && !!state.current_player_id && revealedSpin !== spinKey && (state.spin_candidates?.length ?? 0) > 0;

  if (showWheel) {
    const segments = state.spin_candidates!.map((id) => ({ id, name: playerById.get(id)?.name ?? "?" }));
    return (
      <div className="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-white/10">
        <p className="mb-3 text-center text-sm font-semibold uppercase tracking-widest text-amber-300">
          Spinning · {segments.length} players
        </p>
        <Wheel
          key={spinKey}
          segments={segments}
          targetId={state.current_player_id!}
          startedAt={spinKey!}
          durationMs={state.spin_duration_ms}
          onDone={() => setRevealedSpin(spinKey)}
        />
      </div>
    );
  }

  const onBlock = ["spinning", "revealed", "bidding"].includes(state.phase);
  const freshResult = (state.phase === "sold" || state.phase === "unsold") && state.last_result_id !== resultAtLoad;
  if (player && (onBlock || freshResult)) {
    const soldTeam = state.phase === "sold" && player.sold_team_id ? teamById.get(player.sold_team_id) : null;
    const status =
      state.phase === "bidding"
        ? { text: "Bidding open", cls: "bg-rose-500 text-white", pulse: true }
        : state.phase === "sold"
          ? { text: "Sold", cls: "bg-emerald-500 text-emerald-950", pulse: false }
          : state.phase === "unsold"
            ? { text: "Unsold", cls: "bg-slate-300 text-slate-900", pulse: false }
            : { text: "On the block", cls: "bg-amber-400 text-amber-950", pulse: false };
    return (
      <div className="@container space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${status.cls}`}>
            {status.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
            {status.text}
          </span>
          <span className="text-slate-400">
            {POOL_LABEL[player.pool]} · Round {config?.current_round ?? 1} · {counts.pool} left in pool
          </span>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 @xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <PlayerDeckCard
            key={`${player.id}:${spinKey}`}
            player={player}
            reveal
            size="md"
            className="max-w-[200px] @md:max-w-[240px] @xl:max-w-none"
            soldTo={soldTeam ? { team: soldTeam, price: player.sold_price ?? 0 } : null}
            unsold={state.phase === "unsold"}
          />
          {state.phase === "spinning" || state.phase === "revealed" ? (
            <p className="rounded-xl bg-amber-400/10 p-3 text-center text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30">
              Bidding opens shortly
            </p>
          ) : (
            <BidStatus />
          )}
        </div>
      </div>
    );
  }

  const last = lastResult ? playerById.get(lastResult.player_id) : null;
  const remaining = players
    .filter((p) => p.pool === pool && p.status === "pool")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name }));
  return (
    <div className="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-white/10">
      <p className="text-center text-sm font-semibold uppercase tracking-widest text-amber-300">Waiting for the next spin</p>
      <p className="mb-3 mt-1 text-center text-sm text-slate-400">
        {POOL_LABEL[pool]} · Round {config?.current_round ?? 1} · {counts.pool} in pool · {counts.sold} sold · {counts.unsold} unsold
      </p>
      {remaining.length > 0 ? (
        <Wheel segments={remaining} />
      ) : (
        <p className="py-10 text-center text-slate-400">No {POOL_LABEL[pool].toLowerCase()} players left in this round.</p>
      )}
      {last && lastResult && (
        <p className="mt-3 text-center text-sm text-slate-400">
          Last: <span className="font-semibold text-slate-200">{last.name}</span>{" "}
          {lastResult.outcome === "sold" ? `→ ${teamById.get(lastResult.team_id ?? "")?.name ?? ""}` : "unsold"}
        </p>
      )}
    </div>
  );
}
