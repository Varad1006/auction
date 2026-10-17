import { NextResponse } from "next/server";
import { aiProvider } from "@/server/ai";
import { jsonError, requireRole } from "@/server/http";
import { adminStatus, InsightError, loadInsights } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// AI scouting notes and suggested prices: team owners and admins only.
export async function GET() {
  const guard = await requireRole(["admin", "owner"]);
  if ("response" in guard) return guard.response;
  try {
    const db = adminSupabase();
    const insights = await loadInsights(db);
    const admin = guard.me.role === "admin" ? await adminStatus(db).then((s) => ({ ...s, configured: s.provider !== null })) : null;
    // ai: whether notes get written (owners' apps then ask for missing ones).
    return NextResponse.json({ insights, ai: aiProvider() !== null, admin }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof InsightError) return jsonError(e.status, e.code, e.message);
    return jsonError(500, "internal", "Could not load the notes");
  }
}
