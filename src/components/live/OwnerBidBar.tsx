"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, callAction } from "@/lib/api";
import { cn, money } from "@/lib/format";
import { checkBid, quickBidAmounts } from "@/lib/rules";
import { setSoundEnabled, soundEnabled, sounds, unlockAudio } from "@/lib/sound";
import { useToast } from "../Toast";
import { useAuction } from "./useAuction";

/**
 * One-tap bid buttons for an owner's own team. Buttons are disabled using the
 * same rules the server enforces; the server still has the final say (e.g.
 * if another team bid a moment earlier).
 */
/**
 * Alerts an owner when another team outbids them (sound, vibration, toast)
 * and when their team wins a player.
 */
function useOwnerAlerts(teamId: string, soundOn: boolean) {
  const { state, teamById } = useAuction();
  const toast = useToast();
  const prev = useRef<{ leader: string | null; playerId: string | null; phase: string } | null>(null);
  const soundRef = useRef(soundOn);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  // Browsers only allow audio after a user gesture: unlock on the first tap.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!state) return;
    const cur = { leader: state.leading_team_id, playerId: state.current_player_id, phase: state.phase };
    const p = prev.current;
    prev.current = cur;
    if (!p || p.playerId !== cur.playerId) return;
    if (p.leader === teamId && cur.leader && cur.leader !== teamId && cur.phase === "bidding") {
      const rival = teamById.get(cur.leader);
      if (soundRef.current) sounds.outbid();
      navigator.vibrate?.([120, 60, 120]);
      toast(`Outbid! ${rival?.name ?? "Another team"} leads at ${money(state.current_bid)}`, "error");
    } else if (cur.phase === "sold" && p.phase !== "sold" && cur.leader === teamId) {
      if (soundRef.current) sounds.won();
      navigator.vibrate?.([60, 40, 60, 40, 200]);
      toast(`You won the player for ${money(state.current_bid)}!`, "success");
    }
  }, [state, teamId, teamById, toast]);
}

export function OwnerBidBar({ teamId }: { teamId: string }) {
  const { state, player, playerConfig, teamById, summaries } = useAuction();
  const toast = useToast();
  const [pending, setPending] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  useOwnerAlerts(teamId, soundOn);
  const team = teamById.get(teamId);
  if (!team) return null;

  const pool = player?.pool ?? state?.current_pool ?? "men";
  const summary = summaries(pool).get(teamId);
  const bidding = state?.phase === "bidding" && player && playerConfig;
  const leading = bidding && state.leading_team_id === teamId;
  const amounts = bidding ? quickBidAmounts(state, player, playerConfig) : [];

  async function place(amount: number) {
    if (!player) return;
    setPending(amount);
    try {
      await callAction("bid.place", { playerId: player.id, amount });
      navigator.vibrate?.(30);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Bid failed", "error");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
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
              aria-label={soundOn ? "Mute outbid alerts" : "Turn on outbid alerts"}
              title={soundOn ? "Sound on" : "Sound off"}
              className="rounded-md bg-white/10 px-1.5 py-0.5 text-sm"
            >
              {soundOn ? "🔔" : "🔕"}
            </button>
          </span>
          {summary && (
            <span className="tabular-nums">
              {money(summary.remaining)} left · {summary.squadCount}/{summary.maxSquad} squad · max {money(summary.maxBid)}
            </span>
          )}
        </div>
        {!bidding ? (
          <p className="rounded-xl bg-white/5 py-3 text-center text-sm font-medium text-slate-400">
            {state?.phase === "spinning" || state?.phase === "revealed" ? "Bidding opens shortly…" : "Waiting for the next player"}
          </p>
        ) : leading ? (
          <p className="rounded-xl bg-emerald-500/15 py-3 text-center font-bold text-emerald-300 ring-1 ring-emerald-500/40">
            You&apos;re leading at {money(state.current_bid)}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {amounts.map((amount, i) => {
              const check = summary ? checkBid(amount, teamId, state, player, playerConfig, summary) : { ok: false as const, message: "" };
              const disabled = !check.ok || pending !== null;
              return (
                <button
                  key={amount}
                  disabled={disabled}
                  onClick={() => place(amount)}
                  title={check.ok ? undefined : check.message}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl py-3 font-extrabold tabular-nums transition active:scale-95",
                    i === 0 ? "col-span-1 bg-amber-400 text-amber-950 text-lg" : "bg-white/10 text-white",
                    disabled && "opacity-40",
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    {pending === amount ? "Bidding…" : i === 0 ? "Bid" : "Jump"}
                  </span>
                  {money(amount)}
                </button>
              );
            })}
            {(() => {
              const first = amounts[0];
              const check = first !== undefined && summary ? checkBid(first, teamId, state, player, playerConfig, summary) : null;
              return check && !check.ok ? (
                <p className="col-span-3 text-center text-xs text-rose-300">{check.message}</p>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
