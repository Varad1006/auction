"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/format";

type Kind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: Kind = "info") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === "error" ? 5000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "toast-in pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1",
              t.kind === "error" && "bg-rose-950 text-rose-100 ring-rose-700",
              t.kind === "success" && "bg-emerald-950 text-emerald-100 ring-emerald-700",
              t.kind === "info" && "bg-slate-800 text-slate-100 ring-slate-600",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
