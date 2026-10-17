"use client";

import { bidAdvice, rivalWatch, squadCheck, type BidAdvice, type RivalInfo, type SquadCheck, type Verdict } from "@/lib/advisor";
import { cn, money } from "@/lib/format";
import { PLAYER_ROLES, type Player, type PlayerRole, type Pool } from "@/lib/types";
import { useAuction } from "../live/useAuction";
import { useRevealedPlayer } from "../live/useRevealedPlayer";
import { AiScoutCard } from "./AiScout";
import { useInsight } from "./InsightsProvider";
import { useWishlist } from "./WishlistProvider";

const ROLE_ICON: Record<PlayerRole, string> = { Batter: "🏏", Bowler: "🎯", "All-rounder": "⚡", "Wicket-keeper": "🧤" };
const VERDICT_STYLE: Record<Verdict, string> = {
  bid: "bg-emerald-500/15 text-emerald-100 ring-emerald-400/40",
  leading: "bg-sky-500/15 text-sky-100 ring-sky-400/40",
  "let-go": "bg-white/5 text-slate-200 ring-white/15",
  "cant-afford": "bg-rose-500/15 text-rose-100 ring-rose-400/40",
  full: "bg-white/5 text-slate-200 ring-white/15",
};
const VERDICT_LABEL: Record<Verdict, string> = { bid: "Bid", leading: "Leading", "let-go": "Let go", "cant-afford": "Can't afford", full: "Squad full" };

/**
 * The owner's AI suggestions for their own team: how far to go for the
 * player on the block, what the squad still needs and which rivals can
 * compete. Worked out on this device from the live auction, the price guide
 * (with the AI's notes) and the team's private wishlist.
 */
export function AiSuggestions({
  teamId,
  pool: chosenPool,
  variant = "full",
  showScout = true,
  className,
}: {
  teamId: string;
  pool?: Pool;
  /** "live": short, under the auction stage; "full": everything. */
  variant?: "live" | "full";
  /** Include the player's scouting card (off where the page already shows it). */
  showScout?: boolean;
  className?: string;
}) {
  const { state, configs, teams, teamById, players, playerById, summaries, pool: currentPool } = useAuction();
  const { byPlayer } = useWishlist();
  const revealedId = useRevealedPlayer();
  const block = revealedId ? (playerById.get(revealedId) ?? null) : null;
  const insight = useInsight(block?.id);
  const pool = block?.pool ?? chosenPool ?? currentPool;
  const config = configs[pool];
  const sums = summaries(pool);
  const mine = sums.get(teamId);
  if (!config || !mine) return null;

  const squad = squadCheck(mine, players, teamId, pool);
  const rivals = rivalWatch({ teams, summaries: sums, players, pool, teamId, player: block, state, config });
  const advice =
    block && state ? bidAdvice({ player: block, state, config, teamId, mine, squad, insight, entry: byPlayer.get(block.id) ?? null, rivals }) : null;
  const team = teamById.get(teamId);

  return (
    <section
      aria-label="AI suggestions"
      className={cn("space-y-4 rounded-2xl bg-gradient-to-b from-fuchsia-950/40 to-slate-900 p-4 ring-1 ring-fuchsia-400/25", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-fuchsia-200">✨ AI suggestions</h2>
        <p className="text-[11px] text-slate-400">For {team?.name ?? "your team"} only</p>
      </div>

      {block && advice ? (
        <AdviceBlock player={block} advice={advice} variant={variant} showScout={showScout} />
      ) : (
        <p className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400" aria-label="Live bid advice">
          {state?.phase === "spinning" ? "The wheel is spinning…" : "When a player comes up, you'll see here how far to go for them."}
        </p>
      )}

      <SquadBlock squad={squad} variant={variant} />
      <RivalBlock rivals={rivals} player={block} advice={advice} variant={variant} />
    </section>
  );
}

function AdviceBlock({ player, advice, variant, showScout }: { player: Player; advice: BidAdvice; variant: "live" | "full"; showScout: boolean }) {
  const reasons = variant === "live" ? advice.reasons.slice(0, 4) : advice.reasons;
  return (
    <div aria-label="Live bid advice" role="region" className={cn("rounded-xl p-3 ring-1", VERDICT_STYLE[advice.verdict])}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-bold uppercase tracking-wider opacity-80">
          {ROLE_ICON[player.role]} {player.name}
        </p>
        <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-bold">{VERDICT_LABEL[advice.verdict]}</span>
      </div>
      <p className="mt-1 text-xl font-black leading-tight">{advice.headline}</p>
      <p className="mt-0.5 text-xs opacity-80">
        {advice.opening ? "Opens at" : "Next bid"} {money(advice.next)}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {reasons.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="opacity-60">
              •
            </span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {showScout && <AiScoutCard playerId={player.id} compact={variant === "live"} className="mt-3" />}
    </div>
  );
}

function SquadBlock({ squad, variant }: { squad: SquadCheck; variant: "live" | "full" }) {
  const extras = [squad.owners && `${squad.owners} owner${squad.owners === 1 ? "" : "s"}`, squad.stars && "star"].filter(Boolean).join(" + ");
  return (
    <div role="region" aria-label="Squad check">
      <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-400">Squad check</p>
      <p className="text-sm text-slate-200">
        {squad.bought} bought{extras && ` + ${extras}`} ·{" "}
        {squad.toMax === 0 ? (
          "squad full"
        ) : (
          <>
            {squad.toMin > 0 ? `${squad.toMin} more needed` : `up to ${squad.toMax} more`} · about <b className="tabular-nums">{money(squad.perPlayer)}</b> each
          </>
        )}
      </p>
      {variant === "full" && (
        <p className="mt-0.5 text-xs text-slate-400">
          Purse left {money(squad.remaining)} · max bid now {money(squad.maxBid)} · full team {squad.teamSize}
        </p>
      )}
      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {PLAYER_ROLES.map((r) => (
          <li key={r} className={cn("rounded-lg px-2 py-1 tabular-nums", squad.roles[r] ? "bg-white/10 text-slate-100" : "bg-white/[0.03] text-slate-500")}>
            {ROLE_ICON[r]} {r} {squad.roles[r]}
          </li>
        ))}
      </ul>
      {squad.needs.length > 0 ? (
        <p className="mt-2 text-sm text-amber-200">Needs {squad.needs.map((n) => n.label).join(", ")}.</p>
      ) : (
        squad.toMax > 0 && <p className="mt-2 text-sm text-emerald-300">Looks balanced: pick the best value.</p>
      )}
      {squad.tight && <p className="mt-1 text-xs text-amber-200/80">More gaps than places left: all-rounders cover two at once.</p>}
    </div>
  );
}

function RivalBlock({ rivals, player, advice, variant }: { rivals: RivalInfo[]; player: Player | null; advice: BidAdvice | null; variant: "live" | "full" }) {
  if (player) {
    const active = rivals.filter((r) => r.canBid || r.leading);
    const out = rivals.length - active.length;
    return (
      <div role="region" aria-label="Rival watch">
        <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-400">Rival watch · {active.length} can bid</p>
        {active.length === 0 ? (
          <p className="text-sm text-slate-400">No other team can go higher right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {active.map((r) => (
              <li key={r.team.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-950/50 px-2.5 py-1.5 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.team.color }} />
                <span className="min-w-0 max-w-[10rem] truncate font-semibold">{r.team.name}</span>
                <span className="tabular-nums text-slate-300">up to {money(r.maxBid)}</span>
                {r.leading && <span className="rounded bg-sky-500/20 px-1.5 text-[11px] font-semibold text-sky-200">leading</span>}
                {r.needsRole && (
                  <span className="rounded bg-rose-500/20 px-1.5 text-[11px] font-semibold text-rose-200">
                    needs {/^[aeiou]/i.test(player.role) ? "an" : "a"} {player.role.toLowerCase()}
                  </span>
                )}
                {advice?.limit != null && r.maxBid > advice.limit && (
                  <span className="rounded bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-200">can go past your limit</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {out > 0 && <p className="mt-1.5 text-xs text-slate-500">{out} other team(s) can&apos;t afford the next bid or are full.</p>}
      </div>
    );
  }
  const list = variant === "live" ? rivals.slice(0, 3) : rivals;
  return (
    <div role="region" aria-label="Rival watch">
      <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-400">Rival watch</p>
      <ul className="space-y-1.5">
        {list.map((r) => (
          <li key={r.team.id} className="rounded-lg bg-slate-950/50 px-2.5 py-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.team.color }} />
              <span className="min-w-0 max-w-[10rem] truncate font-semibold">{r.team.name}</span>
              <span className="tabular-nums text-slate-300">
                {money(r.remaining)} left · max bid {money(r.maxBid)} · {r.placesLeft} place{r.placesLeft === 1 ? "" : "s"}
              </span>
            </div>
            {variant === "full" && r.needs.length > 0 && <p className="mt-0.5 text-xs text-slate-400">Needs {r.needs.map((n) => n.label).join(", ")}</p>}
          </li>
        ))}
      </ul>
      {list.length < rivals.length && <p className="mt-1.5 text-xs text-slate-500">Strongest {list.length} purses shown.</p>}
    </div>
  );
}
