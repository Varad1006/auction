"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

const TABS = [
  { href: "/admin", label: "Auction" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/owners", label: "Owners" },
  { href: "/admin/results", label: "Results" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="border-b border-white/10 bg-slate-950">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
        {TABS.map((t) => {
          const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold",
                active ? "border-amber-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200",
              )}
            >
              {t.label}
            </Link>
          );
        })}
        <a
          href="/display"
          target="_blank"
          rel="noreferrer"
          className="ml-auto whitespace-nowrap px-3 py-3 text-sm font-semibold text-amber-300 hover:text-amber-200"
        >
          Projector view ↗
        </a>
      </div>
    </nav>
  );
}
