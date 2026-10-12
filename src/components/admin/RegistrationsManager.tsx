"use client";

import { useCallback, useEffect, useState } from "react";
import { callAction } from "@/lib/api";
import { cn, timeAgo } from "@/lib/format";
import { decodeQrImage } from "@/lib/qr-decode";
import { DECLARATION_MAX, PAYMENT_QR_MAX, parseUpi, upiLink, type PaymentQr, type RegistrationSettings } from "@/lib/registration";
import { POOL_LABEL, type Pool } from "@/lib/types";
import { Button, Card, Field, inputBase, inputClass, useRunner } from "../ui";

interface Registration {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  phone: string;
  flat_number: string;
  age: number;
  gender: Pool;
  role: string;
  batting_style: string | null;
  bowling_style: string | null;
  tshirt_size: string | null;
  availability: string | null;
  additional_info: string | null;
  status: "pending" | "approved" | "rejected";
  photo_url: string | null;
  receipt_url: string | null;
  receipt_path: string | null;
}

type Filter = "pending" | "approved" | "rejected" | "all";

export function RegistrationsManager() {
  const [data, setData] = useState<{ settings: RegistrationSettings; registrations: Registration[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const { busy, run } = useRunner();

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/registrations", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setError("Could not load registrations");
    setData(await res.json());
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active && document.visibilityState === "visible") void load();
    };
    tick();
    const t = window.setInterval(tick, 20_000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [load]);

  if (error) return <p className="text-rose-300">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading…</p>;

  const regs = data.registrations;
  const count = (f: Filter) => (f === "all" ? regs.length : regs.filter((r) => r.status === f).length);
  const list = filter === "all" ? regs : regs.filter((r) => r.status === filter);
  const pending = regs.filter((r) => r.status === "pending");

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    const r = await run(key, fn, msg);
    await load();
    return r;
  };

  return (
    <div className="space-y-4">
      <FormSettings key={JSON.stringify(data.settings)} settings={data.settings} onSaved={load} />
      <PaymentsEditor key={`pay-${JSON.stringify(data.settings.payment_qr)}`} initial={data.settings.payment_qr} onSaved={load} />

      <Card
        title="Registrations"
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/export?kind=registrations" className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15">
              ⬇ CSV
            </a>
            <Button
              size="sm"
              variant="success"
              disabled={pending.length === 0}
              busy={busy === "all"}
              onClick={async () => {
                if (!confirm(`Approve all ${pending.length} pending registrations and add them to the player pool?`)) return;
                for (const r of pending) await callAction("registration.approve", { id: r.id }).catch(() => null);
                await act("all", async () => null, "Pending registrations approved");
              }}
            >
              Approve all pending
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(["pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold capitalize ring-1",
                filter === f ? "bg-white text-slate-900 ring-white" : "text-slate-300 ring-white/15",
              )}
            >
              {f} <span className="opacity-60">{count(f)}</span>
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="py-6 text-center text-slate-500">Nothing here.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((r) => (
              <RegistrationRow key={r.id} r={r} busy={busy} act={act} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RegistrationRow({
  r,
  busy,
  act,
}: {
  r: Registration;
  busy: string | null;
  act: (key: string, fn: () => Promise<unknown>, msg: string) => Promise<unknown>;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10 sm:flex-row">
      <a href={r.photo_url ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
        {r.photo_url ? (
          <img src={r.photo_url} alt="" className="h-28 w-24 rounded-lg object-cover" />
        ) : (
          <span className="flex h-28 w-24 items-center justify-center rounded-lg bg-slate-800 text-slate-500">No photo</span>
        )}
      </a>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-bold">{r.full_name}</p>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold uppercase", {
            pending: "bg-amber-400/20 text-amber-300",
            approved: "bg-emerald-500/20 text-emerald-300",
            rejected: "bg-rose-500/20 text-rose-300",
          }[r.status])}>
            {r.status}
          </span>
          <span className="text-xs text-slate-500">{timeAgo(r.created_at)}</span>
        </div>
        <p className="text-slate-300">
          {POOL_LABEL[r.gender]} · {r.age} yrs · {r.role} · {r.batting_style ?? "–"} · {r.bowling_style ?? "–"}
        </p>
        <p className="text-slate-400">
          {r.email} · {r.phone} · Flat {r.flat_number} · T-shirt {r.tshirt_size ?? "–"}
        </p>
        {r.availability && <p className="text-slate-400">📅 {r.availability}</p>}
        {r.additional_info && <p className="mt-1 whitespace-pre-line text-slate-300">{r.additional_info}</p>}
        <p className="mt-1">
          {r.receipt_url ? (
            <a href={r.receipt_url} target="_blank" rel="noreferrer" className="font-semibold text-amber-300 underline">
              View payment receipt
            </a>
          ) : (
            <span className="text-rose-300">No receipt uploaded</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2 sm:w-44 sm:flex-col sm:items-stretch">
        {r.status === "pending" && (
          <>
            <Button
              size="sm"
              variant="success"
              busy={busy === `ok-${r.id}`}
              onClick={() => act(`ok-${r.id}`, () => callAction("registration.approve", { id: r.id }), `${r.full_name} added to players`)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-300"
              busy={busy === `no-${r.id}`}
              onClick={() => act(`no-${r.id}`, () => callAction("registration.setStatus", { id: r.id, status: "rejected" }), "Registration rejected")}
            >
              Reject
            </Button>
          </>
        )}
        {r.status === "rejected" && (
          <>
            <Button size="sm" busy={busy === `re-${r.id}`} onClick={() => act(`re-${r.id}`, () => callAction("registration.setStatus", { id: r.id, status: "pending" }), "Moved back to pending")}>
              Move to pending
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-300"
              busy={busy === `del-${r.id}`}
              onClick={() =>
                confirm(`Permanently delete ${r.full_name}'s registration, photo and receipt?`) &&
                act(`del-${r.id}`, () => callAction("registration.delete", { id: r.id }), "Registration deleted")
              }
            >
              Delete
            </Button>
          </>
        )}
        {r.status === "approved" && <p className="text-xs text-emerald-300">In the player list</p>}
      </div>
    </li>
  );
}

function FormSettings({ settings, onSaved }: { settings: RegistrationSettings; onSaved: () => void }) {
  const { busy, run } = useRunner();
  const [open, setOpen] = useState(!settings.is_open);
  const [f, setF] = useState({
    ...settings,
    options: settings.availability_options.join("\n"),
    rulebook_url: settings.rulebook_url ?? "",
  });
  const link = typeof window === "undefined" ? "/register" : `${window.location.origin}/register`;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = async (patch?: Partial<typeof f>) => {
    const next = { ...f, ...patch };
    const r = await run(
      "save",
      () =>
        callAction("registration.settings", {
          is_open: next.is_open,
          title: next.title,
          intro: next.intro,
          payment_instructions: next.payment_instructions,
          receipt_required: next.receipt_required,
          availability_question: next.availability_question,
          availability_options: next.options.split("\n").map((s) => s.trim()).filter(Boolean),
          declaration_text: next.declaration_text,
          rulebook_url: next.rulebook_url,
          rulebook_message: next.rulebook_message,
        }),
      next.is_open ? "Registration form is open" : "Registration form saved (closed)",
    );
    if (r) onSaved();
  };

  return (
    <Card
      title="Registration form"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", settings.is_open ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-slate-400")}>
            {settings.is_open ? "● Open" : "Closed"}
          </span>
          <Button size="sm" variant={settings.is_open ? "secondary" : "success"} busy={busy === "save"} onClick={() => save({ is_open: !settings.is_open })}>
            {settings.is_open ? "Close form" : "Open form"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide settings ▴" : "Edit settings ▾"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Share this link:</span>
        <code className="rounded bg-slate-950 px-2 py-1 text-amber-200">{link}</code>
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(link)}>
          Copy
        </Button>
        <a href="/register" target="_blank" className="text-sm text-slate-400 underline">
          Preview
        </a>
      </div>
      {open && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Form title" className="sm:col-span-2">
            <input className={inputClass} maxLength={80} value={f.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Introduction" className="sm:col-span-2" hint="Shown at the top: dates, venue, format, fees…">
            <textarea className={inputClass} rows={3} maxLength={2000} value={f.intro} onChange={(e) => set("intro", e.target.value)} />
          </Field>
          <Field label="Rulebook link" hint="Shown at the top of the form, e.g. a Google Doc shared as “anyone with the link”.">
            <input
              className={inputClass}
              type="url"
              maxLength={500}
              placeholder="https://docs.google.com/…"
              value={f.rulebook_url}
              onChange={(e) => set("rulebook_url", e.target.value)}
            />
          </Field>
          <Field label="Rulebook message">
            <input className={inputClass} maxLength={300} value={f.rulebook_message} onChange={(e) => set("rulebook_message", e.target.value)} />
          </Field>
          <Field label="Availability question" className="sm:col-span-2">
            <input className={inputClass} maxLength={150} value={f.availability_question} onChange={(e) => set("availability_question", e.target.value)} />
          </Field>
          <Field label="Availability options" hint="One per line (e.g. match dates); players tick all that apply. Leave empty for a free-text answer.">
            <textarea className={inputClass} rows={4} value={f.options} onChange={(e) => set("options", e.target.value)} placeholder={"Sat 8 Nov\nSun 9 Nov\nSat 15 Nov"} />
          </Field>
          <Field label="Payment instructions" hint="e.g. UPI ID and amount.">
            <textarea className={inputClass} rows={4} maxLength={1000} value={f.payment_instructions} onChange={(e) => set("payment_instructions", e.target.value)} />
          </Field>
          <Field
            label="Undertaking and declaration"
            className="sm:col-span-2"
            hint="Players must tick “I have read and agree” before they can submit."
          >
            <textarea
              className={inputClass}
              rows={10}
              maxLength={DECLARATION_MAX}
              value={f.declaration_text}
              onChange={(e) => set("declaration_text", e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={f.receipt_required} onChange={(e) => set("receipt_required", e.target.checked)} />
            Payment receipt is required
          </label>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" busy={busy === "save"}>
              Save settings
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Payment QR codes shown on the form, stored as UPI payment links. */
function PaymentsEditor({ initial, onSaved }: { initial: PaymentQr[]; onSaved: () => void }) {
  const { busy, run } = useRunner();
  const [items, setItems] = useState<PaymentQr[]>(initial);
  const [upiId, setUpiId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  const full = items.length >= PAYMENT_QR_MAX;

  const addPayload = (payload: string) => {
    const upi = parseUpi(payload);
    if (!upi) return setNote({ ok: false, text: "That isn't a UPI payment QR code." });
    if (items.some((i) => parseUpi(i.payload)?.upiId === upi.upiId)) return setNote({ ok: false, text: `${upi.upiId} is already added.` });
    setItems((list) => [...list, { label: "", payload }]);
    setNote({ ok: true, text: `Added ${upi.name || upi.upiId} (${upi.upiId}). Press Save to put it on the form.` });
  };

  return (
    <Card
      title="Payment QR codes"
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          busy={busy === "pay"}
          onClick={async () => {
            if (await run("pay", () => callAction("registration.payments", { items }), "Payment QR codes saved")) onSaved();
          }}
        >
          Save
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-400">
        Upload a screenshot or photo of a UPI QR code (GPay, PhonePe, Paytm…). The form shows a sharp copy of it with a Download
        button, and the phone number you enter here (or the UPI ID if you leave it empty) with a Copy button.
      </p>
      {items.length > 0 && (
        <ul className="mb-4 space-y-2">
          {items.map((item, idx) => {
            const upi = parseUpi(item.payload);
            return (
              <li key={item.payload} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{upi?.name || "UPI"}</span>
                  <span className="block font-mono text-xs text-slate-400">{upi?.upiId}</span>
                </span>
                <input
                  className={cn(inputBase, "w-full py-1.5 text-sm sm:w-40")}
                  type="tel"
                  inputMode="tel"
                  placeholder="10-digit mobile (shown)"
                  aria-label={`Phone number for ${upi?.name || "this QR code"}`}
                  maxLength={16}
                  value={item.phone ?? ""}
                  onChange={(e) => setItems((list) => list.map((x, i) => (i === idx ? { ...x, phone: e.target.value } : x)))}
                />
                <input
                  className={cn(inputBase, "w-full py-1.5 text-sm sm:w-36")}
                  placeholder="Label (optional)"
                  maxLength={60}
                  value={item.label}
                  onChange={(e) => setItems((list) => list.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                />
                <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setItems((list) => list.filter((_, i) => i !== idx))}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {full ? (
        <p className="text-sm text-slate-500">Up to {PAYMENT_QR_MAX} QR codes. Remove one to add another.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/15">
            Upload QR image
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const text = await decodeQrImage(file).catch(() => null);
                if (text) addPayload(text);
                else setNote({ ok: false, text: "Couldn't read a QR code in that image. Try a clearer screenshot, or type the UPI ID." });
              }}
            />
          </label>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!upiId.trim()) return;
              addPayload(upiLink(upiId, name));
              setUpiId("");
              setName("");
            }}
          >
            <input className={cn(inputBase, "min-w-0 flex-1 basis-40")} placeholder="or type a UPI ID" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
            <input className={cn(inputBase, "min-w-0 flex-1 basis-32")} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit">Add</Button>
          </form>
        </div>
      )}
      {note && <p className={cn("mt-3 text-sm", note.ok ? "text-emerald-300" : "text-rose-300")}>{note.text}</p>}
    </Card>
  );
}
