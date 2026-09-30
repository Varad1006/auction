"use client";

import { RecentBids } from "../live/RecentBids";
import { ResultsFeed } from "../live/ResultsFeed";
import { Stage } from "../live/Stage";
import { TeamsBoard } from "../live/TeamsBoard";
import { useMe } from "../MeProvider";

/** The live block: wheel, player card, current bid and history, plus team purses. */
export function LivePage() {
  const { me } = useMe();
  const ownerTeam = me?.role === "owner" ? me.teamId : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Stage />
        <RecentBids limit={8} title="Latest bids" />
      </div>
      <div className="space-y-6">
        <TeamsBoard highlightTeamId={ownerTeam} />
        <ResultsFeed limit={6} />
      </div>
    </div>
  );
}
