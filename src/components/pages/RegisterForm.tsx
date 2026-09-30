"use client";

import { useState } from "react";
import { cn } from "@/lib/format";
import { resizeImage } from "@/lib/image";
import {
  BATTING_STYLES,
  BOWLING_STYLES,
  PHOTO_MAX_BYTES,
  RECEIPT_MAX_BYTES,
  registrationFields,
  TSHIRT_SIZES,
  type RegistrationSettings,
} from "@/lib/registration";
import { PLAYER_ROLES } from "@/lib/types";
import { Button, inputClass } from "../ui";

type Errors = Record<string, string>;

export function RegisterForm({ settings }: { settings: RegistrationSettings }) {
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
      <div className="mx-auto max-w-lg rounded-2xl bg-slate-900 p-8 text-center ring-1 ring-white/10">
        <p className="text-4xl">🏏</p>
        <h1 className="mt-3 text-2xl font-extrabold">{settings.title}</h1>
        <p className="mt-2 text-slate-400">Registration is closed right now. Please check back later or contact the organisers.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-slate-900 p-8 text-center ring-1 ring-emerald-500/40">
        <p className="text-5xl">✅</p>
        <h1 className="mt-3 text-2xl font-extrabold">You&apos;re registered!</h1>
        <p className="mt-2 text-slate-300">
          Thanks, {values.full_name?.split(" ")[0]}. The organisers will review your registration and add you to the auction
          pool. See you on the field!
        </p>
      </div>
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
    <form onSubmit={submit} noValidate className="mx-auto max-w-xl space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{settings.title}</h1>
        {settings.intro && <p className="mt-2 whitespace-pre-line text-slate-300">{settings.intro}</p>}
      </header>

      {/* Honeypot for bots; hidden from people and screen readers. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />

      <Section title="About you" note="Only the organisers see your contact details and flat number.">
        <Input label="Full name" name="full_name" autoComplete="name" values={values} errors={errors} set={set} />
        <Input label="Email" name="email" type="email" autoComplete="email" values={values} errors={errors} set={set} />
        <Input label="Contact number" name="phone" type="tel" autoComplete="tel" values={values} errors={errors} set={set} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Flat number" name="flat_number" placeholder="e.g. B-1203" values={values} errors={errors} set={set} />
          <Input label="Age" name="age" type="number" inputMode="numeric" values={values} errors={errors} set={set} />
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

      <Section title={`Payment receipt${settings.receipt_required ? "" : " (optional)"}`}>
        {settings.payment_instructions && <p className="whitespace-pre-line text-sm text-slate-300">{settings.payment_instructions}</p>}
        <div data-error={!!errors.receipt}>
          <FileButton label={receipt ? "Change receipt" : "Upload receipt"} accept="image/*,application/pdf" onPick={pickReceipt} />
          {receipt && <p className="mt-2 text-xs text-emerald-300">✓ Receipt attached</p>}
          <FieldError msg={errors.receipt} />
        </div>
      </Section>

      <Section title="Undertaking and declaration">
        <p className="whitespace-pre-line text-sm text-slate-300">{settings.declaration_text}</p>
        <label data-error={!!errors.declaration} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-amber-400"
            checked={values.declaration === "yes"}
            onChange={(e) => set("declaration", e.target.checked ? "yes" : "")}
          />
          <span className="text-sm font-medium">I agree</span>
        </label>
        <FieldError msg={errors.declaration} />
      </Section>

      {serverError && <p role="alert" className="rounded-xl bg-rose-950 p-3 text-sm text-rose-200">{serverError}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" busy={submitting}>
        {submitting ? "Submitting…" : "Submit registration"}
      </Button>
    </form>
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

function Input({ label, name, values, errors, set, ...rest }: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm" data-error={!!errors[name]}>
      <span className="mb-1 block font-medium text-slate-300">{label}</span>
      <input
        {...rest}
        name={name}
        aria-invalid={!!errors[name]}
        className={cn(inputClass, errors[name] && "ring-2 ring-rose-500")}
        value={values[name] ?? ""}
        onChange={(e) => set(name, e.target.value)}
      />
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
        className={cn(inputClass, errors[name] && "ring-2 ring-rose-500")}
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
