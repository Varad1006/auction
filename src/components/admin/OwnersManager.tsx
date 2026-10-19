"use client";

import { useCallback, useEffect, useState } from "react";
import { callAction } from "@/lib/api";
import { cn, timeAgo } from "@/lib/format";
import type { OwnerMapping, UserSession } from "@/lib/types";
import { TeamBadge } from "../live/TeamBadge";
import { useAuction } from "../live/useAuction";
import { Button, Card, Field, inputBase, inputClass, useRunner } from "../ui";

const ONLINE_MS = 90_000;

export function OwnersManager() {
  const { teams, teamById } = useAuction();
  const { busy, run } = useRunner();
  const [owners, setOwners] = useState<OwnerMapping[] | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", teamId: "", label: "" });

  // Private data (emails) comes from an admin-only endpoint, not realtime.
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/overview", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setLoadError("Could not load owners");
      return;
    }
    const body = await res.json();
    setOwners(body.owners);
    setSessions(body.sessions);
    setNow(Date.parse(body.serverTime));
    setLoadError(null);
  }, []);

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active && document.visibilityState === "visible") void load();
    };
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      "save",
      () =>
        callAction("owner.upsert", {
          email: form.email,
          teamId: form.teamId,
          label: form.label || null,
        }),
      "Owner saved",
    );
    if (ok) {
      setForm({ email: "", teamId: "", label: "" });
      void load();
    }
  };

  const online = sessions.filter((s) => now - Date.parse(s.last_seen) < ONLINE_MS);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card title="Team owners">
        <p className="mb-4 text-sm text-slate-400">
          Each Gmail address belongs to one team. When that person signs in with Google they land on their team&apos;s dashboard (wishlist, max
          prices, notes, plans and alerts) and can&apos;t see any other team&apos;s. A team can have several owners; they share one dashboard. Bids
          are entered by the auctioneer. Changes apply on the owner&apos;s next page load; no need to sign in again.
        </p>
        <form onSubmit={save} className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
          <Field label="Gmail address" className="sm:col-span-2">
            <input
              className={inputClass}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              required
              placeholder="owner@gmail.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Team">
            <select className={inputClass} required value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}>
              <option value="">Choose…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label (optional)">
            <input
              className={inputClass}
              maxLength={60}
              placeholder="e.g. Owner, Star player"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </Field>
          <Button type="submit" variant="primary" busy={busy === "save"} className="sm:col-span-2">
            Add / update
          </Button>
        </form>
        {loadError && <p className="text-sm text-rose-300">{loadError}</p>}
        {owners === null ? (
          <p className="text-slate-400">Loading…</p>
        ) : owners.length === 0 ? (
          <p className="text-sm text-slate-500">No owners yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {/* Grouped by team, in the teams' order. */}
            {[...owners]
              .sort(
                (a, b) => teams.findIndex((t) => t.id === a.team_id) - teams.findIndex((t) => t.id === b.team_id) || a.email.localeCompare(b.email),
              )
              .map((o) => {
                const t = teamById.get(o.team_id);
                return (
                  <li key={o.email} className="py-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block break-all text-sm font-medium">{o.email}</span>
                        {o.label && <span className="block text-xs text-slate-500">{o.label}</span>}
                      </span>
                      {t && <TeamBadge team={t} className="shrink-0" />}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className={cn(inputBase, "min-w-0 flex-1 py-2 text-sm sm:max-w-[14rem]")}
                        value={o.team_id}
                        aria-label={`Team for ${o.email}`}
                        onChange={(e) =>
                          void run(
                            "move",
                            () =>
                              callAction("owner.upsert", {
                                email: o.email,
                                teamId: e.target.value,
                                label: o.label,
                              }),
                            "Owner moved",
                          ).then(load)
                        }
                      >
                        {teams.map((tm) => (
                          <option key={tm.id} value={tm.id}>
                            {tm.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-rose-300"
                        busy={busy === `del-${o.email}`}
                        onClick={() =>
                          confirm(`Remove ${o.email} as an owner?`) &&
                          run(`del-${o.email}`, () => callAction("owner.delete", { email: o.email }), "Owner removed").then(load)
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>

      <Card title={`Signed in now (${online.length})`}>
        <p className="mb-3 text-xs text-slate-500">Signed-in users send a heartbeat every 30s. Anonymous viewers aren&apos;t listed.</p>
        <ul className="divide-y divide-white/5">
          {sessions.length === 0 && <li className="py-2 text-sm text-slate-500">Nobody yet.</li>}
          {sessions.map((s) => {
            const isOnline = now - Date.parse(s.last_seen) < ONLINE_MS;
            const t = s.team_id ? teamById.get(s.team_id) : null;
            return (
              <li key={s.email} className={cn("flex items-center gap-3 py-2.5", !isOnline && "opacity-50")}>
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", isOnline ? "bg-emerald-400" : "bg-slate-600")} />
                {s.avatar_url ? <img src={s.avatar_url} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name ?? s.email}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {s.email} · {isOnline ? "online" : `seen ${timeAgo(s.last_seen, now)}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs capitalize text-slate-400">
                  {t && <TeamBadge team={t} />}
                  {s.role}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
