import Link from "next/link";
import { APP_NAME } from "@/lib/env";

export const metadata = { title: "Privacy policy" };

// Linked from the Google OAuth consent screen.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-slate-300">
      <h1 className="text-2xl font-extrabold text-white">Privacy policy</h1>
      <p>
        {APP_NAME} runs the player auction for our college cricket tournament. Watching the auction needs no account.
      </p>
      <h2 className="pt-2 text-lg font-bold text-white">What we collect</h2>
      <p>
        Team owners and organisers sign in with Google. We receive only your name, email address and profile picture,
        and use them to decide whether you own a team or run the auction, and to show organisers who is signed in.
      </p>
      <p>
        We store the auction itself: players, bids and results. For team owners we also store their team&apos;s private
        wishlist and, if they turn on alerts, the browser address needed to send notifications to their phone. We
        don&apos;t use cookies for tracking or advertising, and we don&apos;t sell or share your data.
      </p>
      <h2 className="pt-2 text-lg font-bold text-white">Retention and deletion</h2>
      <p>
        Data is kept for the tournament and deleted afterwards. To have your data removed sooner, contact the organisers.
      </p>
      <Link href="/" className="inline-block pt-2 text-amber-300 underline">
        Back to the live auction
      </Link>
    </main>
  );
}
