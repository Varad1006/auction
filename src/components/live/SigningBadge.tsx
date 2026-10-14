import { cn } from "@/lib/format";
import { SIGNING_LABEL, type Player, type Signing } from "@/lib/types";

/** "Owner" / "★ Star" tag for players who joined their team outside the auction. */
export function SigningBadge({ signing, className }: { signing: Signing; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide",
        signing === "star" ? "bg-amber-400 text-amber-950" : "bg-violet-500/30 text-violet-100",
        className,
      )}
    >
      {SIGNING_LABEL[signing]}
    </span>
  );
}

/** Owners first, then the star, then auction buys by price. */
export function bySigningThenPrice(a: Player, b: Player): number {
  const rank = (p: Player) => (p.signing === "owner" ? 0 : p.signing === "star" ? 1 : 2);
  return rank(a) - rank(b) || (b.sold_price ?? 0) - (a.sold_price ?? 0);
}

/** "1 star · 2 owners" (empty when the team has neither). */
export function extrasText(s: { owners: number; stars: number }): string {
  return [s.stars && `${s.stars} star`, s.owners && `${s.owners} owner${s.owners > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
}
