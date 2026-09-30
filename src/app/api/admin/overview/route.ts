import { NextResponse } from "next/server";
import { jsonError, requireRole } from "@/server/http";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Private admin data: owner mappings and signed-in users.
export async function GET() {
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;
  const db = adminSupabase();
  const [owners, sessions] = await Promise.all([
    db.from("owners").select("*").order("email"),
    db.from("user_sessions").select("*").order("last_seen", { ascending: false }).limit(200),
  ]);
  if (owners.error || sessions.error) {
    console.error("Overview failed", owners.error ?? sessions.error);
    return jsonError(500, "internal", "Could not load admin data");
  }
  return NextResponse.json(
    { owners: owners.data, sessions: sessions.data, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
