import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PHOTO_BUCKET, removeStoredPhoto } from "@/server/actions";
import { isSameOrigin, jsonError, requireRole } from "@/server/http";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Uploads a player photo (the browser resizes it first) and stores its URL.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const playerId = z.uuid().safeParse(form?.get("playerId"));
  const file = form?.get("file");
  if (!playerId.success || !(file instanceof File)) return jsonError(400, "invalid_input", "playerId and file are required");
  const ext = TYPES[file.type];
  if (!ext) return jsonError(415, "bad_type", "Use a JPEG, PNG or WebP image");
  if (file.size > MAX_BYTES) return jsonError(413, "too_large", "Image must be under 2 MB");

  const db = adminSupabase();
  const { data: player } = await db.from("players").select("id, photo_url").eq("id", playerId.data).maybeSingle();
  if (!player) return jsonError(404, "not_found", "Player not found");

  const path = `${player.id}/${Date.now()}.${ext}`;
  const upload = await db.storage
    .from(PHOTO_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (upload.error) {
    console.error("Photo upload failed", upload.error);
    return jsonError(500, "upload_failed", "Upload failed");
  }
  const url = db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await db.from("players").update({ photo_url: url }).eq("id", player.id);
  if (error) {
    await db.storage.from(PHOTO_BUCKET).remove([path]);
    return jsonError(500, "internal", "Could not save photo");
  }
  await removeStoredPhoto(db, player.photo_url);
  await db.from("audit_log").insert({ actor: guard.me.email, action: "upload_photo", details: { player_id: player.id } });
  return NextResponse.json({ ok: true, data: { photo_url: url } });
}
