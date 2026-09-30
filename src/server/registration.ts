import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationSettings } from "@/lib/registration";

export const REG_BUCKET = "registrations";

export const DEFAULT_SETTINGS: RegistrationSettings = {
  is_open: false,
  title: "Player registration",
  intro: "",
  payment_instructions: "",
  receipt_required: true,
  availability_question: "Availability",
  availability_options: [],
  declaration_text: "I confirm the details above are correct and I will follow the tournament rules.",
};

export async function registrationSettings(db: SupabaseClient): Promise<RegistrationSettings> {
  const { data } = await db.from("registration_settings").select("*").eq("id", 1).maybeSingle();
  return data ? (data as RegistrationSettings) : DEFAULT_SETTINGS;
}

/** Checks a file's first bytes, so a renamed file can't pose as an image/PDF. */
export async function sniffType(file: File): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (String.fromCharCode(...b.slice(0, 4)) === "%PDF") return "application/pdf";
  return null;
}

export const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
