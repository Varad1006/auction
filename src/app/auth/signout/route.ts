import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin } from "@/server/http";
import { adminSupabase, sessionSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false }, { status: 403 });
  const supabase = await sessionSupabase();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email) {
    await adminSupabase().from("user_sessions").delete().eq("email", data.user.email.toLowerCase());
  }
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
