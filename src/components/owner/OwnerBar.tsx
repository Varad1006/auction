"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn, money } from "@/lib/format";
import { setSoundEnabled, soundEnabled, sounds, unlockAudio } from "@/lib/sound";
import { PRIORITY_LABEL, type WishlistEntry } from "@/lib/wishlist";
import { useAuction } from "../live/useAuction";
import { useRevealedPlayer } from "../live/useRevealedPlayer";
import { useToast } from "../Toast";
import { useWishlist } from "./WishlistProvider";

/**
 * Alerts for an owner: a wishlisted player comes up (chime, vibration,
 * toast), bidding passes their max, the player goes elsewhere, their team is
 * outbid or wins.
 */
function useOwnerAlerts(teamId: string, revealedId: string | null, soundOn: boolean) {
  const { state, teamById, playerById } = useAuction();
  const { byPlayer } = useWishlist();
  const toast = useToast();
  const soundRef = useRef(soundOn);
  const alerted = useRef<{ up: string | null; overMax: string | null }>({ up: null, overMax: null });
  const prev = useRef<{ leader: string | null; playerId: string | null; phase: string } | null>(null);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  // Browsers only allow audio after a user gesture: unlock on the first tap.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Forget earlier alerts once the block clears (an unsold player can return).
  useEffect(() => {
    if (!revealedId) alerted.current = { up: null, overMax: null };
  }, [revealedId]);

  // A wishlisted player is revealed.
  const entry = revealedId ? byPlayer.get(revealedId) : undefined;
  useEffect(() => {
    if (!revealedId || !entry || alerted.current.up === revealedId) return;
    alerted.current.up = revealedId;
    const name = playerById.get(revealedId)?.name ?? "A wishlist player";
    if (soundRef.current) sounds.wishlist();
    navigator.vibrate?.([200, 100, 200, 100, 200]);
    toast(`⭐ ${name} is up — ${PRIORITY_LABEL[entry.priority].toLowerCase()} on your wishlist`, "success");
  }, [revealedId, entry, playerById, toast]);

  // Bidding passes the owner's max on a wishlisted player.
  const bid = state?.current_bid ?? null;
  useEffect(() => {
    if (!revealedId || !entry || entry.max_price === null || bid === null || bid <= entry.max_price) return;
    if (alerted.current.overMax === revealedId || state?.leading_team_id === teamId) return;
    alerted.current.overMax = revealedId;
    toast(`Bidding passed your max of ${money(entry.max_price)} for ${playerById.get(revealedId)?.name ?? "this player"}`, "error");
  }, [revealedId, entry, bid, state?.leading_team_id, teamId, playerById, toast]);

  // Team outbid / player won / wishlisted player sold elsewhere.
  useEffect(() => {
    if (!state) return;
    const cur = { leader: state.leading_team_id, playerId: state.current_player_id, phase: state.phase };
    const p = prev.current;
    prev.current = cur;
    if (!p || p.playerId !== cur.playerId || !cur.playerId) return;
    const name = playerById.get(cur.playerId)?.name ?? "the player";
    if (p.leader === teamId && cur.leader && cur.leader !== teamId && cur.phase === "bidding") {
      if (soundRef.current) sounds.outbid();
      navigator.vibrate?.([120, 60, 120]);
      toast(`Outbid! ${teamById.get(cur.leader)?.name ?? "Another team"} leads at ${money(state.current_bid)}`, "error");
    } else if (cur.phase === "sold" && p.phase !== "sold") {
      if (cur.leader === teamId) {
        if (soundRef.current) sounds.won();
        navigator.vibrate?.([60, 40, 60, 40, 200]);
        toast(`You signed ${name} for ${money(state.current_bid)}!`, "success");
      } else if (byPlayer.has(cur.playerId)) {
        toast(`${name} went to ${teamById.get(cur.leader ?? "")?.name ?? "another team"} — removed from your wishlist`, "info");
      }
    }
  }, [state, teamId, teamById, playerById, byPlayer, toast]);
}

function WishlistStrip({ entry, name, bid, base, leading }: { entry: WishlistEntry; name: string; bid: number | null; base: number; leading: boolean }) {
  const over = entry.max_price !== null && bid !== null && bid > entry.max_price && !leading;
  return (
    <Link
      href="/wishlist"
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1",
        over ? "bg-rose-500/15 ring-rose-500/50" : "bg-amber-400/15 ring-amber-400/50",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-bold text-amber-100">⭐ {name}</span>
        <span className="block text-xs text-amber-200/80">Up now · {PRIORITY_LABEL[entry.priority]}</span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums">
        <span className="block text-slate-300">{bid === null ? `Opens ${money(base)}` : `Now ${money(bid)}`}</span>
        <span className={cn("block font-bold", over ? "text-rose-300" : "text-amber-200")}>
          {entry.max_price === null ? "No max set" : over ? `Over your max ${money(entry.max_price)}` : `Your max ${money(entry.max_price)}`}
        </span>
      </span>
    </Link>
  );
}

/** Bottom bar for owners: purse, alerts and the way into the wishlist. */
export function OwnerBar({ teamId }: { teamId: string }) {
  const { state, player, playerById, teamById, summaries, players } = useAuction();
  const { entries, byPlayer } = useWishlist();
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const revealedId = useRevealedPlayer();
  useOwnerAlerts(teamId, revealedId, soundOn);
  const team = teamById.get(teamId);
  if (!team) return null;

  const pool = player?.pool ?? state?.current_pool ?? "men";
  const summary = summaries(pool).get(teamId);
  const entry = revealedId ? byPlayer.get(revealedId) : undefined;
  const leading = !!state && state.phase === "bidding" && state.leading_team_id === teamId;
  const stillIn = entries.filter((e) => {
    const p = playerById.get(e.player_id);
    return p && p.status !== "sold";
  }).length;
  const signed = players.filter((p) => p.status === "sold" && p.sold_team_id === teamId && byPlayer.has(p.id)).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto max-w-3xl space-y-2 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-200">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: team.color }} />
            <span className="truncate">{team.name}</span>
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                setSoundEnabled(!soundOn);
                setSoundOn(!soundOn);
              }}
              aria-label={soundOn ? "Mute alerts" : "Turn on alert sounds"}
              title={soundOn ? "Sound on" : "Sound off"}
              className="rounded-md bg-white/10 px-1.5 py-0.5 text-sm"
            >
              {soundOn ? "🔔" : "🔕"}
            </button>
          </span>
          {summary && (
            <span className="shrink-0 tabular-nums">
              <b className="text-slate-200">{money(summary.remaining)}</b> left · max <b className="text-amber-300">{money(summary.maxBid)}</b>
            </span>
          )}
        </div>
        {entry && revealedId ? (
          <WishlistStrip
            entry={entry}
            name={playerById.get(revealedId)?.name ?? ""}
            bid={state?.current_bid ?? null}
            base={playerById.get(revealedId)?.base_price ?? 0}
            leading={leading}
          />
        ) : leading ? (
          <p className="rounded-xl bg-emerald-500/15 py-2.5 text-center text-sm font-bold text-emerald-300 ring-1 ring-emerald-500/40">
            Your team leads at {money(state?.current_bid)}
          </p>
        ) : (
          <Link
            href="/wishlist"
            className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm ring-1 ring-white/10 hover:bg-white/10"
          >
            <span className="font-semibold text-slate-200">
              <span className="text-amber-300">★</span> Wishlist
            </span>
            <span className="text-xs text-slate-400">
              {entries.length === 0 ? "Star players to get alerts" : `${stillIn} to play for${signed ? ` · ${signed} signed` : ""}`} →
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
