import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { InsightError, writeNotes } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const input = z.object({ playerId: z.uuid() });

// An owner opened or starred a player without an AI note: write it now. The
// note is saved for everyone; a player who already has one costs nothing.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin", "owner"]);
  if ("response" in guard) return guard.response;
  const body = input.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_input", "Choose a player");
  try {
    const result = await writeNotes(adminSupabase(), { ids: [body.data.playerId], size: 1, gap: 0, timeoutMs: 40_000 });
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    // Owners just see the price guide until a later try works.
    const wait = e instanceof InsightError ? (e.retryAfter ?? 30) : 30;
    if (!(e instanceof InsightError)) console.error("Writing a note failed", e);
    return NextResponse.json({ ok: true, data: { status: "busy", written: 0, remaining: null, wait } });
  }
}
