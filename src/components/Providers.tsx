"use client";

import { usePathname } from "next/navigation";
import { LiveProvider } from "./live/LiveProvider";
import { MeProvider } from "./MeProvider";
import { RegisterServiceWorker } from "./RegisterServiceWorker";
import { ToastProvider } from "./Toast";
import { UpdateNotice } from "./UpdateNotice";

// Standalone pages that don't need the signed-in user or the live auction.
// Skipping them keeps a crowd filling in the registration form from using up
// realtime connections.
const STANDALONE = ["/register"];

export function Providers({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const standalone = STANDALONE.some((p) => path === p || path.startsWith(`${p}/`));
  return (
    <ToastProvider>
      {standalone ? (
        children
      ) : (
        <MeProvider>
          <LiveProvider>{children}</LiveProvider>
        </MeProvider>
      )}
      <RegisterServiceWorker />
      <UpdateNotice />
    </ToastProvider>
  );
}
