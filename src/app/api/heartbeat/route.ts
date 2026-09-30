import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Records that a signed-in user is online (shown on the admin Owners page).
// The identity comes from the verified session, never from the request body.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin", "owner", "viewer"]);
  if ("response" in guard) return guard.response;
  const { me } = guard;
  const { error } = await adminSupabase()
    .from("user_sessions")
    .upsert({
      email: me.email,
      name: me.name,
      avatar_url: me.avatarUrl,
      role: me.role,
      team_id: me.teamId,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      last_seen: new Date().toISOString(),
    });
  if (error) {
    console.error("Heartbeat failed", error);
    return jsonError(500, "internal", "Heartbeat failed");
  }
  return NextResponse.json({ ok: true, me }, { headers: { "Cache-Control": "no-store" } });
}
