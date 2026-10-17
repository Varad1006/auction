"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerInsight } from "@/lib/insights";
import { useLive } from "../live/LiveProvider";
import { useMe } from "../MeProvider";

export interface SeasonPrices {
  season: number;
  pool: "men" | "women";
  players: number;
  sold: number;
  average: number | null;
}

export interface AdminInfo {
  configured: boolean;
  provider: "groq" | "anthropic" | null;
  model: string | null;
  batchSize: number;
  /** Previous auctions' price lists loaded so far. */
  seasons: SeasonPrices[];
  /** Seconds until the AI is asked again after a rate limit. */
  pausedFor: number | null;
}

interface InsightsData {
  insights: PlayerInsight[];
  /** Whether an AI key is set, so missing notes get written. */
  ai: boolean;
  admin: AdminInfo | null;
}

interface InsightsValue {
  /** Team owners and admins; everyone else never loads them. */
  enabled: boolean;
  ready: boolean;
  ai: boolean;
  byPlayer: Map<string, PlayerInsight>;
  admin: AdminInfo | null;
  reload: () => Promise<void>;
  /** Asks for a player's AI note if it doesn't have one yet (queued, at most once per visit). */
  requestNote: (playerId: string) => void;
  /** Players whose note is being written right now for this device. */
  writing: Set<string>;
}

const InsightsContext = createContext<InsightsValue>({
  enabled: false,
  ready: false,
  ai: false,
  byPlayer: new Map(),
  admin: null,
  reload: async () => {},
  requestNote: () => {},
  writing: new Set(),
});

async function fetchInsights(): Promise<InsightsData | null> {
  const res = await fetch("/api/insights", { cache: "no-store" }).catch(() => null);
  return res?.ok ? res.json() : null;
}

interface NoteReply {
  status: "written" | "done" | "busy" | "off";
  written: number;
  remaining: number | null;
  wait: number | null;
}

async function post(path: string, body: unknown): Promise<NoteReply | null> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = await res?.json().catch(() => null);
  return res?.ok ? (json?.data as NoteReply) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prices and AI notes for owners and admins. Prices are worked out on the
 * server and follow the market, so they reload after every sale. Missing
 * notes are asked for when a player is opened or starred, and filled in a
 * few at a time in the background while the app is open.
 */
export function InsightsProvider({ children }: { children: React.ReactNode }) {
  const { me } = useMe();
  const live = useLive();
  const enabled = me?.role === "admin" || (me?.role === "owner" && !!me.teamId);
  const [data, setData] = useState<InsightsData | null>(null);
  const [writing, setWriting] = useState<Set<string>>(new Set());
  const queue = useRef<string[]>([]);
  const asked = useRef(new Set<string>());
  const draining = useRef(false);
  const dataRef = useRef<InsightsData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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
    // Pick up notes written elsewhere when the app comes back to the front.
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, reload]);

  // Prices follow the market: reload when a sale, an undo or a purse changes it.
  const market = useMemo(
    () =>
      [
        live.players.map((p) => `${p.id}:${p.status}:${p.sold_price ?? ""}:${p.sold_team_id ?? ""}`).join(","),
        live.limits.map((l) => `${l.team_id}:${l.pool}:${l.purse}:${l.min_squad}:${l.max_squad}`).join(","),
        Object.values(live.configs).map((c) => `${c?.pool}:${c?.purse}:${c?.min_squad}:${c?.max_squad}`).join(","),
      ].join("|"),
    [live.players, live.limits, live.configs],
  );
  const firstMarket = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (firstMarket.current) {
      firstMarket.current = false;
      return;
    }
    const t = setTimeout(() => void reload(), 1500);
    return () => clearTimeout(t);
  }, [enabled, market, reload]);

  // Notes asked for on this device, written one at a time.
  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const id = queue.current[0];
        if (dataRef.current?.insights.find((i) => i.playerId === id)?.hasNote) {
          queue.current.shift();
          continue;
        }
        setWriting((w) => new Set(w).add(id));
        const r = await post("/api/insights/note", { playerId: id });
        setWriting((w) => {
          const next = new Set(w);
          next.delete(id);
          return next;
        });
        if (r?.status === "busy") {
          // Rate-limited or being written elsewhere: the background fill or a later visit gets it.
          queue.current.shift();
          asked.current.delete(id);
          await sleep(Math.min(r.wait ?? 10, 30) * 1000);
          continue;
        }
        queue.current.shift();
        if (r?.status === "written") await reload();
      }
    } finally {
      draining.current = false;
    }
  }, [reload]);

  const ai = enabled && !!data?.ai;
  const requestNote = useCallback(
    (playerId: string) => {
      if (!ai || asked.current.has(playerId)) return;
      const insight = dataRef.current?.insights.find((i) => i.playerId === playerId);
      // Only players with a price guide (the pool has data) and no note yet.
      if (!insight || insight.hasNote || insight.priceFair === null) return;
      asked.current.add(playerId);
      queue.current.push(playerId);
      void drain();
    },
    [ai, drain],
  );

  // Background fill: while the app is open and visible, ask for the next few
  // missing notes. Every device shares one pace on the server.
  const missing = (data?.insights ?? []).some((i) => !i.hasNote && i.priceFair !== null);
  useEffect(() => {
    if (!ai || !missing) return;
    let stopped = false;
    void (async () => {
      // Spread devices out a little.
      await sleep(3000 + Math.random() * 5000);
      while (!stopped) {
        if (document.visibilityState !== "visible") {
          await sleep(10_000);
          continue;
        }
        const r = await post("/api/insights/fill", {});
        if (stopped) break;
        if (!r) {
          await sleep(30_000);
          continue;
        }
        if (r.written) await reload();
        if (r.status === "done" || r.status === "off" || r.remaining === 0) break;
        await sleep((Math.max(r.wait ?? 30, 1) + Math.random() * 3) * 1000);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ai, missing, reload]);

  const value = useMemo<InsightsValue>(
    () => ({
      enabled,
      ready: enabled && data !== null,
      ai,
      byPlayer: new Map((enabled ? (data?.insights ?? []) : []).map((i) => [i.playerId, i])),
      admin: enabled ? (data?.admin ?? null) : null,
      reload,
      requestNote,
      writing,
    }),
    [enabled, data, ai, reload, requestNote, writing],
  );
  return <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>;
}

export function useInsights() {
  return useContext(InsightsContext);
}

/** The price guide (and AI note, if written) for one player. */
export function useInsight(playerId: string | null | undefined): PlayerInsight | null {
  const { byPlayer } = useInsights();
  const i = playerId ? byPlayer.get(playerId) : undefined;
  return i && (i.hasNote || i.priceFair !== null) ? i : null;
}
