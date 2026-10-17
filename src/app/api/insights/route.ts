import { NextResponse } from "next/server";
import { jsonError, requireRole } from "@/server/http";
import { aiConfigured, AI_MODEL, BATCH_SIZE, InsightError, loadInsights } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// AI scouting notes and suggested prices: team owners and admins only.
export async function GET() {
  const guard = await requireRole(["admin", "owner"]);
  if ("response" in guard) return guard.response;
  try {
    const insights = await loadInsights(adminSupabase());
    const admin = guard.me.role === "admin" ? { configured: aiConfigured(), model: AI_MODEL, batchSize: BATCH_SIZE } : null;
    return NextResponse.json({ insights, admin }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof InsightError) return jsonError(e.status, e.code, e.message);
    return jsonError(500, "internal", "Could not load the notes");
  }
}
