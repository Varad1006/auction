"use client";

import { useState } from "react";
import { POOL_LABEL } from "@/lib/types";
import { BidStatus } from "./BidStatus";
import { PlayerCard } from "./PlayerCard";
import { useAuction } from "./useAuction";
import { Wheel } from "./Wheel";

/** The "block": wheel while spinning, then the player card and bid status. */
export function Stage() {
  const { ready, state, player, playerById, teamById, pool, config, counts, lastResult, error } = useAuction();
  const [revealedSpin, setRevealedSpin] = useState<string | null>(null);

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
  if (player && (onBlock || state.phase === "sold" || state.phase === "unsold")) {
    const soldTeam = state.phase === "sold" && player.sold_team_id ? teamById.get(player.sold_team_id) : null;
    return (
      <div className="space-y-3">
        <PlayerCard
          key={`${player.id}:${spinKey}`}
          player={player}
          reveal
          soldTo={soldTeam ? { team: soldTeam, price: player.sold_price ?? 0 } : null}
          unsold={state.phase === "unsold"}
        />
        {state.phase === "spinning" || state.phase === "revealed" ? (
          <p className="rounded-xl bg-amber-400/10 p-3 text-center text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30">
            On the block: bidding opens shortly
          </p>
        ) : (
          <BidStatus />
        )}
      </div>
    );
  }

  const last = lastResult ? playerById.get(lastResult.player_id) : null;
  return (
    <div className="rounded-2xl bg-slate-900 p-6 text-center ring-1 ring-white/10">
      <p className="text-4xl">🏏</p>
      <p className="mt-2 text-xl font-bold">Waiting for the next spin</p>
      <p className="mt-1 text-sm text-slate-400">
        {POOL_LABEL[pool]} · Round {config?.current_round ?? 1} · {counts.pool} in pool · {counts.sold} sold · {counts.unsold} unsold
      </p>
      {last && lastResult && (
        <p className="mt-3 text-sm text-slate-400">
          Last: <span className="font-semibold text-slate-200">{last.name}</span>{" "}
          {lastResult.outcome === "sold" ? `→ ${teamById.get(lastResult.team_id ?? "")?.name ?? ""}` : "unsold"}
        </p>
      )}
    </div>
  );
}
