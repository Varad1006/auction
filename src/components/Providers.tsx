"use client";

import { LiveProvider } from "./live/LiveProvider";
import { MeProvider } from "./MeProvider";
import { RegisterServiceWorker } from "./RegisterServiceWorker";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <MeProvider>
        <LiveProvider>{children}</LiveProvider>
      </MeProvider>
      <RegisterServiceWorker />
    </ToastProvider>
  );
}
