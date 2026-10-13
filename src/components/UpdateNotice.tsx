"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const MINE = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_EVERY_MS = 5 * 60_000;

async function liveVersion(): Promise<string | null> {
  const res = await fetch("/api/version", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { version?: string | null } | null;
  return body?.version ?? null;
}

/**
 * Keeps open tabs and the installed app on the latest release. When a new
 * deployment is live: reload straight away if the app was just reopened (or
 * on the projector), otherwise offer a Reload button so nobody loses what
 * they're typing. The registration form is left alone: a reload there would
 * wipe a half-filled form, and it updates on its next visit anyway.
 */
export function UpdateNotice() {
  const path = usePathname();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!MINE || process.env.NODE_ENV !== "production" || path.startsWith("/register")) return;
    let active = true;
    const check = async (resumed: boolean) => {
      const live = await liveVersion();
      if (!active || !live || live === MINE) return;
      if (resumed || path.startsWith("/display")) window.location.reload();
      else setStale(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check(false);
    }, CHECK_EVERY_MS);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [path]);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 flex justify-center px-4">
      <div role="status" className="flex items-center gap-3 rounded-xl bg-sky-950 px-4 py-3 text-sm text-sky-100 shadow-xl ring-1 ring-sky-600">
        <span>A new version of the app is available.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-sky-400 px-3 py-1.5 font-semibold text-sky-950"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
