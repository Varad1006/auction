import { AuctionControls } from "@/components/admin/AuctionControls";
import { ResultsFeed } from "@/components/live/ResultsFeed";
import { Stage } from "@/components/live/Stage";
import { TeamsBoard } from "@/components/live/TeamsBoard";

export default function AdminAuctionPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Stage />
        <AuctionControls />
      </div>
      <div className="space-y-6">
        <TeamsBoard />
        <ResultsFeed />
      </div>
    </div>
  );
}
