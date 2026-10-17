import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { POOLS } from "@/lib/types";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { BATCH_SIZE, clearInsights, generateBatch, InsightError } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
// One batch of players per request; the admin page calls it until none remain.
export const maxDuration = 60;

const input = z.object({
  pool: z.enum(POOLS),
  restart: z.boolean().default(false),
  /** Fewer players per request after one ran out of time. */
  size: z.number().int().min(1).max(BATCH_SIZE).optional(),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;
  const body = input.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_input", "Choose a pool");

  const db = adminSupabase();
  try {
    if (body.data.restart) {
      const cleared = await clearInsights(db, body.data.pool);
      await db.from("audit_log").insert({ actor: guard.me.email, action: "clear_insights", details: { pool: body.data.pool, cleared } });
    }
    const result = await generateBatch(db, body.data.pool, body.data.size);
    if (result.generated) {
      await db.from("audit_log").insert({ actor: guard.me.email, action: "generate_insights", details: { pool: body.data.pool, ...result } });
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof InsightError) return jsonError(e.status, e.code, e.message);
    console.error("Generating insights failed", e);
    return jsonError(500, "internal", "Generating notes failed");
  }
}
