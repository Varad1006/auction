"use client";

import { useState } from "react";
import { callAction } from "@/lib/api";
import { cn, money } from "@/lib/format";
import { formatIncrementTiers, parseIncrementTiers } from "@/lib/rules";
import { POOL_LABEL, POOLS, type Pool, type PoolConfig, type Team, type TeamPoolLimit } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { Button, Card, Field, inputClass, useRunner } from "../ui";

const num = (v: string) => v.replace(/\D/g, "");

export function SettingsManager() {
  const { configs, teams, limits, ready } = useAuction();
  if (!ready) return <p className="text-slate-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {POOLS.map((p) => configs[p] && <PoolConfigForm key={`${p}-${configs[p]!.updated_at}`} config={configs[p]!} />)}
      </div>
      <TeamsEditor teams={teams} limits={limits} />
      <DangerZone />
    </div>
  );
}

function PoolConfigForm({ config }: { config: PoolConfig }) {
  const { busy, run } = useRunner();
  const [f, setF] = useState({
    label: config.label,
    purse: String(config.purse),
    min_squad: String(config.min_squad),
    max_squad: String(config.max_squad),
    base_price_a: String(config.base_price_a),
    base_price_b: String(config.base_price_b),
    base_price_c: String(config.base_price_c),
    tiers: formatIncrementTiers(config.increment_tiers),
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const tiers = parseIncrementTiers(f.tiers);

  return (
    <Card title={`${POOL_LABEL[config.pool]} pool`}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tiers) return;
          void run(
            "save",
            () =>
              callAction("pool.update", {
                pool: config.pool,
                label: f.label,
                purse: Number(f.purse),
                min_squad: Number(f.min_squad),
                max_squad: Number(f.max_squad),
                base_price_a: Number(f.base_price_a),
                base_price_b: Number(f.base_price_b),
                base_price_c: Number(f.base_price_c),
                increment_tiers: tiers,
              }),
            `${POOL_LABEL[config.pool]} settings saved`,
          );
        }}
      >
        <Field label="Purse per team" className="col-span-2">
          <input className={inputClass} inputMode="numeric" required value={f.purse} onChange={(e) => set("purse", num(e.target.value))} />
        </Field>
        <Field label="Min squad">
          <input className={inputClass} inputMode="numeric" required value={f.min_squad} onChange={(e) => set("min_squad", num(e.target.value))} />
        </Field>
        <Field label="Max squad">
          <input className={inputClass} inputMode="numeric" required value={f.max_squad} onChange={(e) => set("max_squad", num(e.target.value))} />
        </Field>
        <div className="col-span-2 grid grid-cols-3 gap-3">
          {(["a", "b", "c"] as const).map((g) => (
            <Field key={g} label={`Base ${g.toUpperCase()}`}>
              <input
                className={inputClass}
                inputMode="numeric"
                required
                value={f[`base_price_${g}`]}
                onChange={(e) => set(`base_price_${g}`, num(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <Field
          label="Bid increments"
          className="col-span-2"
          hint={'"5" for a flat +5, or "from:step" tiers like "0:5, 100:10, 300:25"'}
        >
          <input className={cn(inputClass, !tiers && "ring-rose-500")} value={f.tiers} onChange={(e) => set("tiers", e.target.value)} />
        </Field>
        <p className="col-span-2 text-xs text-slate-500">
          Current round: {config.current_round}. Owners must always keep enough purse to fill their minimum squad at the
          lowest base price ({money(Math.min(Number(f.base_price_a), Number(f.base_price_b), Number(f.base_price_c)))} per player).
        </p>
        <div className="col-span-2 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            busy={busy === "apply"}
            onClick={() =>
              confirm(`Set every unsold/undecided ${POOL_LABEL[config.pool].toLowerCase()} player's base price to their grade's saved price?`) &&
              run("apply", () => callAction("player.applyBasePrices", { pool: config.pool }), "Base prices applied")
            }
          >
            Apply base prices to players
          </Button>
          <Button type="submit" variant="primary" busy={busy === "save"} disabled={!tiers}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TeamsEditor({ teams, limits }: { teams: Team[]; limits: TeamPoolLimit[] }) {
  const { busy, run } = useRunner();
  const [adding, setAdding] = useState({ name: "", short_name: "", color: "#64748b" });
  return (
    <Card title={`Teams (${teams.length})`}>
      <div className="space-y-4">
        {teams.map((t) => (
          <TeamRow key={`${t.id}-${t.name}-${t.short_name}-${t.color}-${t.sort_order}`} team={t} limits={limits.filter((l) => l.team_id === t.id)} />
        ))}
        <form
          className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              "add",
              () => callAction("team.create", { ...adding, sort_order: teams.length + 1 }),
              "Team added",
            ).then((r) => r && setAdding({ name: "", short_name: "", color: "#64748b" }));
          }}
        >
          <Field label="New team" className="min-w-40 flex-1">
            <input className={inputClass} required maxLength={40} placeholder="Name" value={adding.name} onChange={(e) => setAdding((s) => ({ ...s, name: e.target.value }))} />
          </Field>
          <Field label="Short" className="w-20">
            <input className={inputClass} required maxLength={5} value={adding.short_name} onChange={(e) => setAdding((s) => ({ ...s, short_name: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label="Colour" className="w-16">
            <input type="color" className="h-10 w-full rounded-lg bg-transparent" value={adding.color} onChange={(e) => setAdding((s) => ({ ...s, color: e.target.value }))} />
          </Field>
          <Button type="submit" busy={busy === "add"}>
            Add team
          </Button>
        </form>
      </div>
    </Card>
  );
}

function TeamRow({ team, limits }: { team: Team; limits: TeamPoolLimit[] }) {
  const { busy, run } = useRunner();
  const [f, setF] = useState({ name: team.name, short_name: team.short_name, color: team.color, sort_order: String(team.sort_order) });
  const [showLimits, setShowLimits] = useState(false);
  const dirty = f.name !== team.name || f.short_name !== team.short_name || f.color !== team.color || f.sort_order !== String(team.sort_order);

  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            "save",
            () => callAction("team.update", { id: team.id, name: f.name, short_name: f.short_name, color: f.color, sort_order: Number(f.sort_order) || 0 }),
            "Team saved",
          );
        }}
      >
        <Field label="Name" className="min-w-36 flex-1">
          <input className={inputClass} required maxLength={40} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} />
        </Field>
        <Field label="Short" className="w-20">
          <input className={inputClass} required maxLength={5} value={f.short_name} onChange={(e) => setF((s) => ({ ...s, short_name: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Colour" className="w-16">
          <input type="color" className="h-10 w-full rounded-lg bg-transparent" value={f.color} onChange={(e) => setF((s) => ({ ...s, color: e.target.value }))} />
        </Field>
        <Field label="Order" className="w-16">
          <input className={inputClass} inputMode="numeric" value={f.sort_order} onChange={(e) => setF((s) => ({ ...s, sort_order: num(e.target.value) }))} />
        </Field>
        <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={!dirty} busy={busy === "save"}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setShowLimits((v) => !v)}>
          Limits {showLimits ? "▴" : "▾"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-rose-300"
          busy={busy === "del"}
          onClick={() => confirm(`Delete ${team.name}? Owner mappings for this team are removed too.`) && run("del", () => callAction("team.delete", { id: team.id }), "Team deleted")}
        >
          Delete
        </Button>
      </form>
      {showLimits && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {POOLS.map((p) => (
            <LimitsForm key={p} teamId={team.id} pool={p} limit={limits.find((l) => l.pool === p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LimitsForm({ teamId, pool, limit }: { teamId: string; pool: Pool; limit?: TeamPoolLimit }) {
  const { configs } = useAuction();
  const cfg = configs[pool];
  const { busy, run } = useRunner();
  const [f, setF] = useState({
    purse: limit?.purse?.toString() ?? "",
    min_squad: limit?.min_squad?.toString() ?? "",
    max_squad: limit?.max_squad?.toString() ?? "",
  });
  const val = (v: string) => (v === "" ? null : Number(v));
  return (
    <form
      className="rounded-lg bg-slate-950/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "save",
          () => callAction("team.limits", { teamId, pool, purse: val(f.purse), min_squad: val(f.min_squad), max_squad: val(f.max_squad) }),
          "Limits saved",
        );
      }}
    >
      <p className="mb-2 text-sm font-semibold">{POOL_LABEL[pool]} overrides <span className="font-normal text-slate-500">(empty = pool default)</span></p>
      <div className="grid grid-cols-3 gap-2">
        {(["purse", "min_squad", "max_squad"] as const).map((k) => (
          <Field key={k} label={k === "purse" ? "Purse" : k === "min_squad" ? "Min" : "Max"}>
            <input className={inputClass} inputMode="numeric" placeholder={cfg ? String(cfg[k]) : ""} value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: num(e.target.value) }))} />
          </Field>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" size="sm" busy={busy === "save"}>
          Save
        </Button>
      </div>
    </form>
  );
}

function DangerZone() {
  const { busy, run } = useRunner();
  return (
    <Card title="Danger zone" className="ring-rose-500/30">
      <p className="mb-3 text-sm text-slate-400">
        Reset puts every player back in the pool, deletes all bids and results and restarts both pools at round 1. Use it
        after a rehearsal. Players, teams, settings and owners are kept.
      </p>
      <Button
        variant="danger"
        busy={busy === "reset"}
        onClick={() => {
          const typed = prompt("Type RESET to wipe all bids and results");
          if (typed === "RESET") void run("reset", () => callAction("auction.reset", { confirm: "RESET" }), "Auction reset");
        }}
      >
        Reset auction
      </Button>
    </Card>
  );
}
