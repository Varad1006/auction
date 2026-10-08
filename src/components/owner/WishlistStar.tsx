"use client";

import { cn } from "@/lib/format";
import { useWishlist } from "./WishlistProvider";

/** Star toggle that adds/removes a player from the owner's wishlist. Renders nothing for non-owners. */
export function WishlistStar({
  playerId,
  playerName,
  disabled,
  className,
  withLabel,
}: {
  playerId: string;
  playerName: string;
  disabled?: boolean;
  className?: string;
  withLabel?: boolean;
}) {
  const { ready, byPlayer, toggle } = useWishlist();
  if (!ready) return null;
  const on = byPlayer.has(playerId);
  if (disabled && !on) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggle(playerId);
      }}
      disabled={disabled}
      aria-pressed={on}
      aria-label={on ? `Remove ${playerName} from wishlist` : `Add ${playerName} to wishlist`}
      title={on ? "On your wishlist" : "Add to wishlist"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition active:scale-90 disabled:opacity-60",
        withLabel ? "px-3 py-1.5 text-sm" : "h-9 w-9 text-lg",
        on ? "bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/30" : "bg-slate-950/70 text-slate-200 ring-1 ring-white/20 backdrop-blur",
        className,
      )}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {withLabel && (on ? "On your wishlist" : "Add to wishlist")}
    </button>
  );
}
