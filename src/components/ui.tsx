"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import { useToast } from "./Toast";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-amber-400 text-amber-950 hover:bg-amber-300",
  secondary: "bg-white/10 text-slate-100 hover:bg-white/15",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  success: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400",
  ghost: "text-slate-300 hover:bg-white/5",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2.5 text-sm",
        size === "lg" && "px-5 py-3.5 text-base",
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: React.ReactNode; title?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export const inputBase =
  "rounded-lg bg-slate-950 px-3 py-2 text-slate-100 ring-1 ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400";
export const inputClass = `${inputBase} w-full`;

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1 block font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(100vw-2rem,40rem)] rounded-2xl bg-slate-900 p-0 text-slate-100 ring-1 ring-white/10 backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-white/10" aria-label="Close">
          ×
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5">{open && children}</div>
    </dialog>
  );
}

/** Runs an async admin action with a busy flag and toast feedback. */
export function useRunner() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const out = await fn();
        if (success) toast(success, "success");
        return out;
      } catch (e) {
        toast(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong", "error");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
