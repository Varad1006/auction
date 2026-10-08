"use client";

import { useEffect, useState } from "react";
import { isOnBlock } from "@/lib/wishlist";
import { useAuction } from "./useAuction";

/**
 * The id of the player on the block once everyone can see who it is: right
 * away for a picked player, when the wheel stops for a spin.
 */
export function useRevealedPlayer(): string | null {
  const { state } = useAuction();
  const [revealed, setRevealed] = useState<string | null>(null);
  const id = state?.current_player_id ?? null;
  const onBlock = !!id && isOnBlock(state, id);
  // Per spin, so a player who returns in a later round isn't shown early.
  const key = `${id}|${state?.spin_started_at ?? ""}`;
  const revealAt =
    state?.phase === "spinning" && state.spin_started_at ? Date.parse(state.spin_started_at) + state.spin_duration_ms : 0;
  useEffect(() => {
    if (!onBlock) return;
    const t = window.setTimeout(() => setRevealed(key), Math.max(0, revealAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [onBlock, key, revealAt]);
  return onBlock && revealed === key ? id : null;
}
