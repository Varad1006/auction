import { NextResponse, type NextRequest } from "next/server";
import { resolveRole } from "@/server/auth";
import { sessionSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

function safeNext(next: string | null): string {
  // Only allow same-site relative paths.
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// Google redirects here (via Supabase) with a PKCE code to exchange for a session.
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const supabase = await sessionSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Owners who signed in from the home page land on their team dashboard.
      let to = next;
      if (next === "/") {
        const me = await resolveRole(data.user).catch(() => null);
        if (me?.role === "owner") to = "/wishlist";
      }
      return NextResponse.redirect(new URL(to, url.origin));
    }
    console.error("OAuth code exchange failed", error.message);
  }
  const fail = new URL("/login", url.origin);
  fail.searchParams.set("error", url.searchParams.get("error_description") ?? "Sign-in failed, please try again");
  return NextResponse.redirect(fail);
}
