import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { filesFromUpload, importStats, InsightError } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD = 15 * 1024 * 1024;

// Uploads previous seasons' stats: the export zip, or all_players.json plus
// the pplN_*_leaderboard.csv files.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError(400, "invalid_input", "Choose the stats zip (or the JSON and CSV files) to upload");
  if (files.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD) return jsonError(413, "too_large", "The upload must be under 15 MB");

  try {
    const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const db = adminSupabase();
    const report = await importStats(db, filesFromUpload(uploads));
    await db.from("audit_log").insert({ actor: guard.me.email, action: "import_stats", details: { matched: report.matched, seasons: report.seasons } });
    return NextResponse.json({ ok: true, data: report });
  } catch (e) {
    if (e instanceof InsightError) return jsonError(e.status, e.code, e.message);
    console.error("Stats import failed", e);
    return jsonError(500, "internal", "Importing the stats failed");
  }
}
