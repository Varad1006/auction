"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isConfigured } from "@/lib/env";
import { browserSupabase } from "@/lib/supabase/browser";
import type { Me } from "@/lib/types";

interface MeContextValue {
  me: Me | null;
  signIn: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const MeContext = createContext<MeContextValue>({ me: null, signIn: async () => {}, signOut: async () => {} });

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as Me) : null;
}

/**
 * Who the current visitor is, as resolved by the server. The role here only
 * decides which controls to render; the server re-checks it on every write.
 */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    const load = () =>
      fetchMe().then((m) => {
        if (active && m) setMe(m);
      });
    void load();
    const { data } = browserSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void load();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Heartbeat so admins can see who is signed in.
  const email = me?.email;
  useEffect(() => {
    if (!email) return;
    const beat = () => {
      if (document.visibilityState === "visible") {
        void fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
      }
    };
    beat();
    const t = window.setInterval(beat, 30_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [email]);

  const signIn = useCallback(async (next = "/") => {
    await browserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { prompt: "select_account" },
      },
    });
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/auth/signout", { method: "POST" }).catch(() => {});
    await browserSupabase().auth.signOut({ scope: "local" }).catch(() => {});
    // Full reload so realtime and every cached view restart as a viewer.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }, []);

  return <MeContext.Provider value={{ me, signIn, signOut }}>{children}</MeContext.Provider>;
}

export function useMe() {
  return useContext(MeContext);
}
