import { LiveBoard } from "@/components/live/LiveBoard";

// Public live view. Viewers need no sign-in; signed-in owners also get
// their bid controls here.
export default function Home() {
  return <LiveBoard />;
}
