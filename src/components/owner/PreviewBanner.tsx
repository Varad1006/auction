"use client";

import { useEffect } from "react";
import { useLive } from "../live/LiveProvider";
import { useWishlist } from "./WishlistProvider";

/** Shown while an admin previews the owner screens as a team. */
export function PreviewBanner() {
  const { teams, ready } = useLive();
  const { preview, teamId, setPreviewTeam } = useWishlist();
  const missing = preview && ready && !teams.some((t) => t.id === teamId);
  // The previewed team was deleted: drop back to the team picker.
  useEffect(() => {
    if (missing) setPreviewTeam(null);
  }, [missing, setPreviewTeam]);
  if (!preview || missing) return null;
  return (
    <div className="border-b border-amber-400/30 bg-amber-400/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="font-semibold text-amber-100">Owner view preview</span>
        <select
          value={teamId ?? ""}
          onChange={(e) => setPreviewTeam(e.target.value || null)}
          aria-label="Preview as team"
          className="rounded-lg bg-slate-950 px-2 py-1 text-sm font-semibold ring-1 ring-white/15"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="hidden text-xs text-amber-200/70 sm:inline">Practice wishlist, saved only in this browser</span>
        <button
          type="button"
          onClick={() => setPreviewTeam(null)}
          className="ml-auto rounded-lg bg-white/10 px-3 py-1 text-sm font-semibold hover:bg-white/15"
        >
          Exit preview
        </button>
      </div>
    </div>
  );
}
