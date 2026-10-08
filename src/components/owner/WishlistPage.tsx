"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn, initials, money } from "@/lib/format";
import { minNextBid } from "@/lib/rules";
import { PLAYER_ROLES, POOL_LABEL, POOLS, type Player, type PlayerRole, type Pool } from "@/lib/types";
import {
  budgetPlan,
  marketStats,
  nextSpinChance,
  PRIORITIES,
  PRIORITY_LABEL,
  rivalsFor,
  splitWishlist,
  squadGaps,
  squadRoles,
  wishlistCost,
  type Priority,
  type WishlistEntry,
  type WishlistItem,
} from "@/lib/wishlist";
import { TeamBadge } from "../live/TeamBadge";
import { TeamsBoard } from "../live/TeamsBoard";
import { useAuction } from "../live/useAuction";
import { useRevealedPlayer } from "../live/useRevealedPlayer";
import { useMe } from "../MeProvider";
import { inputClass } from "../ui";
import { PushToggle } from "./PushToggle";
import { useWishlist } from "./WishlistProvider";
import { WishlistStar } from "./WishlistStar";

const ROLE_ICON: Record<PlayerRole, string> = { Batter: "🏏", Bowler: "🎯", "All-rounder": "⚡", "Wicket-keeper": "🧤" };
const PRIORITY_STYLE: Record<Priority, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40",
  3: "bg-white/10 text-slate-300",
};

function Thumb({ player, className }: { player: Player; className?: string }) {
  return player.photo_url ? (
    <img src={player.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("shrink-0 rounded-lg object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-slate-700 text-sm font-bold", className)}>{initials(player.name)}</span>
  );
}

/** Wishlist and planning screen for team owners. */
export function WishlistPage() {
  const { me, signIn } = useMe();
  const { enabled, teamId } = useWishlist();

  if (!me) return <p className="animate-pulse py-16 text-center text-slate-400">Loading…</p>;
  if (!enabled || !teamId) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-slate-900 p-6 text-center ring-1 ring-white/10">
        <p className="text-4xl" aria-hidden>
          ★
        </p>
        <h1 className="mt-2 text-xl font-bold">Team wishlists</h1>
        <p className="mt-2 text-slate-400">
          Team owners can star the players they want, set the most they&apos;ll pay, and get an alert the moment one of them comes up.
        </p>
        {me.email ? (
          <p className="mt-4 text-sm text-slate-400">
            {me.email} isn&apos;t linked to a team. Ask the organiser to add you as an owner.
          </p>
        ) : (
          <button onClick={() => void signIn("/wishlist")} className="mt-4 rounded-xl bg-amber-400 px-4 py-2.5 font-semibold text-amber-950">
            Owner sign-in
          </button>
        )}
      </div>
    );
  }
  return <OwnerWishlist teamId={teamId} />;
}

function OwnerWishlist({ teamId }: { teamId: string }) {
  const { ready, playerById, teamById, state, pool: currentPool, configs, summaries } = useAuction();
  const wishlist = useWishlist();
  const revealedId = useRevealedPlayer();
  const [chosenPool, setPool] = useState<Pool | null>(null);
  const pool = chosenPool ?? currentPool;
  const team = teamById.get(teamId);
  const config = configs[pool];
  const summary = summaries(pool).get(teamId);

  const { active, signed, lost } = useMemo(
    () => splitWishlist(wishlist.entries, playerById, teamId, state),
    [wishlist.entries, playerById, teamId, state],
  );
  const inPool = (list: WishlistItem[]) => list.filter((i) => i.player.pool === pool);
  const activeHere = inPool(active);

  if (!ready || !wishlist.ready) return <p className="animate-pulse py-16 text-center text-slate-400">Loading your wishlist…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">Your wishlist</h1>
          <p className="text-sm text-slate-400">
            Private to {team ? <TeamBadge team={team} /> : "your team"} — other teams can&apos;t see it.
          </p>
        </div>
        <div className="flex rounded-xl bg-white/5 p-1" role="tablist" aria-label="Pool">
          {POOLS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pool === p}
              onClick={() => setPool(p)}
              className={cn("rounded-lg px-4 py-1.5 text-sm font-bold", pool === p ? "bg-amber-400 text-amber-950" : "text-slate-300")}
            >
              {POOL_LABEL[p]} <span className="opacity-60">{active.filter((i) => i.player.pool === p).length}</span>
            </button>
          ))}
        </div>
      </div>

      <PushToggle />

      {revealedId && playerById.get(revealedId) && <BlockIntel player={playerById.get(revealedId)!} teamId={teamId} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {summary && config && <PlanCard items={activeHere} pool={pool} />}

          <section aria-labelledby="wl-h">
            <h2 id="wl-h" className="mb-2 text-lg font-bold">
              Players to go for <span className="text-slate-500">{activeHere.length}</span>
            </h2>
            {activeHere.length === 0 ? (
              <p className="rounded-xl bg-slate-900 p-5 text-sm text-slate-400 ring-1 ring-white/10">
                No {POOL_LABEL[pool].toLowerCase()} players on your wishlist yet. Add some below, or tap ☆ on the{" "}
                <Link href={`/players?pool=${pool}`} className="font-semibold text-amber-300 underline">
                  Players
                </Link>{" "}
                page.
              </p>
            ) : (
              <div className="space-y-4">
                {PRIORITIES.map((pr) => {
                  const group = activeHere.filter((i) => i.entry.priority === pr);
                  if (!group.length) return null;
                  return (
                    <div key={pr}>
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">
                        {PRIORITY_LABEL[pr]} · {group.length}
                      </p>
                      <ul className="space-y-2">
                        {group.map((item) => (
                          <WishlistRow key={item.player.id} item={item} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <AddPlayers pool={pool} />

          {inPool(signed).length > 0 && (
            <details className="rounded-xl bg-emerald-500/5 p-4 ring-1 ring-emerald-500/20" open>
              <summary className="cursor-pointer font-bold text-emerald-300">Signed from your wishlist · {inPool(signed).length}</summary>
              <ul className="mt-2 divide-y divide-white/5 text-sm">
                {inPool(signed).map(({ player, entry }) => (
                  <li key={player.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate">{player.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-300">
                      {money(player.sold_price)}
                      {entry.max_price !== null && (
                        <span className={cn("ml-2 text-xs", (player.sold_price ?? 0) <= entry.max_price ? "text-emerald-400" : "text-rose-300")}>
                          (max {money(entry.max_price)})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {inPool(lost).length > 0 && (
            <details className="rounded-xl bg-slate-900 p-4 ring-1 ring-white/10">
              <summary className="cursor-pointer font-bold text-slate-300">Went to other teams · {inPool(lost).length}</summary>
              <p className="mt-1 text-xs text-slate-500">Removed from your list automatically. If the organiser undoes a sale, the player comes back.</p>
              <ul className="mt-2 divide-y divide-white/5 text-sm">
                {inPool(lost).map(({ player }) => {
                  const t = player.sold_team_id ? teamById.get(player.sold_team_id) : null;
                  return (
                    <li key={player.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="truncate">{player.name}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums text-slate-400">
                        {t && <TeamBadge team={t} />}
                        {money(player.sold_price)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>

        <div className="space-y-5">
          <SquadCard teamId={teamId} pool={pool} />
          <MarketCard pool={pool} />
          <TeamsBoard key={pool} initialPool={pool} highlightTeamId={teamId} compact />
        </div>
      </div>
    </div>
  );
}

/** Intel on the player on the block: your limits and who can still bid. */
function BlockIntel({ player, teamId }: { player: Player; teamId: string }) {
  const { state, configs, teams, teamById, players, summaries } = useAuction();
  const { byPlayer } = useWishlist();
  const config = configs[player.pool];
  if (!state || !config) return null;
  const entry = byPlayer.get(player.id);
  const sums = summaries(player.pool);
  const mine = sums.get(teamId);
  const bidding = state.phase === "bidding";
  const leader = state.leading_team_id ? teamById.get(state.leading_team_id) : null;
  const leading = state.leading_team_id === teamId;
  const next = minNextBid(state, player, config);
  const rivals = rivalsFor(player, state, config, teams, sums, players, teamId);
  const priced = teams.length - 1 - rivals.length - (leader && !leading ? 1 : 0);
  const roleMarket = marketStats(players, player.pool).byRole.find((r) => r.role === player.role);
  const over = entry?.max_price != null && state.current_bid !== null && state.current_bid > entry.max_price && !leading;
  const canAfford = mine ? mine.maxBid >= next : false;

  return (
    <section
      className={cn("rounded-2xl p-4 ring-2", entry ? "bg-amber-400/10 ring-amber-400/60" : "bg-slate-900 ring-white/10")}
      aria-labelledby="block-h"
    >
      <div className="flex items-center justify-between gap-2">
        <p id="block-h" className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-rose-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          On the block now
        </p>
        <WishlistStar playerId={player.id} playerName={player.name} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Thumb player={player} className="h-16 w-13" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xl font-black leading-tight">{player.name}</p>
          <p className="text-sm text-slate-400">
            {ROLE_ICON[player.role]} {player.role} · {POOL_LABEL[player.pool]} · base {money(player.base_price)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{bidding && state.current_bid !== null ? "Current bid" : "Opens at"}</p>
          <p className="text-xl font-black tabular-nums">{money(state.current_bid ?? player.base_price)}</p>
          {leader && <TeamBadge team={leader} />}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-slate-950/60 p-2.5">
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">Your max bid</dt>
          <dd className={cn("font-bold tabular-nums", canAfford ? "text-white" : "text-rose-300")}>
            {mine ? money(mine.maxBid) : "–"}
            {!canAfford && <span className="block text-xs font-medium">Can&apos;t cover {money(next)}</span>}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-950/60 p-2.5">
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">Your wishlist max</dt>
          <dd className={cn("font-bold tabular-nums", over ? "text-rose-300" : "text-amber-200")}>
            {entry?.max_price != null ? money(entry.max_price) : entry ? "Not set" : "Not wishlisted"}
            {over && <span className="block text-xs font-medium">Bidding is past it</span>}
            {entry?.max_price != null && !over && state.current_bid !== null && (
              <span className="block text-xs font-medium text-slate-400">Room {money(entry.max_price - state.current_bid)}</span>
            )}
          </dd>
        </div>
        {roleMarket && roleMarket.count > 0 && (
          <div className="col-span-2 rounded-xl bg-slate-950/60 p-2.5 sm:col-span-1">
            <dt className="text-[11px] uppercase tracking-wider text-slate-500">{player.role}s so far</dt>
            <dd className="font-bold tabular-nums">
              avg {money(roleMarket.average)} <span className="text-xs font-medium text-slate-400">({roleMarket.count} sold)</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">
          Rivals who can still bid {money(next)}+ · {rivals.length}
        </p>
        {rivals.length === 0 ? (
          <p className="text-sm text-slate-400">No other team can go higher right now.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {rivals.map((r) => (
              <li key={r.team.id} className="flex items-center gap-2 rounded-lg bg-slate-950/60 px-2.5 py-1.5 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.team.color }} />
                <span className="max-w-[9rem] truncate font-semibold">{r.team.name}</span>
                <span className="tabular-nums text-slate-300">up to {money(r.maxBid)}</span>
                {r.needsRole && (
                  <span className="rounded bg-rose-500/20 px-1.5 text-[11px] font-semibold text-rose-200">needs a {player.role.toLowerCase()}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {priced > 0 && <p className="mt-1.5 text-xs text-slate-500">{priced} other team(s) can&apos;t afford the next bid.</p>}
      </div>
    </section>
  );
}

/** Budget numbers and how the wishlist fits the purse. */
function PlanCard({ items, pool }: { items: WishlistItem[]; pool: Pool }) {
  const { players, summaries } = useAuction();
  const { teamId } = useWishlist();
  const s = summaries(pool).get(teamId ?? "");
  if (!s) return null;
  const plan = budgetPlan(s);
  const cost = wishlistCost(items, pool);
  const chance = nextSpinChance(items, players, pool);
  const left = players.filter((p) => p.pool === pool && p.status === "pool").length;
  const pct = s.remaining > 0 ? Math.min(100, Math.round((cost.all / s.remaining) * 100)) : 100;

  const tiles = [
    { label: "Purse left", value: money(s.remaining), sub: `of ${money(s.purse)}` },
    { label: "Max bid now", value: money(s.maxBid), sub: plan.toMin > 1 ? `keeps ${plan.toMin - 1} base-price slots` : "no reserve needed", accent: true },
    { label: "Squad", value: `${s.squadCount}/${s.maxSquad}`, sub: plan.toMin > 0 ? `need ${plan.toMin} more (min ${s.minSquad})` : "minimum reached" },
    { label: "Per player", value: money(plan.perPlayer), sub: plan.toMin > 0 ? "average to fill the minimum" : "if you buy one more" },
  ];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
            <p className={cn("text-lg font-black tabular-nums", t.accent && "text-amber-300")}>{t.value}</p>
            <p className="text-[11px] text-slate-500">{t.sub}</p>
          </div>
        ))}
      </div>
      {cost.count > 0 && (
        <div className="rounded-xl bg-slate-900 p-3 text-sm ring-1 ring-white/10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p>
              Your {cost.count} target{cost.count === 1 ? "" : "s"} would cost <b className="tabular-nums">{money(cost.all)}</b>
              {cost.must > 0 && (
                <span className="text-slate-400">
                  {" "}
                  (must-haves <b className="tabular-nums text-slate-200">{money(cost.must)}</b>)
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">at your max prices, base price where none is set</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className={cn("h-full rounded-full", cost.all > s.remaining ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
          </div>
          {cost.must > s.remaining ? (
            <p className="mt-2 text-rose-300">Even your must-haves cost more than your purse — lower some max prices.</p>
          ) : cost.all > s.remaining ? (
            <p className="mt-2 text-amber-200">You can&apos;t afford every target at these prices. Expect to win some, not all.</p>
          ) : (
            <p className="mt-2 text-emerald-300">Your purse covers every target at your max prices.</p>
          )}
          {left > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              {Math.round(chance * 100)}% chance the next spin is one of yours ({Math.round(chance * left)} of {left} left in the pool).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MaxPriceEditor({ entry }: { entry: WishlistEntry }) {
  const { update } = useWishlist();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (entry.max_price === null ? "" : String(entry.max_price));
  const save = () => {
    if (draft === null) return;
    const n = draft.trim() === "" ? null : Math.max(0, Math.round(Number(draft)));
    setDraft(null);
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== entry.max_price) void update(entry.player_id, { maxPrice: n });
  };
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 font-medium text-slate-300">My max price</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={100}
        placeholder="No limit"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(inputClass, "max-w-[10rem] py-1.5 tabular-nums")}
      />
    </label>
  );
}

function WishlistRow({ item }: { item: WishlistItem }) {
  const { update, remove } = useWishlist();
  const { state } = useAuction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { player, entry, status } = item;
  const over = status === "up" && entry.max_price !== null && (state?.current_bid ?? 0) > entry.max_price;

  return (
    <li className={cn("rounded-xl bg-slate-900 ring-1", status === "up" ? "ring-2 ring-rose-500" : "ring-white/10")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-2.5 text-left">
        <Thumb player={player} className="h-14 w-11" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{player.name}</span>
          <span className="block truncate text-xs text-slate-400">
            {status === "up" && (
              <span className="mr-1.5 animate-pulse rounded bg-rose-500 px-1.5 text-[10px] font-bold uppercase text-white">Up now</span>
            )}
            {status === "unsold" && <span className="mr-1.5 rounded bg-white/10 px-1.5 text-[10px] font-bold uppercase text-slate-300">Unsold</span>}
            {ROLE_ICON[player.role]} {player.role} · base {money(player.base_price)}
            {entry.note && " · 📝"}
          </span>
          {entry.note && !open && <span className="block truncate text-xs italic text-slate-500">{entry.note}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">My max</span>
          <span className={cn("block font-bold tabular-nums", over ? "text-rose-300" : entry.max_price === null ? "text-slate-500" : "text-amber-200")}>
            {entry.max_price === null ? "—" : money(entry.max_price)}
          </span>
        </span>
        <span className={cn("text-slate-500 transition", open && "rotate-180")} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-300">Priority</span>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void update(player.id, { priority: p })}
                aria-pressed={entry.priority === p}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold",
                  entry.priority === p ? PRIORITY_STYLE[p] : "text-slate-400 ring-1 ring-white/15",
                )}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
          <MaxPriceEditor entry={entry} />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-300">Private note</span>
            <textarea
              rows={2}
              maxLength={300}
              placeholder="e.g. opens the batting, fit for all dates"
              value={note ?? entry.note ?? ""}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== null && note.trim() !== (entry.note ?? "")) void update(player.id, { note: note.trim() || null });
                setNote(null);
              }}
              className={inputClass}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <Link href={`/players?pool=${player.pool}`} className="text-xs text-slate-400 underline">
              See all players
            </Link>
            <button type="button" onClick={() => void remove(player.id)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/10">
              Remove from wishlist
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Search the players still available and star them. */
function AddPlayers({ pool }: { pool: Pool }) {
  const { players } = useAuction();
  const { byPlayer, add } = useWishlist();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const LIMIT = 8;
  const options = players
    .filter((p) => p.pool === pool && p.status !== "sold" && !byPlayer.has(p.id))
    .filter((p) => !role || p.role === role)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section aria-labelledby="add-h" className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10">
      <h2 id="add-h" className="text-lg font-bold">
        Add players
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_11rem]">
        <input className={inputClass} placeholder={`Search ${POOL_LABEL[pool].toLowerCase()} players…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {PLAYER_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      {options.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No available players match.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {options.slice(0, LIMIT).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Thumb player={p} className="h-10 w-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block text-xs text-slate-400">
                  {p.role} · base {money(p.base_price)}
                  {p.status === "unsold" && " · unsold"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void add(p.id)}
                aria-label={`Add ${p.name} to wishlist`}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-bold text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-400/10"
              >
                ☆ Add
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length > LIMIT && (
        <p className="mt-2 text-xs text-slate-500">
          Showing {LIMIT} of {options.length}. Search by name, or browse the{" "}
          <Link href={`/players?pool=${pool}`} className="text-amber-300 underline">
            Players
          </Link>{" "}
          page.
        </p>
      )}
    </section>
  );
}

function SquadCard({ teamId, pool }: { teamId: string; pool: Pool }) {
  const { players, summaries } = useAuction();
  const roles = squadRoles(players, teamId, pool);
  const squad = players.filter((p) => p.pool === pool && p.status === "sold" && p.sold_team_id === teamId);
  const s = summaries(pool).get(teamId);
  const gaps = squadGaps(roles, squad.length);
  return (
    <section className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10" aria-labelledby="squad-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="squad-h" className="text-lg font-bold">
          Your squad
        </h2>
        <span className="text-sm text-slate-400 tabular-nums">
          {squad.length}/{s?.maxSquad ?? "–"} · spent {money(s?.spent ?? 0)}
        </span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {PLAYER_ROLES.map((r) => (
          <li key={r} className={cn("flex items-center justify-between rounded-lg px-2.5 py-1.5", roles[r] ? "bg-white/5" : "bg-white/[0.02] text-slate-500")}>
            <span>
              {ROLE_ICON[r]} {r}
            </span>
            <b className="tabular-nums">{roles[r]}</b>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-amber-200">
          {gaps.map((g) => (
            <li key={g}>⚠ {g}</li>
          ))}
        </ul>
      )}
      {squad.length > 0 && (
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {squad
            .sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0))
            .map((p) => (
              <li key={p.id} className="flex justify-between gap-2 py-1.5">
                <span className="truncate">
                  {ROLE_ICON[p.role]} {p.name}
                </span>
                <span className="shrink-0 tabular-nums text-slate-300">{money(p.sold_price)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function MarketCard({ pool }: { pool: Pool }) {
  const { players, teamById } = useAuction();
  const m = marketStats(players, pool);
  const top = m.highest?.player.sold_team_id ? teamById.get(m.highest.player.sold_team_id) : null;
  return (
    <section className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10" aria-labelledby="market-h">
      <h2 id="market-h" className="text-lg font-bold">
        Market so far
      </h2>
      {m.sold === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No {POOL_LABEL[pool].toLowerCase()} players sold yet — prices will show here.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-400">
            {m.sold} sold · average <b className="text-slate-100 tabular-nums">{money(m.average)}</b>
          </p>
          {m.highest && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-400">
              Top: <b className="text-slate-100">{m.highest.player.name}</b> {money(m.highest.price)} {top && <TeamBadge team={top} />}
            </p>
          )}
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-1 font-semibold">Role</th>
                <th className="py-1 text-right font-semibold">Sold</th>
                <th className="py-1 text-right font-semibold">Avg</th>
                <th className="py-1 text-right font-semibold">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {m.byRole.map((r) => (
                <tr key={r.role}>
                  <td className="py-1.5">
                    {ROLE_ICON[r.role]} {r.role}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.count ? r.average.toLocaleString("en-IN") : "–"}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", r.left <= 2 && "font-bold text-rose-300")}>{r.left}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">&quot;Left&quot; counts players not yet sold. Scarce roles tend to go for more.</p>
        </>
      )}
    </section>
  );
}
