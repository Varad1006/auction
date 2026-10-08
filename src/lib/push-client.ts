"use client";

// Browser side of Web Push: subscribes this device and registers it with
// the server. iPhones only support push for the installed (home screen) app.

import { callAction } from "./api";
import { isIOS, isStandalone } from "./platform";

export type PushStatus = "unsupported" | "needs-install" | "denied" | "off" | "on";

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  // The service worker is only registered in production builds.
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? navigator.serviceWorker.ready : null;
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

async function register(sub: PushSubscription) {
  const json = sub.toJSON();
  await callAction("push.subscribe", {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  });
}

/** Asks for permission (must be called from a tap) and subscribes. */
export async function enablePush(vapidPublicKey: string): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration();
  if (!reg) return "unsupported";
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, vapidPublicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  try {
    sub ??= await Promise.race([
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the push service didn't answer")), 20_000)),
    ]);
  } catch (e) {
    // E.g. private/incognito windows, or a browser without a push service.
    throw new Error(`This browser couldn't set up notifications (${e instanceof Error ? e.message : "unknown error"}).`);
  }
  await register(sub);
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await callAction("push.unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}

/**
 * Re-sends this device's existing subscription so the server has it even
 * after an owner remap or a key change. No prompt, no-op when push is off.
 */
export async function syncPush(vapidPublicKey: string): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  if (sameKey(sub, vapidPublicKey)) await register(sub);
  else await enablePush(vapidPublicKey);
}
