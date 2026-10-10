"use client";

import { useRef } from "react";
import { LiveTicker } from "../live/LiveTicker";
import { ResultsFeed } from "../live/ResultsFeed";
import { Stage } from "../live/Stage";
import { TeamsBoard } from "../live/TeamsBoard";
import { useWishlist } from "../owner/WishlistProvider";

/** The live block (wheel, player card, current bid and history), team purses and results. */
export function LivePage() {
  const { enabled, teamId } = useWishlist();
  const ownerTeam = enabled ? teamId : null;
  const stageRef = useRef<HTMLDivElement>(null);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div ref={stageRef} className="scroll-mt-28">
        <Stage />
      </div>
      <div className="space-y-6">
        <TeamsBoard highlightTeamId={ownerTeam} compact />
        <ResultsFeed limit={6} />
      </div>
      <LiveTicker watch={stageRef} />
    </div>
  );
}
