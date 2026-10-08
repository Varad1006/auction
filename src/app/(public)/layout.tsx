import { PublicShell } from "@/components/PublicShell";

// Public pages: no sign-in needed. Signed-in owners also get their wishlist bar.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
