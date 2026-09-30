"use client";

import { Header } from "../Header";
import { useMe } from "../MeProvider";
import { SetupNotice } from "../SetupNotice";
import { OwnerBidBar } from "./OwnerBidBar";
import { ResultsFeed } from "./ResultsFeed";
import { Stage } from "./Stage";
import { TeamsBoard } from "./TeamsBoard";

export function LiveBoard() {
  const { me } = useMe();
  const ownerTeam = me?.role === "owner" ? me.teamId : null;
  return (
    <>
      <Header />
      <SetupNotice />
      <main className={ownerTeam ? "pb-44" : "pb-10"}>
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-6">
          <div className="space-y-6">
            <Stage />
            <div className="hidden lg:block">
              <ResultsFeed />
            </div>
          </div>
          <div className="space-y-6">
            <TeamsBoard highlightTeamId={ownerTeam} />
            <div className="lg:hidden">
              <ResultsFeed limit={8} />
            </div>
          </div>
        </div>
      </main>
      {ownerTeam && <OwnerBidBar teamId={ownerTeam} />}
    </>
  );
}
