import { NextResponse } from "next/server";
import { jsonError, requireRole } from "@/server/http";
import { vapidKeys } from "@/server/push";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

/** The signed-in owner's team wishlist (never another team's). */
export async function GET() {
  const guard = await requireRole(["owner"]);
  if ("response" in guard) return guard.response;
  const teamId = guard.me.teamId;
  if (!teamId) return jsonError(403, "no_team", "Your account isn't linked to a team");
  const db = adminSupabase();
  const { data, error } = await db
    .from("wishlist")
    .select("player_id, priority, max_price, note, created_at, updated_at")
    .eq("team_id", teamId)
    .order("created_at");
  if (error) {
    console.error("GET /api/wishlist failed", error);
    return jsonError(500, "db_error", "Could not load the wishlist");
  }
  const publicKey = await vapidKeys(db)
    .then((k) => k.publicKey)
    .catch((e) => {
      console.error("Push keys unavailable", e);
      return null;
    });
  return NextResponse.json({ teamId, entries: data, vapidPublicKey: publicKey }, { headers: { "Cache-Control": "no-store" } });
}
