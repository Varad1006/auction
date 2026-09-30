"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { Header } from "./Header";
import { useLive } from "./live/LiveProvider";
import { OwnerBidBar } from "./live/OwnerBidBar";
import { useMe } from "./MeProvider";
import { SetupNotice } from "./SetupNotice";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/live", label: "Live" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/bids", label: "Results" },
];

/** Header, page tabs and (for owners) the bid bar, shared by every public page. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me } = useMe();
  const { state } = useLive();
  const ownerTeam = me?.role === "owner" ? me.teamId : null;
  const liveNow = state?.phase === "bidding" || state?.phase === "spinning" || state?.phase === "revealed";

  return (
    <>
      <Header />
      <nav className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 [scrollbar-width:none]">
          {TABS.map((t) => {
            const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold",
                  active ? "border-amber-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200",
                )}
              >
                {t.href === "/live" && liveNow && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <SetupNotice />
      <main className={cn("mx-auto max-w-6xl px-4 py-4 lg:py-6", ownerTeam ? "pb-44" : "pb-12")}>{children}</main>
      {ownerTeam && <OwnerBidBar teamId={ownerTeam} />}
    </>
  );
}
