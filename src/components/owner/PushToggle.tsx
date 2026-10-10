"use client";

import { useEffect, useState } from "react";
import { ApiError, callAction } from "@/lib/api";
import { cn } from "@/lib/format";
import { disablePush, enablePush, pushStatus, type PushStatus } from "@/lib/push-client";
import { Button } from "../ui";
import { useToast } from "../Toast";
import { useWishlist } from "./WishlistProvider";

const TEXT: Record<PushStatus, string> = {
  on: "This device gets a notification when a player on your wishlist comes up — even when the app is closed.",
  off: "Get a notification on this device when a player on your wishlist comes up, even when the app is closed.",
  denied: "Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.",
  "needs-install":
    "On iPhone, notifications only work in the installed app: tap Share (□↑) → Add to Home Screen, open the app from your home screen, sign in and turn alerts on there.",
  unsupported: "This browser can't receive notifications. The in-app chime still works while the app is open.",
};

/** Turns wishlist push notifications on/off for this device. */
export function PushToggle() {
  const { vapidPublicKey, preview } = useWishlist();
  const toast = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    pushStatus()
      .then((s) => active && setStatus(s))
      .catch(() => active && setStatus("unsupported"));
    return () => {
      active = false;
    };
  }, []);

  if (preview) {
    return (
      <section className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
        <span className="text-2xl" aria-hidden>
          🔔
        </span>
        <p className="text-slate-300">
          <b>Wishlist alerts</b> — owners turn on phone notifications here. Not available in preview; the in-app chime and banner
          still work.
        </p>
      </section>
    );
  }
  if (!status) return null;

  async function run(fn: () => Promise<PushStatus | void>, done?: string) {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setStatus(next);
      if (done) toast(done, "success");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't change notifications", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl p-4 ring-1",
        status === "on" ? "bg-emerald-500/10 ring-emerald-500/30" : "bg-amber-400/10 ring-amber-400/30",
      )}
    >
      <span className="text-2xl" aria-hidden>
        {status === "on" ? "🔔" : "🔕"}
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-bold">{status === "on" ? "Wishlist alerts are on" : "Wishlist alerts"}</p>
        <p className="text-sm text-slate-300">{TEXT[status]}</p>
      </div>
      {status === "off" && vapidPublicKey && (
        <Button variant="primary" busy={busy} onClick={() => run(() => enablePush(vapidPublicKey), "Alerts turned on")}>
          Turn on alerts
        </Button>
      )}
      {status === "on" && (
        <div className="flex gap-2">
          <Button size="sm" busy={busy} onClick={() => run(async () => void (await callAction("push.test", {})), "Test sent")}>
            Send test
          </Button>
          <Button size="sm" variant="ghost" busy={busy} onClick={() => run(() => disablePush(), "Alerts turned off")}>
            Turn off
          </Button>
        </div>
      )}
    </section>
  );
}
