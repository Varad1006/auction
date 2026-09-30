import { RecentBids } from "@/components/live/RecentBids";
import { ResultsFeed } from "@/components/live/ResultsFeed";

export const metadata = { title: "Bids & results" };

export default function Bids() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <RecentBids limit={60} />
      <ResultsFeed limit={200} />
    </div>
  );
}
