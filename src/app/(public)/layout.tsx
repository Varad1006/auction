import { PublicShell } from "@/components/PublicShell";

// Public pages: no sign-in needed. Signed-in owners also get their bid bar.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
