"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { isConfigured } from "@/lib/env";
import { browserSupabase } from "@/lib/supabase/browser";
import type { AuctionState, Bid, Player, Pool, PoolConfig, Result, Team, TeamPoolLimit } from "@/lib/types";

export type Connection = "connecting" | "live" | "reconnecting" | "unconfigured";

export interface LiveData {
  ready: boolean;
  error: string | null;
  connection: Connection;
  configs: Partial<Record<Pool, PoolConfig>>;
  teams: Team[];
  limits: TeamPoolLimit[];
  players: Player[];
  state: AuctionState | null;
  /** Bids on the player currently on the block (all rounds, including voided). */
  bids: Bid[];
  /** Latest bids on any player, newest first (for the public bids feed). */
  recentBids: Bid[];
  results: Result[];
}

type Snapshot = Omit<LiveData, "ready" | "error" | "connection">;

type Action =
  | { type: "snapshot"; data: Snapshot }
  | { type: "error"; message: string }
  | { type: "connection"; value: Connection }
  | { type: "state"; row: AuctionState }
  | { type: "bids"; playerId: string | null; rows: Bid[] }
  | { type: "change"; table: TableName; event: "INSERT" | "UPDATE" | "DELETE"; row: Record<string, unknown> };

type TableName = "pool_config" | "teams" | "team_pool_limits" | "players" | "bids" | "results";

const initial: LiveData = {
  ready: false,
  error: null,
  connection: isConfigured ? "connecting" : "unconfigured",
  configs: {},
  teams: [],
  limits: [],
  players: [],
  state: null,
  bids: [],
  recentBids: [],
  results: [],
};

const RECENT_BIDS = 60;

// Realtime payloads are decoded from Postgres; normalise the columns whose
// encoding can differ from a PostgREST select.
function normalizeState(row: Record<string, unknown>): AuctionState {
  let cands = row.spin_candidates as unknown;
  if (typeof cands === "string") cands = cands.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  return { ...(row as unknown as AuctionState), spin_candidates: (cands as string[] | null) ?? null, version: Number(row.version) };
}

function normalizeConfig(row: Record<string, unknown>): PoolConfig {
  const tiers = typeof row.increment_tiers === "string" ? JSON.parse(row.increment_tiers) : row.increment_tiers;
  return { ...(row as unknown as PoolConfig), increment_tiers: tiers };
}

function upsert<T>(list: T[], row: T, same: (a: T) => boolean): T[] {
  const idx = list.findIndex(same);
  if (idx === -1) return [...list, row];
  const next = list.slice();
  next[idx] = row;
  return next;
}

function reducer(s: LiveData, a: Action): LiveData {
  switch (a.type) {
    case "snapshot": {
      // A snapshot can race a newer realtime state update; keep the newer one.
      const state = s.state && a.data.state && s.state.version > a.data.state.version ? s.state : a.data.state;
      return { ...s, ...a.data, state, ready: true, error: null };
    }
    case "error":
      return { ...s, error: a.message };
    case "connection":
      return { ...s, connection: a.value };
    case "state":
      if (s.state && a.row.version <= s.state.version) return s;
      return { ...s, state: a.row };
    case "bids":
      if (a.playerId !== (s.state?.current_player_id ?? null)) return s;
      return { ...s, bids: a.rows };
    case "change": {
      const { table, event, row } = a;
      const del = event === "DELETE";
      switch (table) {
        case "pool_config": {
          if (del) return s;
          const cfg = normalizeConfig(row);
          return { ...s, configs: { ...s.configs, [cfg.pool]: cfg } };
        }
        case "teams": {
          const list = del
            ? s.teams.filter((t) => t.id !== row.id)
            : upsert(s.teams, row as unknown as Team, (t) => t.id === row.id);
          return { ...s, teams: list.sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name)) };
        }
        case "team_pool_limits": {
          const same = (l: TeamPoolLimit) => l.team_id === row.team_id && l.pool === row.pool;
          return {
            ...s,
            limits: del ? s.limits.filter((l) => !same(l)) : upsert(s.limits, row as unknown as TeamPoolLimit, same),
          };
        }
        case "players":
          return {
            ...s,
            players: del
              ? s.players.filter((p) => p.id !== row.id)
              : upsert(s.players, row as unknown as Player, (p) => p.id === row.id),
          };
        case "results":
          return {
            ...s,
            results: del
              ? s.results.filter((r) => r.id !== Number(row.id))
              : upsert(s.results, { ...(row as unknown as Result), id: Number(row.id) }, (r) => r.id === Number(row.id)).sort(
                  (x, y) => x.id - y.id,
                ),
          };
        case "bids": {
          if (del) {
            return {
              ...s,
              bids: s.bids.filter((b) => b.id !== Number(row.id)),
              recentBids: s.recentBids.filter((b) => b.id !== Number(row.id)),
            };
          }
          const bid = { ...(row as unknown as Bid), id: Number(row.id) };
          const recentBids = upsert(s.recentBids, bid, (b) => b.id === bid.id)
            .sort((x, y) => y.id - x.id)
            .slice(0, RECENT_BIDS);
          if (bid.player_id !== s.state?.current_player_id) return { ...s, recentBids };
          return { ...s, recentBids, bids: upsert(s.bids, bid, (b) => b.id === bid.id).sort((x, y) => x.id - y.id) };
        }
      }
    }
  }
}

const LiveContext = createContext<LiveData & { refresh: () => void }>({ ...initial, refresh: () => {} });

const TABLES: TableName[] = ["pool_config", "teams", "team_pool_limits", "players", "bids", "results"];

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [data, dispatch] = useReducer(reducer, initial);
  const playerRef = useRef<string | null>(null);
  const loadSeq = useRef(0);

  const loadBids = useCallback(async (playerId: string | null) => {
    if (!playerId) {
      dispatch({ type: "bids", playerId: null, rows: [] });
      return;
    }
    const { data: rows, error } = await browserSupabase()
      .from("bids")
      .select("*")
      .eq("player_id", playerId)
      .order("id");
    if (!error) dispatch({ type: "bids", playerId, rows: rows as Bid[] });
  }, []);

  const loadAll = useCallback(async () => {
    if (!isConfigured) return;
    const seq = ++loadSeq.current;
    const db = browserSupabase();
    const [configs, teams, limits, players, state, results, recent] = await Promise.all([
      db.from("pool_config").select("*"),
      db.from("teams").select("*").order("sort_order").order("name"),
      db.from("team_pool_limits").select("*"),
      db.from("players").select("*").order("name"),
      db.from("auction_state").select("*").eq("id", 1).maybeSingle(),
      db.from("results").select("*").order("id"),
      db.from("bids").select("*").order("id", { ascending: false }).limit(RECENT_BIDS),
    ]);
    const failed = [configs, teams, limits, players, state, results, recent].find((r) => r.error);
    if (failed?.error) {
      dispatch({ type: "error", message: failed.error.message });
      return;
    }
    const st = state.data ? normalizeState(state.data) : null;
    let bids: Bid[] = [];
    if (st?.current_player_id) {
      const b = await db.from("bids").select("*").eq("player_id", st.current_player_id).order("id");
      bids = (b.data as Bid[]) ?? [];
    }
    if (seq !== loadSeq.current) return; // a newer load superseded this one
    playerRef.current = st?.current_player_id ?? null;
    dispatch({
      type: "snapshot",
      data: {
        configs: Object.fromEntries((configs.data ?? []).map((c) => [c.pool, normalizeConfig(c)])),
        teams: teams.data as Team[],
        limits: limits.data as TeamPoolLimit[],
        players: players.data as Player[],
        state: st,
        bids,
        recentBids: (recent.data as Bid[]).map((b) => ({ ...b, id: Number(b.id) })),
        results: results.data as Result[],
      },
    });
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    const db = browserSupabase();
    let channel: RealtimeChannel = db.channel("auction-live");

    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "auction_state" },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === "DELETE") return;
        const row = normalizeState(payload.new);
        dispatch({ type: "state", row });
        if (row.current_player_id !== playerRef.current) {
          playerRef.current = row.current_player_id;
          void loadBids(row.current_player_id);
        }
      },
    );
    for (const table of TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          dispatch({ type: "change", table, event: payload.eventType, row: row as Record<string, unknown> });
        },
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        dispatch({ type: "connection", value: "live" });
        // (Re)load after every (re)subscribe so nothing missed while
        // disconnected is lost.
        void loadAll();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        dispatch({ type: "connection", value: "reconnecting" });
      }
    });

    // Phones suspend background tabs; resync when the app comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const safety = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAll();
    }, 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(safety);
      void db.removeChannel(channel);
    };
  }, [loadAll, loadBids]);

  const value = useMemo(() => ({ ...data, refresh: () => void loadAll() }), [data, loadAll]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  return useContext(LiveContext);
}
