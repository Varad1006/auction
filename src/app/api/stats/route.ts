import { NextResponse } from "next/server";
import { jsonError } from "@/server/http";
import { loadPublicStats } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Players' CricHeroes careers and PPL 1-2 performances: public, for every
// visitor. Stats only; prices and AI notes stay with owners (/api/insights).
export async function GET() {
  try {
    const stats = await loadPublicStats(adminSupabase());
    return NextResponse.json({ stats }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return jsonError(500, "internal", "Could not load the stats");
  }
}
