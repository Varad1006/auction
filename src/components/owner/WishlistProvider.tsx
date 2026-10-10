"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, callAction } from "@/lib/api";
import { syncPush } from "@/lib/push-client";
import type { Priority, WishlistEntry } from "@/lib/wishlist";
import { useMe } from "../MeProvider";
import { useToast } from "../Toast";

interface WishlistValue {
  /** True for signed-in owners and admins previewing a team; everyone else gets an empty, inert list. */
  enabled: boolean;
  /** An admin viewing the owner screens as `teamId`, with a practice list kept in this browser. */
  preview: boolean;
  /** Admins can preview any team's owner view. */
  canPreview: boolean;
  setPreviewTeam: (teamId: string | null) => void;
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
  preview: false,
  canPreview: false,
  setPreviewTeam: () => {},
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

// Admin preview: which team, and a practice wishlist per team. Browser-only
// conveniences, so storage failures (private mode) just mean nothing is kept.
const PREVIEW_TEAM = "auction:preview-team";
const PREVIEW_LISTS = "auction:preview-wishlists";
type PracticeLists = Record<string, WishlistEntry[]>;

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: kept for this page only.
  }
}

function patchEntry(e: WishlistEntry, patch: { priority?: Priority; maxPrice?: number | null; note?: string | null }): WishlistEntry {
  return {
    ...e,
    ...(patch.priority !== undefined && { priority: patch.priority }),
    ...(patch.maxPrice !== undefined && { max_price: patch.maxPrice }),
    ...(patch.note !== undefined && { note: patch.note || null }),
  };
}

/**
 * The owner's team wishlist. It is private, so it comes from /api/wishlist
 * (not realtime); it reloads when the app regains focus so co-owners on
 * other phones stay roughly in sync. Changes are applied optimistically.
 *
 * Admins can preview the owner screens as any team. The preview never reads
 * or writes that team's real wishlist (which stays private to its owners);
 * it uses a practice list saved only in the admin's browser.
 */
export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { me } = useMe();
  const toast = useToast();
  const enabled = me?.role === "owner" && !!me.teamId;
  const [data, setData] = useState<WishlistData | null>(null);
  const [previewTeam, setPreviewTeamState] = useState<string | null>(() => readStored<string | null>(PREVIEW_TEAM, null));
  const [practice, setPractice] = useState<PracticeLists>(() => readStored<PracticeLists>(PREVIEW_LISTS, {}));
  const canPreview = me?.role === "admin";
  const previewing = canPreview && !!previewTeam;

  const setPreviewTeam = useCallback((teamId: string | null) => {
    setPreviewTeamState(teamId);
    store(PREVIEW_TEAM, teamId);
  }, []);

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
    if (previewing && previewTeam) {
      const entries = practice[previewTeam] ?? [];
      const byPlayer = new Map(entries.map((e) => [e.player_id, e]));
      const save = (fn: (list: WishlistEntry[]) => WishlistEntry[]) =>
        setPractice((all) => {
          const next = { ...all, [previewTeam]: fn(all[previewTeam] ?? []) };
          store(PREVIEW_LISTS, next);
          return next;
        });
      const add = async (playerId: string, priority: Priority = 2) => {
        const now = new Date().toISOString();
        save((list) =>
          list.some((e) => e.player_id === playerId)
            ? list
            : [...list, { player_id: playerId, priority, max_price: null, note: null, created_at: now, updated_at: now }],
        );
      };
      const remove = async (playerId: string) => save((list) => list.filter((e) => e.player_id !== playerId));
      return {
        enabled: true,
        preview: true,
        canPreview: true,
        setPreviewTeam,
        ready: true,
        teamId: previewTeam,
        entries,
        byPlayer,
        vapidPublicKey: null,
        add,
        update: async (playerId, patch) => save((list) => list.map((e) => (e.player_id === playerId ? patchEntry(e, patch) : e))),
        remove,
        toggle: (playerId) => (byPlayer.has(playerId) ? remove(playerId) : add(playerId)),
      };
    }
    if (!enabled) return { ...empty, canPreview, setPreviewTeam };
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
      patchLocal((list) => list.map((e) => (e.player_id === playerId ? patchEntry(e, patch) : e)));
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
      preview: false,
      canPreview: false,
      setPreviewTeam,
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
  }, [enabled, data, me?.teamId, fail, previewing, previewTeam, practice, canPreview, setPreviewTeam]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  return useContext(WishlistContext);
}
