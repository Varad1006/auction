import { NextResponse, type NextRequest } from "next/server";
import { aiProvider, backgroundGapFor, batchSizeFor } from "@/server/ai";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { InsightError, writeNotes } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called now and then by owners' and admins' open apps: writes the next few
// missing notes. Requests from every device share one pace (a few a minute
// on Groq's free tier), so extra callers just get told when to come back.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin", "owner"]);
  if ("response" in guard) return guard.response;
  const provider = aiProvider();
  const gap = backgroundGapFor(provider);
  try {
    const result = await writeNotes(adminSupabase(), { size: batchSizeFor(provider), gap });
    return NextResponse.json({ ok: true, data: { ...result, wait: result.remaining > 0 ? Math.max(result.wait ?? gap, 1) : null } });
  } catch (e) {
    const wait = e instanceof InsightError ? Math.max(e.retryAfter ?? gap, 1) : Math.max(gap, 1);
    if (!(e instanceof InsightError)) console.error("Writing notes failed", e);
    return NextResponse.json({ ok: true, data: { status: "busy", written: 0, remaining: null, wait } });
  }
}
