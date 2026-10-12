"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/env";
import { cn } from "@/lib/format";
import { resizeImage } from "@/lib/image";
import {
  BATTING_STYLES,
  BOWLING_STYLES,
  PHOTO_MAX_BYTES,
  RECEIPT_MAX_BYTES,
  registrationFields,
  TSHIRT_SIZES,
  type PaymentOption,
  type RegistrationSettings,
  formatMobile,
  normalizeMobile,
  typingMobile,
} from "@/lib/registration";
import { isIOS } from "@/lib/platform";
import { PLAYER_ROLES } from "@/lib/types";
import { Button, inputClass } from "../ui";

type Errors = Record<string, string>;

export function RegisterForm({ settings, payments }: { settings: RegistrationSettings; payments: PaymentOption[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(registrationFields.shape).map((k) => [k, ""])),
  );
  const [availability, setAvailability] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!settings.is_open) {
    return (
      <FormFrame>
        <TitleCard title={settings.title}>
          <p className="mt-2 text-slate-400">Registration is closed right now. Please check back later or contact the organisers.</p>
        </TitleCard>
      </FormFrame>
    );
  }

  if (done) {
    return (
      <FormFrame>
        <TitleCard title={settings.title}>
          <p className="mt-4 text-4xl" aria-hidden>
            ✅
          </p>
          <h2 className="mt-2 text-xl font-extrabold">You&apos;re registered!</h2>
          <p className="mt-2 text-slate-300">
            Thanks, {values.full_name?.split(" ")[0]}. The organisers will review your registration and add you to the auction
            pool. See you on the field!
          </p>
          {/* A full reload gives a clean, empty form. */}
          <a href="/register" className="mt-4 inline-block text-sm font-semibold text-amber-300 underline">
            Submit another response
          </a>
        </TitleCard>
      </FormFrame>
    );
  }

  const set = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };
  const useOptions = settings.availability_options.length > 0;
  const availabilityValue = useOptions ? availability.join(", ") : (values.availability ?? "");

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await resizeImage(file, 900);
      const resized = new File([blob], "photo.jpg", { type: "image/jpeg" });
      setPhoto(resized);
      setPhotoPreview(URL.createObjectURL(resized));
      setErrors((e) => ({ ...e, photo: "" }));
    } catch {
      setErrors((e) => ({ ...e, photo: "That file doesn't look like a photo" }));
    }
  }

  async function pickReceipt(file: File | undefined) {
    if (!file) return;
    if (file.type === "application/pdf") {
      if (file.size > RECEIPT_MAX_BYTES) return setErrors((e) => ({ ...e, receipt: "PDF must be under 3 MB" }));
      setReceipt(file);
    } else {
      try {
        const blob = await resizeImage(file, 1600, 0.8);
        setReceipt(new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      } catch {
        return setErrors((e) => ({ ...e, receipt: "Upload an image or PDF" }));
      }
    }
    setErrors((e) => ({ ...e, receipt: "" }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    const all = { ...values, availability: availabilityValue, declaration: values.declaration ?? "" };
    const parsed = registrationFields.safeParse(all);
    const errs: Errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
    if (!photo) errs.photo = "Please upload your photo";
    else if (photo.size > PHOTO_MAX_BYTES) errs.photo = "Photo is too large";
    if (settings.receipt_required && !receipt) errs.receipt = "Please upload your payment receipt";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(all)) form.set(k, v);
    form.set("website", (e.currentTarget.elements.namedItem("website") as HTMLInputElement)?.value ?? "");
    form.set("photo", photo!);
    if (receipt) form.set("receipt", receipt);
    setSubmitting(true);
    try {
      const res = await fetch("/api/register", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? "Something went wrong, please try again");
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormFrame>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TitleCard title={settings.title}>
          {settings.intro && <p className="mt-2 whitespace-pre-line text-slate-300">{settings.intro}</p>}
          {settings.rulebook_url && (
            <a
              href={settings.rulebook_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-3 rounded-2xl bg-amber-400/10 p-4 ring-1 ring-amber-400/40 transition hover:bg-amber-400/15"
            >
              <span className="text-3xl" aria-hidden>
                📘
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-amber-100">{settings.rulebook_message || "Read the rulebook before registering."}</span>
                <span className="mt-0.5 block text-sm font-semibold text-amber-300 underline">Open the rulebook ↗</span>
              </span>
            </a>
          )}
        </TitleCard>

        {/* Honeypot for bots; hidden from people and screen readers. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />

        <Section title="About you" note="Only the organisers see your contact details and flat number.">
          <Input
            label="Full name"
            name="full_name"
            autoComplete="name"
            autoCapitalize="words"
            maxLength={80}
            values={values}
            errors={errors}
            set={set}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={120}
            values={values}
            errors={errors}
            set={set}
          />
          <Input
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="10-digit mobile number"
            lead="+91"
            hint={values.phone && values.phone.length < 10 ? `${values.phone.length}/10 digits` : undefined}
            clean={typingMobile}
            values={values}
            errors={errors}
            set={set}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Flat number"
              name="flat_number"
              placeholder="e.g. B-1203"
              autoCapitalize="characters"
              maxLength={30}
              clean={(v) => v.toUpperCase()}
              values={values}
              errors={errors}
              set={set}
            />
            <Input
              label="Age"
              name="age"
              type="text"
              inputMode="numeric"
              placeholder="Years"
              clean={(v) => v.replace(/\D/g, "").slice(0, 3)}
              values={values}
              errors={errors}
              set={set}
            />
          </div>
          <Choice label="Gender" name="gender" options={[["men", "Male"], ["women", "Female"]]} values={values} errors={errors} set={set} />
        </Section>

        <Section title="Your cricket">
          <Select label="Playing role" name="role" options={PLAYER_ROLES} values={values} errors={errors} set={set} />
          <Select label="Batting style" name="batting_style" options={BATTING_STYLES} values={values} errors={errors} set={set} />
          <Select label="Bowling style" name="bowling_style" options={BOWLING_STYLES} values={values} errors={errors} set={set} />
          <Select label="T-shirt size" name="tshirt_size" options={TSHIRT_SIZES} values={values} errors={errors} set={set} />
        </Section>

        <Section title={settings.availability_question}>
          {useOptions ? (
            <div data-error={!!errors.availability} className="space-y-2">
              {settings.availability_options.map((o) => (
                <label key={o} className="flex items-center gap-3 rounded-xl bg-slate-950 px-3 py-3 ring-1 ring-white/10">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-amber-400"
                    checked={availability.includes(o)}
                    onChange={(e) => {
                      setAvailability((a) => (e.target.checked ? [...a, o] : a.filter((x) => x !== o)));
                      setErrors((er) => ({ ...er, availability: "" }));
                    }}
                  />
                  {o}
                </label>
              ))}
              <FieldError msg={errors.availability} />
            </div>
          ) : (
            <Input label="Your availability" name="availability" placeholder="e.g. All match days" values={values} errors={errors} set={set} />
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-300">Additional information (optional)</span>
            <textarea
              className={inputClass}
              rows={3}
              maxLength={500}
              placeholder="Past teams, achievements, anything the team owners should know"
              value={values.additional_info ?? ""}
              onChange={(e) => set("additional_info", e.target.value)}
            />
            <span className="mt-1 block text-right text-xs text-slate-500">{(values.additional_info ?? "").length}/500</span>
          </label>
        </Section>

        <Section title="Photo" note="This photo is shown on your player card during the auction.">
          <div data-error={!!errors.photo} className="flex items-center gap-4">
            <div className="flex h-28 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-800 text-3xl ring-1 ring-white/10">
              {photoPreview ? <img src={photoPreview} alt="Your photo" className="h-full w-full object-cover" /> : "📷"}
            </div>
            <div>
              <FileButton label={photo ? "Change photo" : "Upload photo"} accept="image/*" onPick={pickPhoto} />
              <p className="mt-2 text-xs text-slate-500">A clear, front-facing photo works best.</p>
              <FieldError msg={errors.photo} />
            </div>
          </div>
        </Section>

        <Section title="Payment">
          {settings.payment_instructions && <p className="whitespace-pre-line text-sm text-slate-300">{settings.payment_instructions}</p>}
          {payments.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {payments.map((p) => (
                  <PaymentCard key={p.payload} payment={p} />
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Paying from this phone? Tap <b>Download QR</b>, then in your UPI app (GPay, PhonePe, Paytm…) tap <i>Scan QR</i> and
                pick the image from your gallery. Or tap <b>Copy</b> and pay to that{" "}
                {payments.every((p) => p.phone) ? "number" : "number or UPI ID"}.
              </p>
            </>
          )}
          <div data-error={!!errors.receipt}>
            <p className="mb-2 text-sm font-medium text-slate-300">
              Payment screenshot or receipt{settings.receipt_required ? "" : " (optional)"}
            </p>
            <FileButton label={receipt ? "Change receipt" : "Upload receipt"} accept="image/*,application/pdf" onPick={pickReceipt} />
            {receipt && <p className="mt-2 text-xs text-emerald-300">✓ Receipt attached</p>}
            <FieldError msg={errors.receipt} />
          </div>
        </Section>

        <Section title="Undertaking and Declaration">
          <div
            tabIndex={0}
            aria-label="Undertaking and Declaration"
            className="max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-slate-950 p-3 text-sm leading-relaxed text-slate-300 ring-1 ring-white/10"
          >
            {settings.declaration_text}
          </div>
          {settings.rulebook_url && (
            <p className="text-sm text-slate-400">
              Rule Book:{" "}
              <a href={settings.rulebook_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-300 underline">
                open it here ↗
              </a>
            </p>
          )}
          <label
            data-error={!!errors.declaration}
            className={cn(
              "flex items-start gap-3 rounded-xl p-3 ring-1",
              values.declaration === "yes" ? "bg-emerald-500/10 ring-emerald-500/40" : "bg-slate-950 ring-white/15",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-amber-400"
              checked={values.declaration === "yes"}
              onChange={(e) => set("declaration", e.target.checked ? "yes" : "")}
            />
            <span className="text-sm font-semibold">I have read and agree to the Undertaking and Declaration</span>
          </label>
          <FieldError msg={errors.declaration} />
        </Section>

        {serverError && <p role="alert" className="rounded-xl bg-rose-950 p-3 text-sm text-rose-200">{serverError}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={submitting} disabled={values.declaration !== "yes"}>
          {submitting ? "Submitting…" : "Submit registration"}
        </Button>
        {values.declaration !== "yes" && (
          <p className="-mt-2 text-center text-xs text-slate-500">Tick &ldquo;I have read and agree&rdquo; above to submit.</p>
        )}
      </form>
    </FormFrame>
  );
}

/** Page frame for the standalone form: a colour band at the top, like a Google Form. */
function FormFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-950 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div
        aria-hidden
        className="h-32 bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 pt-[env(safe-area-inset-top)] sm:h-40"
      />
      <main className="mx-auto -mt-20 max-w-xl px-4 sm:-mt-24">{children}</main>
      <p className="mt-8 text-center text-xs text-slate-600">
        {APP_NAME} ·{" "}
        <a href="/privacy" className="underline">
          Privacy
        </a>
      </p>
    </div>
  );
}

function TitleCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
      <div className="h-2 bg-amber-400" aria-hidden />
      <div className="p-5 sm:p-6">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-300">
          <img src="/icons/icon-192.png" alt="" className="h-6 w-6 rounded-md" />
          {APP_NAME}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">{title}</h1>
        {children}
      </div>
    </header>
  );
}

/**
 * The QR code as a PNG with the payee's name and number under it, so it can
 * be saved to the phone and scanned from a UPI app's gallery.
 */
async function qrImageFile(payment: PaymentOption): Promise<File> {
  const qr = new Image();
  qr.src = payment.png;
  await qr.decode();
  const pad = 40;
  const size = qr.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = size + pad * 2;
  canvas.height = size + pad * 2 + 120;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qr, pad, pad, size, size);
  ctx.textAlign = "center";
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(payment.name || payment.upiId, canvas.width / 2, size + pad + 50, canvas.width - pad * 2);
  ctx.fillStyle = "#334155";
  ctx.font = "34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(payment.phone || payment.upiId, canvas.width / 2, size + pad + 100, canvas.width - pad * 2);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
  const slug = (payment.name || payment.upiId).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "qr";
  return new File([blob], `payment-qr-${slug}.png`, { type: "image/png" });
}

function PaymentCard({ payment }: { payment: PaymentOption }) {
  const [copied, setCopied] = useState(false);
  // Built ahead of time so the iPhone share sheet opens straight from the tap.
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let active = true;
    qrImageFile(payment)
      .then((f) => active && setFile(f))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [payment]);

  const shown = payment.phone ? formatMobile(normalizeMobile(payment.phone)) : payment.upiId;
  const copyText = payment.phone ? normalizeMobile(payment.phone) : payment.upiId;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this", copyText);
    }
  };
  const download = async () => {
    const f = file ?? (await qrImageFile(payment));
    // iPhones save downloads to Files, not Photos: the share sheet has "Save Image".
    if (isIOS() && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f] });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex flex-col items-center rounded-xl bg-white p-3 text-slate-900">
      {payment.label && <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{payment.label}</p>}
      <div
        role="img"
        aria-label={`UPI QR code for ${payment.name || payment.upiId}`}
        className="w-full max-w-[220px] [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: payment.svg }}
      />
      {payment.name && <p className="mt-1 text-center font-bold">{payment.name}</p>}
      <div className="mt-2 flex w-full items-center gap-2 rounded-lg bg-slate-100 py-1.5 pl-2.5 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-sm" title={shown}>
          {payment.phone && <span aria-hidden>📞 </span>}
          {shown}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${payment.phone ? "phone number" : "UPI ID"} ${shown}`}
          className="shrink-0 rounded-md bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-900"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <button
        type="button"
        onClick={() => void download()}
        className="mt-2 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
      >
        ⬇ Download QR
      </button>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10 sm:p-5">
      <legend className="sr-only">{title}</legend>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </fieldset>
  );
}

interface FieldProps {
  label: string;
  name: string;
  values: Record<string, string>;
  errors: Errors;
  set: (k: string, v: string) => void;
}

function Input({
  label,
  name,
  values,
  errors,
  set,
  clean,
  lead,
  hint,
  ...rest
}: FieldProps &
  React.InputHTMLAttributes<HTMLInputElement> & {
    /** Tidies the value as it is typed (e.g. digits only). */
    clean?: (v: string) => string;
    /** Fixed text shown before the box, e.g. "+91". */
    lead?: string;
    hint?: string;
  }) {
  const input = (
    <input
      {...rest}
      name={name}
      aria-invalid={!!errors[name]}
      className={cn(inputClass, lead && "rounded-l-none", errors[name] && "ring-2! ring-rose-500!")}
      value={values[name] ?? ""}
      onChange={(e) => set(name, clean ? clean(e.target.value) : e.target.value)}
    />
  );
  return (
    <label className="block text-sm" data-error={!!errors[name]}>
      <span className="mb-1 block font-medium text-slate-300">{label}</span>
      {lead ? (
        <span className="flex">
          <span className="flex items-center rounded-l-lg bg-slate-800 px-3 font-semibold text-slate-300 ring-1 ring-white/15">{lead}</span>
          {input}
        </span>
      ) : (
        input
      )}
      {hint && !errors[name] && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      <FieldError msg={errors[name]} />
    </label>
  );
}

function Select({ label, name, options, values, errors, set }: FieldProps & { options: readonly string[] }) {
  return (
    <label className="block text-sm" data-error={!!errors[name]}>
      <span className="mb-1 block font-medium text-slate-300">{label}</span>
      <select
        name={name}
        aria-invalid={!!errors[name]}
        className={cn(inputClass, errors[name] && "ring-2! ring-rose-500!")}
        value={values[name] ?? ""}
        onChange={(e) => set(name, e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <FieldError msg={errors[name]} />
    </label>
  );
}

function Choice({ label, name, options, values, errors, set }: FieldProps & { options: [string, string][] }) {
  return (
    <div className="text-sm" data-error={!!errors[name]} role="radiogroup" aria-label={label}>
      <span className="mb-1 block font-medium text-slate-300">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([value, text]) => (
          <button
            type="button"
            key={value}
            role="radio"
            aria-checked={values[name] === value}
            onClick={() => set(name, value)}
            className={cn(
              "rounded-xl py-3 font-semibold ring-1",
              values[name] === value ? "bg-amber-400 text-amber-950 ring-amber-400" : "bg-slate-950 text-slate-200 ring-white/15",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      <FieldError msg={errors[name]} />
    </div>
  );
}

function FileButton({ label, accept, onPick }: { label: string; accept: string; onPick: (f: File | undefined) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/15">
      {label}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <span className="mt-1 block text-xs font-medium text-rose-300">{msg}</span> : null;
}
