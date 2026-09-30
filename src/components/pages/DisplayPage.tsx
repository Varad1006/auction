"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_NAME, CURRENCY } from "@/lib/env";
import { cn, initials, money, textOn } from "@/lib/format";
import { POOL_LABEL } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { Wheel } from "../live/Wheel";

/**
 * Projector / big-screen view: large wheel, player, current bid and team
 * purses. Sized with viewport units so it reads from the back of the room.
 */
export function DisplayPage() {
  const a = useAuction();
  const { ready, state, player, playerById, teamById, activeBids, pool, config, counts, teams, summaries, results } = a;
  const [revealedSpin, setRevealedSpin] = useState<string | null>(null);
  const [resultAtLoad, setResultAtLoad] = useState<number | null | undefined>(undefined);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.host,
    () => "",
  );
  if (ready && state && resultAtLoad === undefined) {
    setResultAtLoad(state.phase === "sold" || state.phase === "unsold" ? state.last_result_id : null);
  }

  useEffect(() => {
    // Hide the cursor when idle, like a video player.
    let t = 0;
    const show = () => {
      document.body.style.cursor = "";
      window.clearTimeout(t);
      t = window.setTimeout(() => (document.body.style.cursor = "none"), 3000);
    };
    show();
    window.addEventListener("mousemove", show);
    return () => {
      window.removeEventListener("mousemove", show);
      window.clearTimeout(t);
      document.body.style.cursor = "";
    };
  }, []);

  if (!ready || !state) {
    return <div className="flex h-dvh items-center justify-center text-[3vw] text-slate-400">Loading auction…</div>;
  }

  const spinKey = state.spin_started_at;
  const spinning =
    state.phase === "spinning" && !!spinKey && !!state.current_player_id && revealedSpin !== spinKey && (state.spin_candidates?.length ?? 0) > 0;
  const onBlock = ["spinning", "revealed", "bidding"].includes(state.phase);
  const freshResult = (state.phase === "sold" || state.phase === "unsold") && state.last_result_id !== resultAtLoad;
  const leader = state.leading_team_id ? teamById.get(state.leading_team_id) : null;
  const sums = summaries(player?.pool ?? pool);
  const recent = [...results].reverse().filter((r) => !r.undone_at).slice(0, 4);

  let main: React.ReactNode;
  if (spinning) {
    const segments = state.spin_candidates!.map((id) => ({ id, name: playerById.get(id)?.name ?? "?" }));
    main = (
      <div className="flex h-full flex-col items-center justify-center gap-[2vh]">
        <p className="text-[2.2vw] font-black uppercase tracking-[0.3em] text-amber-300">Spinning…</p>
        <div className="w-[min(70vh,48vw)]">
          <Wheel key={spinKey} segments={segments} targetId={state.current_player_id!} startedAt={spinKey!} durationMs={state.spin_duration_ms} onDone={() => setRevealedSpin(spinKey)} />
        </div>
      </div>
    );
  } else if (player && (onBlock || freshResult)) {
    const soldTeam = state.phase === "sold" && player.sold_team_id ? teamById.get(player.sold_team_id) : null;
    const availability = (player.details ?? []).find((d) => /^availab/i.test(d.label))?.value;
    main = (
      <div className="grid h-full grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-[3vw]">
        <div className="reveal relative aspect-[5/7] max-h-[78vh] w-full overflow-hidden rounded-[2vw] bg-gradient-to-br from-amber-300 via-yellow-500 to-amber-700 p-[0.35vw] shadow-2xl shadow-amber-500/30" key={player.id}>
          <div className="relative h-full w-full overflow-hidden rounded-[1.8vw] bg-slate-900">
            {player.photo_url ? (
              <img src={player.photo_url} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[10vw] font-black text-slate-600">{initials(player.name)}</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-[1.6vw]">
              {availability && <p className="mb-[0.6vh] inline-block rounded-full bg-emerald-500/25 px-[0.8vw] py-[0.3vh] text-[1.1vw] font-semibold text-emerald-200">📅 {availability}</p>}
              <p className="text-[1.6vw] font-bold text-amber-300">{player.role}</p>
              <p className="text-[3.4vw] font-black leading-none">{player.name}</p>
            </div>
          </div>
        </div>
        <div className="space-y-[2.5vh]">
          <p className={cn("inline-flex items-center gap-[0.6vw] rounded-full px-[1.2vw] py-[0.5vh] text-[1.3vw] font-black uppercase tracking-widest",
            state.phase === "bidding" ? "bg-rose-500" : state.phase === "sold" ? "bg-emerald-500 text-emerald-950" : state.phase === "unsold" ? "bg-slate-300 text-slate-900" : "bg-amber-400 text-amber-950")}>
            {state.phase === "bidding" && <span className="h-[0.7vw] w-[0.7vw] animate-pulse rounded-full bg-white" />}
            {state.phase === "bidding" ? "Bidding open" : state.phase === "sold" ? "Sold" : state.phase === "unsold" ? "Unsold" : "On the block"}
          </p>
          <div>
            <p className="text-[1.4vw] font-bold uppercase tracking-[0.3em] text-slate-400">
              {state.phase === "sold" ? "Sold for" : leader ? "Current bid" : "Base price"}
            </p>
            <p key={state.current_bid ?? "base"} className="bump whitespace-nowrap text-[7vw] font-black leading-none tabular-nums">
              {(state.current_bid ?? player.base_price).toLocaleString("en-IN")}
              <span className="ml-[1vw] text-[2.4vw] font-bold text-slate-400">{CURRENCY}</span>
            </p>
          </div>
          {soldTeam ? (
            <div className="stamp rounded-[1.2vw] px-[2vw] py-[2vh]" style={{ background: soldTeam.color, color: textOn(soldTeam.color) }}>
              <p className="text-[1.3vw] font-bold uppercase tracking-[0.3em] opacity-80">Sold to</p>
              <p className="text-[4vw] font-black leading-tight">{soldTeam.name}</p>
            </div>
          ) : leader ? (
            <div className="rounded-[1.2vw] px-[2vw] py-[1.6vh]" style={{ background: leader.color, color: textOn(leader.color) }}>
              <p className="text-[1.1vw] font-bold uppercase tracking-[0.3em] opacity-80">Leading</p>
              <p className="text-[3vw] font-black leading-tight">{leader.name}</p>
            </div>
          ) : state.phase === "unsold" ? null : (
            <p className="text-[1.8vw] font-semibold text-slate-400">{state.phase === "bidding" ? "Waiting for the first bid…" : "Bidding opens shortly"}</p>
          )}
          {activeBids.length > 1 && (
            <ol className="space-y-[0.8vh] text-[1.5vw]">
              {activeBids.slice(1, 4).map((b) => {
                const t = teamById.get(b.team_id);
                return (
                  <li key={b.id} className="flex items-center justify-between gap-[1vw] text-slate-400">
                    <span className="flex min-w-0 items-center gap-[0.8vw]">
                      <span className="h-[1vw] w-[1vw] shrink-0 rounded-full" style={{ background: t?.color }} />
                      <span className="truncate">{t?.name}</span>
                    </span>
                    <span className="font-bold tabular-nums">{money(b.amount)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    );
  } else {
    const remaining = a.players.filter((p) => p.pool === pool && p.status === "pool").sort((x, y) => x.name.localeCompare(y.name));
    main = (
      <div className="flex h-full flex-col items-center justify-center gap-[2vh]">
        <p className="text-[2.2vw] font-black uppercase tracking-[0.3em] text-amber-300">Next player coming up</p>
        {remaining.length > 0 ? (
          <div className="w-[min(74vh,52vw)]">
            <Wheel segments={remaining.map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        ) : (
          <p className="text-[2vw] text-slate-400">No {POOL_LABEL[pool].toLowerCase()} players left this round</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[radial-gradient(ellipse_at_top,#1e293b,#020617_60%)]">
      <header className="flex items-center justify-between border-b border-white/10 px-[2.5vw] py-[1.4vh]">
        <div className="flex items-center gap-[1vw]">
          <img src="/icons/icon-192.png" alt="" className="h-[4.5vh] w-[4.5vh] rounded-lg" />
          <span className="text-[1.8vw] font-black">{APP_NAME}</span>
          <span className="rounded-lg bg-white/10 px-[0.8vw] py-[0.3vh] text-[1.1vw] font-bold text-slate-300">
            {POOL_LABEL[pool]} · Round {config?.current_round ?? 1} · {counts.pool} left
          </span>
        </div>
        <div className="flex items-center gap-[1.5vw] text-[1.1vw] text-slate-400">
          <span>
            Follow live on your phone: <b className="text-amber-300">{origin}</b>
          </span>
          <button
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
            className="rounded-lg bg-white/10 px-[0.8vw] py-[0.4vh] font-semibold text-slate-200"
          >
            ⛶ Full screen
          </button>
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,27vw)] gap-[2.5vw] px-[2.5vw] py-[3vh]">
        <main className="min-h-0">{main}</main>
        <aside className="flex min-h-0 flex-col gap-[2.5vh]">
          <section className="overflow-hidden rounded-[1vw] bg-slate-900/80 ring-1 ring-white/10">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-[1vw] border-b border-white/10 px-[1vw] py-[0.8vh] text-[0.85vw] font-bold uppercase tracking-wider text-slate-500">
              <span>{POOL_LABEL[player?.pool ?? pool]} · Team</span>
              <span className="text-right">Purse left</span>
              <span className="text-right">Squad</span>
            </div>
            <ul className="divide-y divide-white/5">
              {teams.map((t) => {
                const s = sums.get(t.id);
                const leading = state.phase === "bidding" && state.leading_team_id === t.id;
                return (
                  <li key={t.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-[1vw] px-[1vw] py-[1vh] text-[1.15vw]", leading && "bg-emerald-500/15")}>
                    <span className="flex min-w-0 items-center gap-[0.6vw]">
                      <span className="h-[1vw] w-[1vw] shrink-0 rounded-full" style={{ background: t.color }} />
                      <span className="truncate font-bold">{t.name}</span>
                    </span>
                    <span className="text-right font-black tabular-nums">{(s?.remaining ?? 0).toLocaleString("en-IN")}</span>
                    <span className="text-right tabular-nums text-slate-300">
                      {s?.squadCount ?? 0}/{s?.maxSquad ?? 0}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="min-h-0 rounded-[1vw] bg-slate-900/80 p-[1vw] ring-1 ring-white/10">
            <p className="mb-[0.8vh] text-[0.85vw] font-bold uppercase tracking-wider text-slate-500">Recent results</p>
            {recent.length === 0 ? (
              <p className="text-[1vw] text-slate-500">No results yet</p>
            ) : (
              <ul className="space-y-[0.9vh] text-[1.05vw]">
                {recent.map((r) => {
                  const p = playerById.get(r.player_id);
                  const t = r.team_id ? teamById.get(r.team_id) : null;
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-[0.8vw]">
                      <span className="truncate font-semibold">{p?.name}</span>
                      {r.outcome === "sold" && t ? (
                        <span className="flex shrink-0 items-center gap-[0.5vw]">
                          <span className="rounded px-[0.4vw] text-[0.85vw] font-black" style={{ background: t.color, color: textOn(t.color) }}>
                            {t.short_name}
                          </span>
                          <b className="tabular-nums">{money(r.price)}</b>
                        </span>
                      ) : (
                        <span className="shrink-0 text-slate-500">Unsold</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
