"use client";

import { useRef, useState } from "react";
import { cn, money } from "@/lib/format";
import { TIER_LABEL } from "@/lib/insights";
import { POOL_LABEL, POOLS, type Pool } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { ScoutCard } from "../owner/AiScout";
import { useInsights } from "../owner/InsightsProvider";
import { useToast } from "../Toast";
import { Button, Card } from "../ui";

interface ImportReport {
  matched: number;
  seasons: number[];
  unmatched: string[];
  withoutStats: string[];
  warnings: string[];
}

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: BodyInit, json = true): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body,
    headers: json ? { "content-type": "application/json" } : undefined,
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok) {
    const status = res?.status ?? 0;
    const timedOut = status === 504 || data?.code === "ai_timeout";
    throw new RequestError(data?.message ?? (timedOut ? "The AI took too long." : "Something went wrong."), status, timedOut ? "ai_timeout" : (data?.code ?? null));
  }
  return data.data as T;
}

export function InsightsManager() {
  const { players } = useAuction();
  const { byPlayer, admin, reload, ready } = useInsights();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [running, setRunning] = useState<Pool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<Pool>("men");
  const [open, setOpen] = useState<string | null>(null);

  const available = (pool: Pool) => players.filter((p) => p.pool === pool && (p.status === "pool" || p.status === "unsold"));
  const counts = (pool: Pool) => {
    const list = available(pool);
    return {
      total: list.length,
      withStats: list.filter((p) => (byPlayer.get(p.id)?.statLines.length ?? 0) > 0).length,
      done: list.filter((p) => byPlayer.get(p.id)?.generatedAt).length,
    };
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    setUploading(true);
    try {
      const r = await post<ImportReport>("/api/admin/insights/import", form, false);
      setReport(r);
      toast(`Stats loaded for ${r.matched} players`, "success");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function generate(pool: Pool, restart: boolean) {
    setRunning(pool);
    setError(null);
    let first = true;
    let retried = false;
    let size = admin?.batchSize ?? 4;
    try {
      for (;;) {
        let result: { generated: number; remaining: number };
        try {
          result = await post("/api/admin/insights/generate", JSON.stringify({ pool, restart: restart && first, size }));
        } catch (e) {
          // Out of time: ask for fewer players at once, down to one.
          if (e instanceof RequestError && e.code === "ai_timeout" && size > 1) {
            size = Math.max(1, Math.floor(size / 2));
            continue;
          }
          // Otherwise one automatic retry: the AI service is sometimes busy.
          if (retried) throw e;
          retried = true;
          continue;
        }
        first = false;
        retried = false;
        await reload();
        if (result.remaining <= 0 || result.generated === 0) break;
      }
      toast(`${POOL_LABEL[pool]}: AI notes ready`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generating failed");
    } finally {
      setRunning(null);
    }
  }

  // Highest suggested price first; players without a note last.
  const list = available(view)
    .map((p) => ({ player: p, insight: byPlayer.get(p.id) }))
    .sort((a, b) => (b.insight?.priceFair ?? -1) - (a.insight?.priceFair ?? -1) || a.player.name.localeCompare(b.player.name));

  return (
    <div className="space-y-4">
      <Card title="1. Stats from previous seasons">
        <p className="mb-3 text-sm text-slate-400">
          Upload the stats export zip (or <code>all_players.json</code> with the <code>pplN_…_leaderboard.csv</code> files). Players are matched to the
          auction by id, then by name. Uploading again replaces their stats.
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".zip,.json,.csv,application/zip,application/json,text/csv"
          aria-label="Stats files"
          disabled={uploading}
          onChange={(e) => void upload(e.target.files)}
          className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-white/15"
        />
        {uploading && <p className="mt-2 animate-pulse text-sm text-slate-400">Reading the stats…</p>}
        {report && (
          <div className="mt-3 space-y-1 rounded-xl bg-white/[0.03] p-3 text-sm ring-1 ring-white/10" role="status">
            <p>
              <b>{report.matched}</b> players matched
              {report.seasons.length > 0 && <> · seasons PPL {report.seasons.join(", PPL ")}</>}
            </p>
            {report.unmatched.length > 0 && (
              <p className="text-amber-200">Not in the auction ({report.unmatched.length}): {report.unmatched.join(", ")}</p>
            )}
            {report.withoutStats.length > 0 && (
              <p className="text-slate-400">
                No stats in the file for {report.withoutStats.length} auction player(s): {report.withoutStats.join(", ")}. The AI will price them as
                unknown.
              </p>
            )}
            {report.warnings.map((w) => (
              <p key={w} className="text-rose-300">
                {w}
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card title="2. Generate AI notes and prices">
        {admin && !admin.configured ? (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200 ring-1 ring-amber-400/30" role="alert">
            AI is off: add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy.
          </p>
        ) : (
          <p className="mb-3 text-sm text-slate-400">
            The AI ({admin?.model ?? "Claude"}) reads every player&apos;s stats, the teams&apos; purses and squad sizes, and writes a short note and a
            price range for each player. It works a few players at a time; keep this page open until it finishes. Owners see the results
            on player cards and their dashboard.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {POOLS.map((pool) => {
            const c = counts(pool);
            const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <div key={pool} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{POOL_LABEL[pool]}</p>
                  <p className="text-xs text-slate-400">
                    {c.done}/{c.total} done · {c.withStats} with stats
                  </p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" aria-label={`${pct}% done`}>
                  <div className={cn("h-full rounded-full bg-fuchsia-400 transition-all", running === pool && "animate-pulse")} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    busy={running === pool}
                    disabled={!admin?.configured || running !== null || c.total === 0 || c.done === c.total}
                    onClick={() => void generate(pool, false)}
                  >
                    {c.done === 0 ? "Generate" : c.done === c.total ? "All done" : `Generate remaining ${c.total - c.done}`}
                  </Button>
                  {c.done > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!admin?.configured || running !== null}
                      onClick={() =>
                        confirm(`Write fresh AI notes for all ${c.total} ${POOL_LABEL[pool].toLowerCase()} players? The current ones are replaced.`) &&
                        void generate(pool, true)
                      }
                    >
                      Start over
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {error && (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {error} Press Generate again to continue where it stopped.
          </p>
        )}
      </Card>

      <Card title="3. Review">
        <div className="mb-3 flex rounded-xl bg-white/5 p-1" role="tablist" aria-label="Pool">
          {POOLS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={view === p}
              onClick={() => setView(p)}
              className={cn("flex-1 rounded-lg px-4 py-1.5 text-sm font-bold", view === p ? "bg-white text-slate-900" : "text-slate-300")}
            >
              {POOL_LABEL[p]}
            </button>
          ))}
        </div>
        {!ready ? (
          <p className="animate-pulse text-sm text-slate-400">Loading…</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(({ player, insight }) => (
              <li key={player.id} className="py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 text-left"
                  onClick={() => setOpen(open === player.id ? null : player.id)}
                  aria-expanded={open === player.id}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{player.name}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {player.role} · base {money(player.base_price)}
                      {insight?.tier && ` · ${TIER_LABEL[insight.tier]}`}
                      {insight && !insight.statLines.length && " · no stats"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {insight?.priceFair != null ? (
                      <>
                        <b>{money(insight.priceFair)}</b>
                        <span className="block text-[11px] text-slate-400">
                          {money(insight.priceFloor)}–{money(insight.priceStretch)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">No AI note yet</span>
                    )}
                  </span>
                </button>
                {open === player.id && insight?.generatedAt && <ScoutCard insight={insight} className="mt-2" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
