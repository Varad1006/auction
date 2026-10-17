"use client";

import { useRef, useState } from "react";
import { cn, money } from "@/lib/format";
import { TIER_LABEL } from "@/lib/insights";
import { POOL_LABEL, POOLS, type Pool } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { ScoutCard } from "../owner/AiScout";
import { useInsights, type AdminInfo } from "../owner/InsightsProvider";
import { useToast } from "../Toast";
import { Button, Card } from "../ui";

interface ImportReport {
  matched: number;
  seasons: number[];
  unmatched: string[];
  withoutStats: string[];
  warnings: string[];
}

interface PriceReport {
  season: number;
  sheet: string | null;
  players: number;
  sold: number;
  averages: Partial<Record<Pool, number>>;
  matched: number;
  available: number;
}

interface BatchResult {
  generated: number;
  remaining: number;
  total: number;
  priced: number;
  ai: boolean;
}

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null,
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

class Stopped extends Error {}

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
    throw new RequestError(
      data?.message ?? (timedOut ? "The AI took too long." : "Something went wrong."),
      status,
      timedOut ? "ai_timeout" : (data?.code ?? null),
      typeof data?.retryAfter === "number" ? data.retryAfter : null,
    );
  }
  return data.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Longest wait for a rate limit before giving up for now. */
const MAX_WAIT = 120;
const SEASONS = [1, 2, 3, 4, 5, 6, 7, 8];

function AiStatus({ admin }: { admin: AdminInfo | null }) {
  if (!admin) return null;
  if (admin.provider === "groq") {
    return (
      <p className="mb-3 text-sm text-slate-400">
        AI: <b className="text-slate-200">Groq · {admin.model}</b> (free). It writes a short note for each player and may adjust the price guide a
        little. It works {admin.batchSize} players at a time; when Groq&apos;s free per-minute limit is reached it waits and carries on by itself, so
        keep this page open until it finishes.
      </p>
    );
  }
  if (admin.provider === "anthropic") {
    return (
      <p className="mb-3 text-sm text-slate-400">
        AI: <b className="text-slate-200">Claude · {admin.model}</b>. It writes a short note for each player and may adjust the price guide a little.
        It works a few players at a time; keep this page open until it finishes.
      </p>
    );
  }
  return (
    <p className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200 ring-1 ring-amber-400/30" role="status">
      No AI key: prices only. The price guide is still worked out from previous prices and stats. For AI notes too, create a free key at
      console.groq.com, add it as <code>GROQ_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy.
    </p>
  );
}

export function InsightsManager() {
  const { players } = useAuction();
  const { byPlayer, admin, reload, ready } = useInsights();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [season, setSeason] = useState(2);
  const [pricing, setPricing] = useState(false);
  const [priceReport, setPriceReport] = useState<PriceReport | null>(null);
  const [running, setRunning] = useState<Pool | null>(null);
  const [wait, setWait] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<Pool>("men");
  const [open, setOpen] = useState<string | null>(null);

  const ai = !!admin?.configured;
  const available = (pool: Pool) => players.filter((p) => p.pool === pool && (p.status === "pool" || p.status === "unsold"));
  const counts = (pool: Pool) => {
    const list = available(pool).map((p) => byPlayer.get(p.id));
    return {
      total: list.length,
      withStats: list.filter((i) => (i?.statLines.length ?? 0) > 0).length,
      priced: list.filter((i) => i?.generatedAt && i.priceFair !== null).length,
      notes: list.filter((i) => i?.hasNote).length,
    };
  };
  const anyNotes = POOLS.some((p) => counts(p).notes > 0);

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

  async function uploadPrices(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("season", String(season));
    form.append("file", file);
    setPricing(true);
    try {
      const r = await post<PriceReport>("/api/admin/insights/prices", form, false);
      setPriceReport(r);
      toast(`PPL ${r.season} prices loaded`, "success");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setPricing(false);
      if (priceRef.current) priceRef.current.value = "";
    }
  }

  async function countdown(seconds: number) {
    for (let s = seconds; s > 0; s--) {
      if (stopRef.current) throw new Stopped();
      setWait(s);
      await sleep(1000);
    }
    setWait(null);
  }

  async function generate(pool: Pool, restart: boolean) {
    setRunning(pool);
    setError(null);
    stopRef.current = false;
    let first = true;
    let retried = false;
    let waits = 0;
    let size = admin?.batchSize ?? 3;
    try {
      for (;;) {
        if (stopRef.current) throw new Stopped();
        let result: BatchResult;
        try {
          result = await post("/api/admin/insights/generate", JSON.stringify({ pool, restart: restart && first, size }));
        } catch (e) {
          if (!(e instanceof RequestError)) throw e;
          // Out of time or too long an answer: ask for fewer players at once, down to one.
          if ((e.code === "ai_timeout" || e.code === "ai_too_long") && size > 1) {
            size = Math.max(1, Math.floor(size / 2));
            continue;
          }
          // The free tier's per-minute limit: wait it out and carry on.
          if (e.code === "ai_rate_limited") {
            const seconds = e.retryAfter ?? 30;
            if (seconds > MAX_WAIT || ++waits > 60) {
              throw new Error(`${e.message} Try again in about ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`);
            }
            await countdown(seconds + 1);
            continue;
          }
          // Otherwise one automatic retry: the AI service is sometimes busy.
          if (retried || e.code === "migration_needed" || e.code === "ai_key_rejected") throw e;
          retried = true;
          continue;
        }
        first = false;
        retried = false;
        await reload();
        if (!result.ai) {
          toast(`${POOL_LABEL[pool]}: prices worked out for ${result.priced} players`, "success");
          break;
        }
        if (result.remaining <= 0 || result.generated === 0) {
          toast(`${POOL_LABEL[pool]}: AI notes ready`, "success");
          break;
        }
      }
    } catch (e) {
      if (e instanceof Stopped) toast("Stopped", "info");
      else setError(e instanceof Error ? e.message : "Generating failed");
    } finally {
      setRunning(null);
      setWait(null);
    }
  }

  // Highest suggested price first; players without a price last.
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
                No stats in the file for {report.withoutStats.length} auction player(s): {report.withoutStats.join(", ")}. They are priced from previous
                auction prices only, or at base price.
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

      <Card title="2. Previous auction prices">
        <p className="mb-3 text-sm text-slate-400">
          Upload each season&apos;s tracker sheet: in Google Sheets, File → Download → Microsoft Excel (.xlsx), or the &quot;Players list&quot; tab as
          .csv. Only names, gender, team and sold price are read; phone numbers, emails and the other columns are ignored and not saved. Uploading a
          season again replaces it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-300">
            Season{" "}
            <select
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              disabled={pricing}
              className="ml-1 rounded-lg bg-white/10 px-2 py-1.5 text-sm text-white"
              aria-label="Season of the price list"
            >
              {SEASONS.map((s) => (
                <option key={s} value={s} className="bg-slate-900">
                  PPL {s}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={priceRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            aria-label="Price list file"
            disabled={pricing}
            onChange={(e) => void uploadPrices(e.target.files?.[0])}
            className="block min-w-0 flex-1 text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-white/15"
          />
        </div>
        {pricing && <p className="mt-2 animate-pulse text-sm text-slate-400">Reading the price list…</p>}
        {priceReport && (
          <div className="mt-3 space-y-1 rounded-xl bg-white/[0.03] p-3 text-sm ring-1 ring-white/10" role="status">
            <p>
              PPL {priceReport.season}: <b>{priceReport.players}</b> players read{priceReport.sheet && <> from &quot;{priceReport.sheet}&quot;</>},{" "}
              {priceReport.sold} sold
              {POOLS.filter((p) => priceReport.averages[p]).map((p) => (
                <span key={p}>
                  {" "}
                  · {POOL_LABEL[p].toLowerCase()} average {money(priceReport.averages[p]!)}
                </span>
              ))}
            </p>
            <p className="text-slate-400">
              Found {priceReport.matched} of this year&apos;s {priceReport.available} auction players in it. Press{" "}
              {ai ? "Generate" : "Calculate prices"} below to update the prices
              {anyNotes && " (players who already have AI notes keep theirs until you press Start over)"}.
            </p>
          </div>
        )}
        {(admin?.seasons.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs text-slate-400" aria-label="Uploaded price lists">
            {admin!.seasons.map((s) => (
              <li key={`${s.season}-${s.pool}`}>
                PPL {s.season} · {POOL_LABEL[s.pool]}: {s.sold} sold of {s.players}
                {s.average !== null ? `, average ${money(s.average)}` : ", too few prices for an average"}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={ai ? "3. Prices and AI notes" : "3. Prices"}>
        <AiStatus admin={admin} />
        <p className="mb-3 text-xs text-slate-500">
          Prices come from what each player went for before (against that season&apos;s average), their stats and availability, scaled so the pool
          adds up to what the teams have left. Owners see them on player cards and their dashboard; nobody else does.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {POOLS.map((pool) => {
            const c = counts(pool);
            const done = ai ? c.notes : c.priced;
            const pct = c.total ? Math.round((done / c.total) * 100) : 0;
            return (
              <div key={pool} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{POOL_LABEL[pool]}</p>
                  <p className="text-right text-xs text-slate-400">
                    {c.priced}/{c.total} priced{ai && <> · {c.notes} AI notes</>} · {c.withStats} with stats
                  </p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" aria-label={`${pct}% done`}>
                  <div className={cn("h-full rounded-full bg-fuchsia-400 transition-all", running === pool && "animate-pulse")} style={{ width: `${pct}%` }} />
                </div>
                {running === pool && wait !== null && (
                  <p className="mt-2 text-xs text-amber-200" role="status">
                    Free limit reached: carrying on in {wait}s…
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {ai ? (
                    <Button
                      size="sm"
                      variant="primary"
                      busy={running === pool}
                      disabled={running !== null || c.total === 0 || c.notes === c.total}
                      onClick={() => void generate(pool, false)}
                    >
                      {c.notes === 0 ? "Generate" : c.notes === c.total ? "All done" : `Generate remaining ${c.total - c.notes}`}
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" busy={running === pool} disabled={running !== null || c.total === 0} onClick={() => void generate(pool, false)}>
                      {c.priced ? "Recalculate prices" : "Calculate prices"}
                    </Button>
                  )}
                  {running === pool && (
                    <Button size="sm" variant="ghost" onClick={() => (stopRef.current = true)}>
                      Stop
                    </Button>
                  )}
                  {running === null && (c.notes > 0 || c.priced > 0) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        confirm(
                          ai
                            ? `Write fresh AI notes and prices for all ${c.total} ${POOL_LABEL[pool].toLowerCase()} players? The current ones are replaced.`
                            : `Work out fresh prices for all ${c.total} ${POOL_LABEL[pool].toLowerCase()} players?`,
                        ) && void generate(pool, true)
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

      <Card title="4. Review">
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
                      {insight?.generatedAt && (insight.hasNote ? " · ✨ AI note" : " · 📊 guide")}
                      {insight && !insight.statLines.length && " · no stats"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {insight?.generatedAt && insight.priceFair !== null ? (
                      <>
                        <b>{money(insight.priceFair)}</b>
                        <span className="block text-[11px] text-slate-400">
                          {money(insight.priceFloor)}–{money(insight.priceStretch)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">No price yet</span>
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
