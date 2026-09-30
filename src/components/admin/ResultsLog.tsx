"use client";

import { callAction } from "@/lib/api";
import { cn, money } from "@/lib/format";
import { POOL_LABEL } from "@/lib/types";
import { TeamBadge } from "../live/TeamBadge";
import { useAuction } from "../live/useAuction";
import { Button, Card, useRunner } from "../ui";

export function ResultsLog() {
  const { results, playerById, teamById, lastResult, state } = useAuction();
  const { busy, run } = useRunner();
  const blockBusy = !!state && ["spinning", "revealed", "bidding"].includes(state.phase) && state.bid_count > 0;
  const rows = [...results].reverse();

  return (
    <Card
      title={`Results log (${results.filter((r) => !r.undone_at).length} active)`}
      actions={
        <div className="flex flex-wrap gap-2">
          <a className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15" href="/api/admin/export?kind=players">
            ⬇ Squads CSV
          </a>
          <a className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15" href="/api/admin/export?kind=results">
            ⬇ Results log CSV
          </a>
          <Button
            size="sm"
            variant="ghost"
            disabled={!lastResult || blockBusy}
            busy={busy === "undo"}
            onClick={() => confirm("Undo the most recent result?") && run("undo", () => callAction("auction.undoResult", {}), "Result undone")}
          >
            ↶ Undo last result
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Undone results stay in the log. Only the most recent active result can be undone, and only within the current round.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Player</th>
              <th className="py-2 pr-3">Pool / round</th>
              <th className="py-2 pr-3">Outcome</th>
              <th className="py-2 pr-3 text-right">Price</th>
              <th className="py-2">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => {
              const t = r.team_id ? teamById.get(r.team_id) : null;
              return (
                <tr key={r.id} className={cn(r.undone_at && "text-slate-500")}>
                  <td className="py-2 pr-3 tabular-nums">{r.id}</td>
                  <td className={cn("py-2 pr-3 font-medium", r.undone_at && "line-through")}>{playerById.get(r.player_id)?.name ?? "Deleted"}</td>
                  <td className="py-2 pr-3">
                    {POOL_LABEL[r.pool]} · R{r.round}
                  </td>
                  <td className="py-2 pr-3">
                    {r.outcome === "sold" && t ? <TeamBadge team={t} full /> : <span className="text-slate-400">Unsold</span>}
                    {r.method === "manual" && <span className="ml-1 text-xs text-slate-500">(assigned)</span>}
                    {r.undone_at && <span className="ml-1 text-xs text-amber-400">undone</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.outcome === "sold" ? money(r.price) : "–"}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(r.created_at).toLocaleTimeString()}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
