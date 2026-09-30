import { NextResponse } from "next/server";
import { jsonError, requireRole } from "@/server/http";
import { REG_BUCKET, registrationSettings } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Private: registrations with short-lived links to photos and receipts.
export async function GET() {
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;
  const db = adminSupabase();
  const { data, error } = await db.from("registrations").select("*").order("created_at", { ascending: false });
  if (error) return jsonError(500, "internal", "Could not load registrations");
  const paths = data.flatMap((r) => [r.photo_path, r.receipt_path].filter(Boolean)) as string[];
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const signed = await db.storage.from(REG_BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return NextResponse.json(
    {
      settings: await registrationSettings(db),
      registrations: data.map((r) => ({
        ...r,
        photo_url: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
        receipt_url: r.receipt_path ? (urls.get(r.receipt_path) ?? null) : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
