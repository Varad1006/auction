"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, callAction } from "@/lib/api";
import { syncPush } from "@/lib/push-client";
import type { Priority, WishlistEntry } from "@/lib/wishlist";
import { useMe } from "../MeProvider";
import { useToast } from "../Toast";

interface WishlistValue {
  /** True for signed-in owners; everyone else gets an empty, inert list. */
  enabled: boolean;
  ready: boolean;
  teamId: string | null;
  entries: WishlistEntry[];
  byPlayer: Map<string, WishlistEntry>;
  vapidPublicKey: string | null;
  add: (playerId: string, priority?: Priority) => Promise<void>;
  update: (playerId: string, patch: { priority?: Priority; maxPrice?: number | null; note?: string | null }) => Promise<void>;
  remove: (playerId: string) => Promise<void>;
  toggle: (playerId: string) => Promise<void>;
}

const empty: WishlistValue = {
  enabled: false,
  ready: false,
  teamId: null,
  entries: [],
  byPlayer: new Map(),
  vapidPublicKey: null,
  add: async () => {},
  update: async () => {},
  remove: async () => {},
  toggle: async () => {},
};

const WishlistContext = createContext<WishlistValue>(empty);

type WishlistData = { teamId: string; entries: WishlistEntry[]; vapidPublicKey: string | null };

async function fetchWishlist(): Promise<WishlistData | null> {
  const res = await fetch("/api/wishlist", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as WishlistData) : null;
}

/**
 * The owner's team wishlist. It is private, so it comes from /api/wishlist
 * (not realtime); it reloads when the app regains focus so co-owners on
 * other phones stay roughly in sync. Changes are applied optimistically.
 */
export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { me } = useMe();
  const toast = useToast();
  const enabled = me?.role === "owner" && !!me.teamId;
  const [data, setData] = useState<WishlistData | null>(null);

  const load = useCallback(
    () =>
      fetchWishlist().then((d) => {
        if (d) setData(d);
      }),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, load]);

  const key = data?.vapidPublicKey;
  useEffect(() => {
    if (key) void syncPush(key).catch(() => {});
  }, [key]);

  const fail = useCallback(
    (e: unknown) => {
      toast(e instanceof ApiError ? e.message : "Couldn't update the wishlist", "error");
      void load();
    },
    [toast, load],
  );

  const value = useMemo<WishlistValue>(() => {
    if (!enabled) return empty;
    const entries = data?.entries ?? [];
    const byPlayer = new Map(entries.map((e) => [e.player_id, e]));
    const patchLocal = (fn: (list: WishlistEntry[]) => WishlistEntry[]) =>
      setData((d) => (d ? { ...d, entries: fn(d.entries) } : d));

    const add = async (playerId: string, priority: Priority = 2) => {
      if (byPlayer.has(playerId)) return;
      const now = new Date().toISOString();
      patchLocal((list) => [...list, { player_id: playerId, priority, max_price: null, note: null, created_at: now, updated_at: now }]);
      try {
        const row = (await callAction("wishlist.add", { playerId, priority })) as WishlistEntry;
        patchLocal((list) => list.map((e) => (e.player_id === playerId ? row : e)));
      } catch (e) {
        fail(e);
      }
    };
    const update: WishlistValue["update"] = async (playerId, patch) => {
      patchLocal((list) =>
        list.map((e) =>
          e.player_id === playerId
            ? {
                ...e,
                ...(patch.priority !== undefined && { priority: patch.priority }),
                ...(patch.maxPrice !== undefined && { max_price: patch.maxPrice }),
                ...(patch.note !== undefined && { note: patch.note || null }),
              }
            : e,
        ),
      );
      try {
        await callAction("wishlist.update", { playerId, ...patch });
      } catch (e) {
        fail(e);
      }
    };
    const remove = async (playerId: string) => {
      patchLocal((list) => list.filter((e) => e.player_id !== playerId));
      try {
        await callAction("wishlist.remove", { playerId });
      } catch (e) {
        fail(e);
      }
    };
    return {
      enabled,
      ready: data !== null,
      teamId: data?.teamId ?? me?.teamId ?? null,
      entries,
      byPlayer,
      vapidPublicKey: data?.vapidPublicKey ?? null,
      add,
      update,
      remove,
      toggle: (playerId) => (byPlayer.has(playerId) ? remove(playerId) : add(playerId)),
    };
  }, [enabled, data, me?.teamId, fail]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  return useContext(WishlistContext);
}
