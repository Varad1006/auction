import { NextResponse, type NextRequest } from "next/server";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, RECEIPT_MAX_BYTES, RECEIPT_TYPES, registrationFields } from "@/lib/registration";
import { isSameOrigin, jsonError } from "@/server/http";
import { EXT, REG_BUCKET, registrationSettings, sniffType } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Public registration endpoint (no sign-in). Submissions are stored privately
// as 'pending' until an admin approves them.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "cross_origin", "Cross-site request rejected");
  const db = adminSupabase();
  const settings = await registrationSettings(db);
  if (!settings.is_open) return jsonError(403, "closed", "Registration is closed");

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "bad_form", "Invalid form submission");
  // Honeypot: real people never see or fill this field.
  if (String(form.get("website") ?? "") !== "") return NextResponse.json({ ok: true });

  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const parsed = registrationFields.safeParse(fields);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(400, "invalid_input", issue?.message ?? "Please check the form");
  }
  const input = parsed.data;
  if (settings.availability_options.length > 0) {
    const chosen = input.availability.split(",").map((s) => s.trim());
    if (chosen.some((c) => !settings.availability_options.includes(c))) {
      return jsonError(400, "invalid_input", "Choose your availability from the options");
    }
  }

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return jsonError(400, "photo_required", "Please upload your photo");
  const photoType = await sniffType(photo);
  if (!photoType || !PHOTO_TYPES.includes(photoType)) return jsonError(415, "bad_photo", "Photo must be a JPEG, PNG or WebP image");
  if (photo.size > PHOTO_MAX_BYTES) return jsonError(413, "photo_too_large", "Photo must be under 3 MB");

  const receiptEntry = form.get("receipt");
  const receipt = receiptEntry instanceof File && receiptEntry.size > 0 ? receiptEntry : null;
  if (settings.receipt_required && !receipt) return jsonError(400, "receipt_required", "Please upload your payment receipt");
  let receiptType: string | null = null;
  if (receipt) {
    receiptType = await sniffType(receipt);
    if (!receiptType || !RECEIPT_TYPES.includes(receiptType)) return jsonError(415, "bad_receipt", "Receipt must be an image or PDF");
    if (receipt.size > RECEIPT_MAX_BYTES) return jsonError(413, "receipt_too_large", "Receipt must be under 3 MB");
  }

  const { data: existing } = await db.from("registrations").select("id").eq("email", input.email).maybeSingle();
  if (existing) return jsonError(409, "duplicate", "This email has already registered. Contact the organisers to make changes.");

  const folder = crypto.randomUUID();
  const photoPath = `${folder}/photo.${EXT[photoType]}`;
  const receiptPath = receipt && receiptType ? `${folder}/receipt.${EXT[receiptType]}` : null;
  const storage = db.storage.from(REG_BUCKET);
  const up1 = await storage.upload(photoPath, await photo.arrayBuffer(), { contentType: photoType });
  const up2 =
    receipt && receiptPath && receiptType
      ? await storage.upload(receiptPath, await receipt.arrayBuffer(), { contentType: receiptType })
      : { error: null };
  if (up1.error || up2.error) {
    console.error("Registration upload failed", up1.error ?? up2.error);
    await storage.remove([photoPath, ...(receiptPath ? [receiptPath] : [])]);
    return jsonError(500, "upload_failed", "Upload failed, please try again");
  }

  const { declaration: _declaration, ...row } = input;
  void _declaration;
  const { error } = await db.from("registrations").insert({
    ...row,
    additional_info: row.additional_info || null,
    photo_path: photoPath,
    receipt_path: receiptPath,
    declaration: true,
  });
  if (error) {
    await storage.remove([photoPath, ...(receiptPath ? [receiptPath] : [])]);
    if (error.code === "23505") return jsonError(409, "duplicate", "This email has already registered.");
    console.error("Registration insert failed", error);
    return jsonError(500, "internal", "Could not save your registration, please try again");
  }
  return NextResponse.json({ ok: true });
}
