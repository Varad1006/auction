"use client";

import { useMemo } from "react";
import { teamPoolSummary, type TeamPoolSummary } from "@/lib/rules";
import type { Pool } from "@/lib/types";
import { useLive } from "./LiveProvider";

/** Derived views over the live data used by all three screens. */
export function useAuction() {
  const live = useLive();
  return useMemo(() => {
    const state = live.state;
    const pool: Pool = state?.current_pool ?? "men";
    const config = live.configs[pool] ?? null;
    const player = live.players.find((p) => p.id === state?.current_player_id) ?? null;
    const playerConfig = player ? (live.configs[player.pool] ?? null) : null;
    const teamById = new Map(live.teams.map((t) => [t.id, t]));
    const playerById = new Map(live.players.map((p) => [p.id, p]));

    const round = playerConfig?.current_round ?? config?.current_round ?? 1;
    const activeBids = player
      ? live.bids.filter((b) => b.player_id === player.id && b.round === round && !b.voided_at).reverse()
      : [];

    const summaries = (p: Pool): Map<string, TeamPoolSummary> => {
      const cfg = live.configs[p];
      if (!cfg) return new Map();
      return new Map(live.teams.map((t) => [t.id, teamPoolSummary(t.id, p, cfg, live.limits, live.players)]));
    };

    const inPool = live.players.filter((p) => p.pool === pool);
    const counts = {
      pool: inPool.filter((p) => p.status === "pool").length,
      sold: inPool.filter((p) => p.status === "sold").length,
      unsold: inPool.filter((p) => p.status === "unsold").length,
    };

    const lastResult = [...live.results].reverse().find((r) => !r.undone_at) ?? null;

    return { ...live, pool, config, player, playerConfig, teamById, playerById, activeBids, summaries, counts, lastResult };
  }, [live]);
}
