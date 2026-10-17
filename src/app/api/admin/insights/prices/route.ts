import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { importPrices, InsightError } from "@/server/insights";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Uploads one previous auction's prices: the tracker sheet downloaded as
// .xlsx or .csv. Uploading a season again replaces it.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const season = Number(form?.get("season"));
  const file = form?.get("file");
  if (!Number.isInteger(season) || season < 1 || season > 99) return jsonError(400, "invalid_input", "Choose which season the prices are from");
  if (!(file instanceof File)) return jsonError(400, "invalid_input", "Choose the price list to upload");

  try {
    const db = adminSupabase();
    const report = await importPrices(db, season, { name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    await db.from("audit_log").insert({ actor: guard.me.email, action: "import_prices", details: { season, players: report.players, sold: report.sold } });
    return NextResponse.json({ ok: true, data: report });
  } catch (e) {
    if (e instanceof InsightError) return jsonError(e.status, e.code, e.message);
    console.error("Price import failed", e);
    return jsonError(500, "internal", "Importing the prices failed");
  }
}
