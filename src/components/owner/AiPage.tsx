"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/format";
import { POOL_LABEL, POOLS, type Pool } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { useRevealedPlayer } from "../live/useRevealedPlayer";
import { useMe } from "../MeProvider";
import { AiSuggestions } from "./AiSuggestions";
import { useInsights } from "./InsightsProvider";
import { PreviewPicker } from "./WishlistPage";
import { useWishlist } from "./WishlistProvider";

/** The owner's AI tab: the full suggestions panel for their team. */
export function AiPage() {
  const { me, signIn } = useMe();
  const { enabled, teamId, canPreview } = useWishlist();

  if (!me) return <p className="animate-pulse py-16 text-center text-slate-400">Loading…</p>;
  if ((!enabled || !teamId) && canPreview) return <PreviewPicker />;
  if (!enabled || !teamId) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-slate-900 p-6 text-center ring-1 ring-white/10">
        <p className="text-4xl" aria-hidden>
          ✨
        </p>
        <h1 className="mt-2 text-xl font-bold">AI suggestions</h1>
        <p className="mt-2 text-slate-400">Team owners get suggested prices, bid advice and a squad check for their own team.</p>
        {me.email ? (
          <p className="mt-4 text-sm text-slate-400">{me.email} isn&apos;t linked to a team. Ask the organiser to add you as an owner.</p>
        ) : (
          <button onClick={() => void signIn("/ai")} className="mt-4 rounded-xl bg-amber-400 px-4 py-2.5 font-semibold text-amber-950">
            Owner sign-in
          </button>
        )}
      </div>
    );
  }
  return <OwnerAi teamId={teamId} />;
}

function OwnerAi({ teamId }: { teamId: string }) {
  const { ready, teamById, pool: currentPool } = useAuction();
  const { ai, ready: insightsReady } = useInsights();
  const revealedId = useRevealedPlayer();
  const [chosen, setPool] = useState<Pool | null>(null);
  const pool = chosen ?? currentPool;
  const team = teamById.get(teamId);

  if (!ready) return <p className="animate-pulse py-16 text-center text-slate-400">Loading your team…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-fuchsia-300">AI suggestions</p>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            {team && <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: team.color }} aria-hidden />}
            <span className="min-w-0 break-words">{team?.name ?? "Your team"}</span>
          </h1>
        </div>
        {!revealedId && (
          <div className="flex rounded-xl bg-white/5 p-1" role="tablist" aria-label="Pool">
            {POOLS.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={pool === p}
                onClick={() => setPool(p)}
                className={cn("rounded-lg px-4 py-1.5 text-sm font-bold", pool === p ? "bg-fuchsia-400 text-fuchsia-950" : "text-slate-300")}
              >
                {POOL_LABEL[p]}
              </button>
            ))}
          </div>
        )}
      </div>

      <AiSuggestions teamId={teamId} pool={pool} />

      <details className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300 ring-1 ring-white/10">
        <summary className="cursor-pointer font-bold text-slate-200">How these suggestions work</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Each player&apos;s price guide comes from what they went for in previous PPL auctions (against that season&apos;s average), their stats
            and availability, scaled to what the teams have left. It updates as players are sold.
          </li>
          {insightsReady && ai && <li>The AI reads the stats, writes a short note and may move the fair price by up to 20%.</li>}
          <li>
            Bid advice starts from your own <Link href="/wishlist" className="underline">wishlist</Link> max if you set one; otherwise from the guide:
            the stretch price for must-haves, fair for wants and for players who fill a gap, the low end for the rest. It keeps enough money for the
            places you still have to fill.
          </li>
          <li>The squad check looks for a wicket-keeper and enough players who can bowl and bat, from the roles players registered with.</li>
          <li>Only your team sees this. It&apos;s a suggestion: the decision is yours.</li>
        </ul>
      </details>
    </div>
  );
}
