import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { Header } from "@/components/Header";
import { SetupNotice } from "@/components/SetupNotice";
import { isConfigured } from "@/lib/env";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

// Hides the admin UI from non-admins. This is a convenience only: every admin
// API call is authorized again on the server.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured) return <SetupNotice />;
  const me = await currentUser().catch(() => null);
  if (!me) {
    return <p className="p-6 text-center text-rose-300">Could not verify your sign-in. Refresh to try again.</p>;
  }
  if (!me.email) redirect("/login?next=/admin");
  if (me.role !== "admin") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-xl font-bold">Admins only</p>
        <p className="text-slate-400">{me.email} is not on the admin list.</p>
        <Link href="/" className="rounded-lg bg-white/10 px-4 py-2 font-semibold">
          Go to the live view
        </Link>
      </main>
    );
  }
  return (
    <>
      <Header />
      <AdminNav />
      <main className="mx-auto max-w-6xl px-4 py-4 pb-16">{children}</main>
    </>
  );
}
