import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { money } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/wishlist";

// Web Push for owner wishlists. The VAPID key pair is generated on first use
// and kept in the private app_secrets table, so there is nothing to set up.

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;

export async function vapidKeys(db: SupabaseClient): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  const read = async () => {
    const { data, error } = await db.from("app_secrets").select("value").eq("name", "vapid").maybeSingle();
    if (error) throw new Error(`Reading push keys failed: ${error.message}`);
    return data ? (JSON.parse(data.value) as VapidKeys) : null;
  };
  let keys = await read();
  if (!keys) {
    // Two first requests can race: the insert is ignored for the loser and
    // both read back the same winning pair.
    const fresh = webpush.generateVAPIDKeys();
    await db.from("app_secrets").upsert({ name: "vapid", value: JSON.stringify(fresh) }, { onConflict: "name", ignoreDuplicates: true });
    keys = await read();
    if (!keys) throw new Error("Could not create push keys");
  }
  cachedKeys = keys;
  return keys;
}

// Only real browser push services are accepted as endpoints, so the server
// never POSTs to an arbitrary URL supplied by a client.
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Local end-to-end tests use a fake push service on localhost.
  if (process.env.PUSH_ALLOW_LOCALHOST === "1" && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) {
    return true;
  }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

export interface PushMessage {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  url: string;
}

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one message; returns false when the subscription is gone for good. */
async function send(sub: Subscription, msg: PushMessage, keys: VapidKeys, subject: string): Promise<boolean> {
  const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), {
    vapidDetails: { subject, ...keys },
    // Only useful while the player is on the block.
    TTL: 300,
    urgency: "high",
    // A newer wishlist alert replaces an undelivered older one.
    topic: "wishlist",
  });
  const res = await fetch(req.endpoint, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: new Uint8Array(req.body as Buffer),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.warn(`Push to ${new URL(sub.endpoint).host} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return true;
}

function subjectFor(origin: string): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  return origin.startsWith("https://") ? origin : "mailto:auction@example.com";
}

/** Sends each subscription its message and forgets the ones that expired. */
async function deliver(db: SupabaseClient, jobs: { sub: Subscription; msg: PushMessage }[], origin: string): Promise<number> {
  if (!jobs.length) return 0;
  const keys = await vapidKeys(db);
  const subject = subjectFor(origin);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    jobs.map(async ({ sub, msg }) => {
      if (!isPushEndpoint(sub.endpoint)) return;
      try {
        if (await send(sub, msg, keys, subject)) sent++;
        else gone.push(sub.endpoint);
      } catch (e) {
        console.warn("Push failed", e instanceof Error ? e.message : e);
      }
    }),
  );
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);
  return sent;
}

/**
 * Tells every owner whose team wishlisted `playerId` that the player is on
 * the block. Skips silently if the player has left the block meanwhile.
 */
export async function notifyWishlist(db: SupabaseClient, playerId: string, origin: string): Promise<number> {
  const { data: st } = await db.from("auction_state").select("current_player_id, phase").eq("id", 1).maybeSingle();
  if (st?.current_player_id !== playerId || !["spinning", "revealed", "bidding"].includes(st.phase)) return 0;

  const { data: entries } = await db.from("wishlist").select("team_id, priority, max_price").eq("player_id", playerId);
  if (!entries?.length) return 0;
  const { data: player } = await db.from("players").select("id, name, role, base_price").eq("id", playerId).maybeSingle();
  if (!player) return 0;
  const { data: owners } = await db
    .from("owners")
    .select("email, team_id")
    .in(
      "team_id",
      entries.map((e) => e.team_id),
    );
  if (!owners?.length) return 0;
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, email, p256dh, auth")
    .in(
      "email",
      owners.map((o) => o.email),
    );

  const jobs = (subs ?? []).flatMap((sub) => {
    const team = owners.find((o) => o.email === sub.email)?.team_id;
    const entry = entries.find((e) => e.team_id === team);
    if (!entry) return [];
    const limit = entry.max_price !== null ? ` · your max ${money(entry.max_price)}` : "";
    const msg: PushMessage = {
      title: `⭐ ${player.name} is up now`,
      body: `${PRIORITY_LABEL[entry.priority as 1 | 2 | 3]} on your wishlist · ${player.role} · base ${money(player.base_price)}${limit}`,
      tag: `wishlist-${player.id}`,
      url: "/live",
    };
    return [{ sub, msg }];
  });
  return deliver(db, jobs, origin);
}

/** Sends a test notification to every device of one owner. */
export async function sendTestPush(db: SupabaseClient, email: string, origin: string): Promise<number> {
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("email", email);
  const msg: PushMessage = {
    title: "🔔 Notifications are on",
    body: "You'll get an alert like this when a player on your wishlist comes up.",
    tag: "test",
    url: "/wishlist",
  };
  return deliver(
    db,
    (subs ?? []).map((sub) => ({ sub, msg })),
    origin,
  );
}
