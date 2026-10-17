"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PlayerInsight } from "@/lib/insights";
import { useMe } from "../MeProvider";

interface AdminInfo {
  configured: boolean;
  model: string;
  batchSize: number;
}

interface InsightsValue {
  /** Team owners and admins; everyone else never loads them. */
  enabled: boolean;
  ready: boolean;
  byPlayer: Map<string, PlayerInsight>;
  admin: AdminInfo | null;
  reload: () => Promise<void>;
}

const InsightsContext = createContext<InsightsValue>({
  enabled: false,
  ready: false,
  byPlayer: new Map(),
  admin: null,
  reload: async () => {},
});

async function fetchInsights(): Promise<{ insights: PlayerInsight[]; admin: AdminInfo | null } | null> {
  const res = await fetch("/api/insights", { cache: "no-store" }).catch(() => null);
  return res?.ok ? res.json() : null;
}

/** AI scouting notes, loaded once for owners and admins (they rarely change). */
export function InsightsProvider({ children }: { children: React.ReactNode }) {
  const { me } = useMe();
  const enabled = me?.role === "admin" || (me?.role === "owner" && !!me.teamId);
  const [data, setData] = useState<{ insights: PlayerInsight[]; admin: AdminInfo | null } | null>(null);

  const reload = useCallback(
    () =>
      fetchInsights().then((d) => {
        if (d) setData(d);
      }),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void reload();
    // Pick up freshly generated notes when the app comes back to the front.
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, reload]);

  const value = useMemo<InsightsValue>(
    () => ({
      enabled,
      ready: enabled && data !== null,
      byPlayer: new Map((enabled ? (data?.insights ?? []) : []).map((i) => [i.playerId, i])),
      admin: enabled ? (data?.admin ?? null) : null,
      reload,
    }),
    [enabled, data, reload],
  );
  return <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>;
}

export function useInsights() {
  return useContext(InsightsContext);
}

/** The notes for one player, if the AI has written them. */
export function useInsight(playerId: string | null | undefined): PlayerInsight | null {
  const { byPlayer } = useInsights();
  const i = playerId ? byPlayer.get(playerId) : undefined;
  return i && i.generatedAt ? i : null;
}
