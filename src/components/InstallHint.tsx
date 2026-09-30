"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "auction:install-hint";

function platform(): "ios" | "ios-inapp" | "other" | "installed" {
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!ios) return "other";
  // In-app browsers (WhatsApp, Instagram, Facebook...) can't add to home screen.
  return /FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua) ? "ios-inapp" : "ios";
}

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "dismissed";
  } catch {
    return false;
  }
}

/**
 * Explains how to install the app. iOS has no install prompt, so iPhone users
 * get Share -> Add to Home Screen steps; Android/desktop Chrome get a button.
 */
export function InstallHint() {
  const kind = useSyncExternalStore(
    () => () => {},
    () => platform(),
    () => "installed" as const,
  );
  const [hidden, setHidden] = useState(() => typeof window !== "undefined" && dismissed());
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const close = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(KEY, "dismissed");
    } catch {
      // Storage unavailable: hidden for this visit only.
    }
  };

  if (hidden || kind === "installed" || (kind === "other" && !prompt)) return null;

  return (
    <div className="mx-auto mt-3 max-w-6xl px-4">
      <div className="flex items-start gap-3 rounded-xl bg-amber-400/10 p-3 text-sm ring-1 ring-amber-400/30">
        <img src="/icons/icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-100">Install the auction app</p>
          {kind === "ios" && (
            <p className="mt-0.5 text-amber-200/80">
              Tap <b>Share</b> <span aria-hidden>(□↑)</span> then <b>Add to Home Screen</b>. It opens full-screen, like an app.
            </p>
          )}
          {kind === "ios-inapp" && (
            <p className="mt-0.5 text-amber-200/80">
              Open this page in <b>Safari</b> first (tap <b>⋯</b> → <b>Open in Safari</b>), then Share → <b>Add to Home Screen</b>.
            </p>
          )}
          {kind === "other" && prompt && (
            <button
              onClick={async () => {
                await prompt.prompt();
                await prompt.userChoice.catch(() => null);
                setPrompt(null);
              }}
              className="mt-1.5 rounded-lg bg-amber-400 px-3 py-1.5 font-semibold text-amber-950"
            >
              Install app
            </button>
          )}
        </div>
        <button onClick={close} aria-label="Dismiss" className="rounded-md px-2 text-lg leading-none text-amber-200/70 hover:bg-white/10">
          ×
        </button>
      </div>
    </div>
  );
}
