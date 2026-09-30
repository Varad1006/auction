"use client";

import { useMemo, useState } from "react";
import { ApiError, callAction } from "@/lib/api";
import { cn, money } from "@/lib/format";
import type { ImportedPlayer } from "@/lib/import";
import { basePriceFor } from "@/lib/rules";
import { GRADES, PLAYER_ROLES, POOL_LABEL, POOLS, type Grade, type Player, type PlayerRole, type Pool } from "@/lib/types";
import { PlayerAvatar } from "../live/PlayerCard";
import { TeamBadge } from "../live/TeamBadge";
import { useAuction } from "../live/useAuction";
import { useToast } from "../Toast";
import { Button, Card, Field, inputClass, Modal, useRunner } from "../ui";

type StatusFilter = "all" | "pool" | "sold" | "unsold";

export function PlayersManager() {
  const { players, teamById, state, ready } = useAuction();
  const { busy, run } = useRunner();
  const [pool, setPool] = useState<Pool | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [assigning, setAssigning] = useState<Player | null>(null);
  const [importing, setImporting] = useState(false);

  const list = useMemo(
    () =>
      players
        .filter((p) => (pool === "all" || p.pool === pool) && (status === "all" || p.status === status))
        .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.pool.localeCompare(b.pool) || a.name.localeCompare(b.name)),
    [players, pool, status, q],
  );

  const onBlock = (p: Player) => state?.current_player_id === p.id && ["spinning", "revealed", "bidding"].includes(state.phase);

  return (
    <div className="space-y-4">
      <Card
        title={`Players (${players.length})`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setImporting(true)}>
              Bulk import
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
              + Add player
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <select className={cn(inputClass, "w-auto")} value={pool} onChange={(e) => setPool(e.target.value as Pool | "all")} aria-label="Pool">
            <option value="all">All pools</option>
            {POOLS.map((p) => (
              <option key={p} value={p}>
                {POOL_LABEL[p]}
              </option>
            ))}
          </select>
          <select className={cn(inputClass, "w-auto")} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
            <option value="all">Any status</option>
            <option value="pool">In pool</option>
            <option value="sold">Sold</option>
            <option value="unsold">Unsold</option>
          </select>
          <input className={cn(inputClass, "min-w-40 flex-1")} placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      {!ready ? (
        <p className="text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl bg-slate-900 p-6 text-center text-slate-400 ring-1 ring-white/10">No players match.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
          {list.map((p) => {
            const team = p.sold_team_id ? teamById.get(p.sold_team_id) : null;
            return (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <PlayerAvatar player={p} className="h-11 w-11 shrink-0 rounded-lg text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {p.name}
                    {onBlock(p) && <span className="ml-2 rounded bg-amber-400 px-1.5 text-[10px] font-bold uppercase text-amber-950">On block</span>}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {POOL_LABEL[p.pool]} · {p.role} · Grade {p.grade} · base {money(p.base_price)}
                  </p>
                </div>
                <div className="hidden shrink-0 text-right text-xs sm:block">
                  {p.status === "sold" && team ? (
                    <span className="flex items-center gap-2">
                      <TeamBadge team={team} /> <b className="tabular-nums">{money(p.sold_price)}</b>
                    </span>
                  ) : (
                    <span className={cn("rounded px-2 py-0.5 font-semibold uppercase", p.status === "unsold" ? "bg-rose-500/20 text-rose-300" : "bg-white/10 text-slate-300")}>
                      {p.status === "pool" ? "In pool" : "Unsold"}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  {p.status !== "sold" && !onBlock(p) && (
                    <Button size="sm" variant="ghost" onClick={() => setAssigning(p)} title="Assign to a team without bidding">
                      Assign
                    </Button>
                  )}
                  {p.status !== "sold" && !onBlock(p) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-300"
                      busy={busy === `del-${p.id}`}
                      onClick={() => confirm(`Delete ${p.name}? This can't be undone.`) && run(`del-${p.id}`, () => callAction("player.delete", { id: p.id }), "Player deleted")}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add player" : "Edit player"}>
        {editing !== null && (
          <PlayerForm
            key={editing === "new" ? "new" : editing.id}
            player={editing === "new" ? null : editing}
            onCreated={(p) => setEditing(p)}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={assigning !== null} onClose={() => setAssigning(null)} title={`Assign ${assigning?.name ?? ""}`}>
        {assigning && <AssignForm player={assigning} onDone={() => setAssigning(null)} />}
      </Modal>
      <Modal open={importing} onClose={() => setImporting(false)} title="Bulk import players">
        <ImportForm onDone={() => setImporting(false)} />
      </Modal>
    </div>
  );
}

function PlayerForm({ player, onCreated, onClose }: { player: Player | null; onCreated: (p: Player) => void; onClose: () => void }) {
  const { configs, players } = useAuction();
  const live = player ? (players.find((p) => p.id === player.id) ?? player) : null;
  const { busy, run } = useRunner();
  const [f, setF] = useState({
    name: player?.name ?? "",
    pool: player?.pool ?? ("men" as Pool),
    role: player?.role ?? ("Batter" as PlayerRole),
    grade: player?.grade ?? ("C" as Grade),
    batting_style: player?.batting_style ?? "",
    bowling_style: player?.bowling_style ?? "",
    base_price: player ? String(player.base_price) : "",
    notes: player?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const cfg = configs[f.pool];
  const defaultBase = cfg ? basePriceFor(cfg, f.grade) : undefined;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: f.name,
      pool: f.pool,
      role: f.role,
      grade: f.grade,
      batting_style: f.batting_style || null,
      bowling_style: f.bowling_style || null,
      base_price: f.base_price === "" ? null : Number(f.base_price),
      notes: f.notes || null,
    };
    if (player) {
      await run("save", () => callAction("player.update", { id: player.id, ...payload }), "Saved").then((r) => r && onClose());
    } else {
      const created = (await run("save", () => callAction("player.create", payload), "Player added")) as Player | undefined;
      if (created) onCreated(created);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {live && <PhotoUpload player={live} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input className={inputClass} required maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Pool">
          <select className={inputClass} value={f.pool} onChange={(e) => set("pool", e.target.value as Pool)} disabled={live?.status === "sold"}>
            {POOLS.map((p) => (
              <option key={p} value={p}>
                {POOL_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select className={inputClass} value={f.role} onChange={(e) => set("role", e.target.value as PlayerRole)}>
            {PLAYER_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Grade">
          <select className={inputClass} value={f.grade} onChange={(e) => set("grade", e.target.value as Grade)}>
            {GRADES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Base price" hint={defaultBase !== undefined ? `Leave empty for the grade default (${money(defaultBase)})` : undefined}>
          <input className={inputClass} inputMode="numeric" value={f.base_price} onChange={(e) => set("base_price", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Batting style">
          <input className={inputClass} maxLength={40} placeholder="Right-hand bat" value={f.batting_style} onChange={(e) => set("batting_style", e.target.value)} />
        </Field>
        <Field label="Bowling style">
          <input className={inputClass} maxLength={40} placeholder="Right-arm medium" value={f.bowling_style} onChange={(e) => set("bowling_style", e.target.value)} />
        </Field>
        <Field label="Stats / notes" className="sm:col-span-2">
          <textarea className={inputClass} rows={3} maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {player ? "Cancel" : "Close"}
        </Button>
        <Button type="submit" variant="primary" busy={busy === "save"}>
          {player ? "Save" : "Add player"}
        </Button>
      </div>
      {!player && <p className="text-xs text-slate-500">You can add a photo after the player is created.</p>}
    </form>
  );
}

async function resizeImage(file: File, max = 640): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85),
  );
}

function PhotoUpload({ player }: { player: Player }) {
  const toast = useToast();
  const { busy, run } = useRunner();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const blob = await resizeImage(file);
      const form = new FormData();
      form.set("playerId", player.id);
      form.set("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/admin/photo", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.code ?? "error", body?.message ?? "Upload failed");
      toast("Photo updated", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <PlayerAvatar player={player} className="h-24 w-20 rounded-xl text-2xl" />
      <div className="flex flex-wrap gap-2">
        <label className={cn("inline-flex cursor-pointer items-center rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15", uploading && "opacity-50")}>
          {uploading ? "Uploading…" : player.photo_url ? "Change photo" : "Upload photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {player.photo_url && (
          <Button size="sm" variant="ghost" busy={busy === "rm"} onClick={() => run("rm", () => callAction("player.removePhoto", { id: player.id }), "Photo removed")}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function AssignForm({ player, onDone }: { player: Player; onDone: () => void }) {
  const { teams } = useAuction();
  const { busy, run } = useRunner();
  const [teamId, setTeamId] = useState("");
  const [price, setPrice] = useState(String(player.base_price));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("assign", () => callAction("auction.assign", { playerId: player.id, teamId, price: Number(price) }), "Player assigned").then(
          (r) => r !== undefined && onDone(),
        );
      }}
    >
      <p className="text-sm text-slate-400">
        Sells {player.name} to a team without bidding, e.g. to fill minimum squads after the final round. It is logged as a
        manual result and can be undone.
      </p>
      <Field label="Team">
        <select className={inputClass} required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Choose…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Price">
        <input className={inputClass} inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy === "assign"} disabled={!teamId || price === ""}>
          Assign
        </Button>
      </div>
    </form>
  );
}

interface ImportResponse {
  imported: number;
  preview: (ImportedPlayer & { base_price: number })[];
  errors: { line: number; message: string }[];
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { busy, run } = useRunner();
  const [pool, setPool] = useState<Pool>("men");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportResponse | null>(null);

  const doPreview = async () => {
    const r = (await run("preview", () => callAction("player.import", { text, pool, dryRun: true }))) as ImportResponse | undefined;
    if (r) setPreview(r);
  };
  const doImport = async () => {
    const r = (await run("import", () => callAction("player.import", { text, pool, dryRun: false }))) as ImportResponse | undefined;
    if (r?.imported) onDone();
    else if (r) setPreview(r);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Paste rows from a spreadsheet (tab-separated), CSV, or <code>|</code>-separated text. With no header row the columns
        are: <b>name, role, grade, batting, bowling, base price, notes</b>. A header row can reorder columns or add a{" "}
        <b>pool</b> column. Empty base price uses the grade default.
      </p>
      <Field label="Default pool">
        <select className={inputClass} value={pool} onChange={(e) => { setPool(e.target.value as Pool); setPreview(null); }}>
          {POOLS.map((p) => (
            <option key={p} value={p}>
              {POOL_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <textarea
        className={cn(inputClass, "font-mono text-xs")}
        rows={8}
        placeholder={"Rohit Patil, Batter, A, Right-hand bat, , , Opener\nAnanya Rao, All-rounder, B, Left-hand bat, Right-arm medium, 40, "}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      {preview && (
        <div className="space-y-2 text-sm">
          {preview.errors.length > 0 && (
            <ul className="rounded-lg bg-rose-950/60 p-3 text-rose-200">
              {preview.errors.map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-slate-300">
            {preview.preview.length} player(s) ready{preview.errors.length ? " (fix the errors above to import)" : ""}:
          </p>
          <ul className="max-h-48 overflow-y-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-300 ring-1 ring-white/10">
            {preview.preview.map((p, i) => (
              <li key={i} className="py-0.5">
                {p.name} · {POOL_LABEL[p.pool]} · {p.role} · {p.grade} · {money(p.base_price)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={doPreview} busy={busy === "preview"} disabled={!text.trim()}>
          Preview
        </Button>
        <Button
          variant="primary"
          onClick={doImport}
          busy={busy === "import"}
          disabled={!preview || preview.errors.length > 0 || preview.preview.length === 0}
        >
          Import {preview?.preview.length ?? ""}
        </Button>
      </div>
    </div>
  );
}
