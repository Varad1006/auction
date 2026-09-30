"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/env";
import { cn } from "@/lib/format";
import { POOL_LABEL } from "@/lib/types";
import { useLive } from "./live/LiveProvider";
import { useMe } from "./MeProvider";

const CONNECTION: Record<string, { dot: string; label: string }> = {
  live: { dot: "bg-emerald-400", label: "Live" },
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting" },
  reconnecting: { dot: "bg-rose-500 animate-pulse", label: "Reconnecting" },
  unconfigured: { dot: "bg-slate-500", label: "Not configured" },
};

export function Header() {
  const { connection, state, configs } = useLive();
  const { me, signIn, signOut } = useMe();
  const conn = CONNECTION[connection];
  const pool = state?.current_pool;

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-extrabold tracking-tight">
          <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="truncate">{APP_NAME}</span>
        </Link>
        {pool && (
          <span className="hidden rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-slate-300 sm:inline">
            {POOL_LABEL[pool]} · R{configs[pool]?.current_round ?? 1}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-xs text-slate-400" title={conn.label}>
          <span className={cn("h-2 w-2 rounded-full", conn.dot)} />
          <span className="hidden sm:inline">{conn.label}</span>
        </span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {me?.role === "admin" && (
            <Link href="/admin" className="rounded-lg bg-amber-400 px-3 py-1.5 font-semibold text-amber-950">
              Admin
            </Link>
          )}
          {me?.email ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                {me.avatarUrl ? (
                  <img src={me.avatarUrl} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="h-6 w-6 rounded-full bg-slate-600" />
                )}
                <span className="text-xs font-semibold capitalize text-slate-300">{me.role}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-xl bg-slate-900 p-3 text-sm shadow-xl ring-1 ring-white/10">
                <p className="truncate font-semibold">{me.name ?? me.email}</p>
                <p className="truncate text-xs text-slate-400">{me.email}</p>
                {me.role === "viewer" && (
                  <p className="mt-2 text-xs text-slate-400">
                    {me.notGoogle
                      ? "Sign in with Google to get owner or admin access."
                      : "This email isn't assigned to a team. Ask the organiser if you're an owner."}
                  </p>
                )}
                <button onClick={() => void signOut()} className="mt-3 w-full rounded-lg bg-white/10 py-2 font-semibold">
                  Sign out
                </button>
              </div>
            </details>
          ) : connection !== "unconfigured" ? (
            <button onClick={() => void signIn(window.location.pathname)} className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold">
              Owner sign-in
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
