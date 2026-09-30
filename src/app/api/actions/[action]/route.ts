import { NextResponse, type NextRequest } from "next/server";
import { ActionError, actions, type ActionName } from "@/server/actions";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action: name } = await params;
  if (!Object.hasOwn(actions, name)) return jsonError(404, "unknown_action", "Unknown action");
  const def = actions[name as ActionName];

  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return jsonError(415, "bad_content_type", "Expected JSON");
  }

  // Authorization happens here, on the server, for every action.
  const guard = await requireRole(def.roles);
  if ("response" in guard) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_json", "Invalid JSON body");
  }
  const parsed = def.input.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(400, "invalid_input", issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input");
  }

  try {
    // The union of all action inputs collapses to never here; each def's
    // input schema has just validated the value for its own run().
    const run = def.run as (ctx: Parameters<typeof def.run>[0], input: unknown) => Promise<unknown>;
    const data = await run({ me: guard.me, db: adminSupabase() }, parsed.data);
    return NextResponse.json({ ok: true, data: data ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ActionError) return jsonError(e.status, e.code, e.message);
    console.error(`Action ${name} failed`, e);
    return jsonError(500, "internal", "Something went wrong");
  }
}
