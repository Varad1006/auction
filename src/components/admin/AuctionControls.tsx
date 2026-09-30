"use client";

import { useState } from "react";
import { callAction } from "@/lib/api";
import { cn, money } from "@/lib/format";
import { checkBid, minNextBid } from "@/lib/rules";
import { POOL_LABEL, POOLS } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { Button, Card, inputClass, useRunner } from "../ui";

export function AuctionControls() {
  const a = useAuction();
  const { state, player, playerConfig, teams, teamById, playerById, pool, config, counts, summaries, lastResult } = a;
  const { busy, run } = useRunner();
  const [pick, setPick] = useState("");
  const [customTeam, setCustomTeam] = useState("");
  const [customAmount, setCustomAmount] = useState("");

  if (!a.ready || !state) return <Card>Loading…</Card>;

  const phase = state.phase;
  const onBlock = phase === "spinning" || phase === "revealed" || phase === "bidding";
  const blockFree = !onBlock || state.bid_count === 0;
  const leader = state.leading_team_id ? teamById.get(state.leading_team_id) : null;
  const poolPlayers = a.players.filter((p) => p.pool === pool && p.status === "pool").sort((x, y) => x.name.localeCompare(y.name));
  const sums = player ? summaries(player.pool) : null;
  const lastResultPlayer = lastResult ? playerById.get(lastResult.player_id) : null;

  const spin = () => run("spin", () => callAction("auction.spin", { durationMs: 6000 }));

  return (
    <Card className="space-y-5">
      {/* Pool & round */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-white/5 p-1">
          {POOLS.map((p) => (
            <button
              key={p}
              disabled={!blockFree || busy !== null}
              onClick={() => p !== pool && run("pool", () => callAction("auction.setPool", { pool: p }))}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-50",
                pool === p ? "bg-amber-400 text-amber-950" : "text-slate-300",
              )}
            >
              {POOL_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-400">
          Round <b className="text-slate-100">{config?.current_round ?? 1}</b> · {counts.pool} in pool · {counts.sold} sold · {counts.unsold} unsold
        </p>
      </div>

      {/* Primary actions for the current phase */}
      {!onBlock && (
        <div className="space-y-3">
          <Button variant="primary" size="lg" className="w-full text-lg" busy={busy === "spin"} disabled={counts.pool === 0} onClick={spin}>
            🎡 Spin the wheel
          </Button>
          {counts.pool === 0 && counts.unsold > 0 && (
            <Button
              variant="success"
              className="w-full"
              busy={busy === "round"}
              onClick={() =>
                confirm(`Start round ${(config?.current_round ?? 1) + 1} with ${counts.unsold} unsold ${POOL_LABEL[pool].toLowerCase()} player(s)?`) &&
                run("round", () => callAction("auction.advanceRound", { pool }), "Next round started")
              }
            >
              Start round {(config?.current_round ?? 1) + 1} with {counts.unsold} unsold
            </Button>
          )}
          {counts.pool === 0 && counts.unsold === 0 && (
            <p className="text-center text-sm text-slate-400">Every {POOL_LABEL[pool].toLowerCase()} player has been sold.</p>
          )}
        </div>
      )}

      {(phase === "spinning" || phase === "revealed") && player && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="success"
            size="lg"
            className="col-span-2"
            busy={busy === "open"}
            onClick={() => run("open", () => callAction("auction.openBidding", {}))}
          >
            Open bidding for {player.name}
          </Button>
          <Button busy={busy === "unsold"} onClick={() => run("unsold", () => callAction("auction.unsold", { playerId: player.id }))}>
            Mark unsold
          </Button>
          <Button busy={busy === "spin"} onClick={spin}>
            Re-spin
          </Button>
        </div>
      )}

      {phase === "bidding" && player && (
        <div className="space-y-2">
          <Button
            variant="success"
            size="lg"
            className="w-full text-lg"
            disabled={!leader}
            busy={busy === "sell"}
            onClick={() =>
              leader &&
              confirm(`Sell ${player.name} to ${leader.name} for ${money(state.current_bid)}?`) &&
              run("sell", () => callAction("auction.sell", { playerId: player.id }), `Sold to ${leader.name}`)
            }
          >
            {leader ? `SOLD to ${leader.short_name} · ${money(state.current_bid)}` : "Sell (waiting for a bid)"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={state.bid_count > 0}
              busy={busy === "unsold"}
              onClick={() => run("unsold", () => callAction("auction.unsold", { playerId: player.id }))}
              title={state.bid_count > 0 ? "Undo the bids first" : undefined}
            >
              Mark unsold
            </Button>
            <Button disabled={state.bid_count === 0} busy={busy === "undoBid"} onClick={() => run("undoBid", () => callAction("bid.undo", {}))}>
              ↶ Undo last bid
            </Button>
          </div>
        </div>
      )}

      {/* Bids on behalf of teams */}
      {phase === "bidding" && player && playerConfig && sums && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Bid for a team · next {money(minNextBid(state, player, playerConfig))}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {teams.map((t) => {
              const amount = minNextBid(state, player, playerConfig);
              const s = sums.get(t.id);
              const check = s ? checkBid(amount, t.id, state, player, playerConfig, s) : null;
              return (
                <button
                  key={t.id}
                  disabled={!check?.ok || busy !== null}
                  title={check && !check.ok ? check.message : undefined}
                  onClick={() => run(`bid-${t.id}`, () => callAction("bid.place", { playerId: player.id, teamId: t.id, amount }))}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-left text-sm ring-1 ring-white/10 transition active:scale-[0.98] disabled:opacity-35"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate font-semibold">{t.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {busy === `bid-${t.id}` ? "…" : check && !check.ok && check.code !== "already_leading" ? check.message.split(" (")[0] : `+${money(amount)}`}
                  </span>
                </button>
              );
            })}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const amount = Number(customAmount);
              if (!customTeam || !Number.isInteger(amount)) return;
              void run("custom", () => callAction("bid.place", { playerId: player.id, teamId: customTeam, amount })).then(() => setCustomAmount(""));
            }}
          >
            <select className={inputClass} value={customTeam} onChange={(e) => setCustomTeam(e.target.value)} aria-label="Team">
              <option value="">Team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              className={cn(inputClass, "w-28")}
              inputMode="numeric"
              placeholder="Amount"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value.replace(/\D/g, ""))}
              aria-label="Custom bid amount"
            />
            <Button type="submit" busy={busy === "custom"} disabled={!customTeam || !customAmount}>
              Bid
            </Button>
          </form>
        </div>
      )}

      {/* Secondary actions */}
      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {onBlock && (
          <Button
            size="sm"
            disabled={state.bid_count > 0}
            busy={busy === "return"}
            onClick={() => run("return", () => callAction("auction.returnToPool", {}), "Returned to pool")}
          >
            Return player to pool
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!lastResult || !blockFree}
          busy={busy === "undoResult"}
          onClick={() =>
            lastResult &&
            confirm(
              `Undo the last result: ${lastResultPlayer?.name ?? "player"} ${
                lastResult.outcome === "sold" ? `sold to ${teamById.get(lastResult.team_id ?? "")?.name} for ${money(lastResult.price)}` : "unsold"
              }?${lastResult.method === "auction" ? " They go back on the block with bidding reopened." : ""}`,
            ) &&
            run("undoResult", () => callAction("auction.undoResult", {}), "Result undone")
          }
        >
          ↶ Undo last result{lastResultPlayer ? ` (${lastResultPlayer.name})` : ""}
        </Button>
      </div>

      {/* Manual pick */}
      {blockFree && poolPlayers.length > 0 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) void run("pick", () => callAction("auction.select", { playerId: pick })).then(() => setPick(""));
          }}
        >
          <select className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pick a player">
            <option value="">Or pick a player without spinning…</option>
            {poolPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.role} · {p.grade}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!pick} busy={busy === "pick"}>
            Put on block
          </Button>
        </form>
      )}
    </Card>
  );
}
