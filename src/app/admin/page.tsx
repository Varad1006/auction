import { AuctionControls } from "@/components/admin/AuctionControls";
import { ResultsFeed } from "@/components/live/ResultsFeed";
import { Stage } from "@/components/live/Stage";
import { TeamsBoard } from "@/components/live/TeamsBoard";

// Controls sit next to the block on wide screens so Spin / SOLD are in view
// without scrolling; on phones they follow straight after the block.
export default function AdminAuctionPage() {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Stage />
      <div className="space-y-6">
        <AuctionControls />
        <TeamsBoard compact />
      </div>
      <div className="lg:col-span-2">
        <ResultsFeed limit={8} />
      </div>
    </div>
  );
}
