"use client";

import Link from "next/link";
import { useMe } from "@/components/MeProvider";
import { APP_NAME, isConfigured } from "@/lib/env";

export function LoginPanel({ next, error }: { next: string; error: string | null }) {
  const { me, signIn } = useMe();
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-6 text-center ring-1 ring-white/10">
        <img src="/icons/icon-192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />
        <h1 className="mt-4 text-2xl font-extrabold">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-slate-400">Team owners and organisers sign in with Google.</p>
        {error && <p className="mt-4 rounded-lg bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}
        {me?.email && (
          <p className="mt-4 rounded-lg bg-white/5 p-3 text-sm text-slate-300">
            Signed in as <b>{me.email}</b> ({me.role}).
            {me.role === "viewer" && " This email isn't an admin or a team owner."}
          </p>
        )}
        <button
          disabled={!isConfigured}
          onClick={() => void signIn(next)}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-white py-3 font-semibold text-slate-900 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Continue with Google
        </button>
        <Link href="/" className="mt-4 inline-block text-sm text-slate-400 underline">
          Just watching? Open the live view
        </Link>
      </div>
    </main>
  );
}
