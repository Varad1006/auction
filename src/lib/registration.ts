// Shared definition of the registration form: options and validation used by
// both the public form and the /api/register endpoint.
import { z } from "zod";
import { hasImpossibleDomain, suggestEmail } from "./email-typos";
import { PLAYER_ROLES } from "./types";

export const BATTING_STYLES = ["Right-hand bat", "Left-hand bat"];
export const BOWLING_STYLES = [
  "Right-arm fast",
  "Right-arm medium",
  "Right-arm off-spin",
  "Right-arm leg-spin",
  "Left-arm fast",
  "Left-arm medium",
  "Left-arm orthodox spin",
  "Left-arm wrist spin",
  "Don't bowl",
];
export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const RECEIPT_TYPES = [...PHOTO_TYPES, "application/pdf"];

/** A way to pay the registration fee: a UPI payment link, shown as a QR code. */
export interface PaymentQr {
  label: string;
  /** upi://pay?pa=<UPI ID>&pn=<name>&... exactly as encoded in the payee's QR code. */
  payload: string;
  /** The payee's UPI phone number, shown instead of the UPI ID when set. */
  phone?: string;
}



export const PAYMENT_QR_MAX = 4;
export const DECLARATION_MAX = 6000;
export const FINAL_DECLARATION_MAX = 2000;

export interface RegistrationSettings {
  is_open: boolean;
  title: string;
  intro: string;
  payment_instructions: string;
  receipt_required: boolean;
  availability_question: string;
  availability_options: string[];
  declaration_text: string;
  /** A second agreement shown at the end of the form with its own box ("" = none). */
  final_declaration_text: string;
  /** Link to the tournament rulebook, shown with `rulebook_message` at the top of the form. */
  rulebook_url: string | null;
  rulebook_message: string;
  /** QR codes to pay the registration fee. */
  payment_qr: PaymentQr[];
  /** Spots per pool, first come first served (null = no limit). */
  capacity_men: number | null;
  capacity_women: number | null;
}

export type Gender = "men" | "women";

export function capacityFor(settings: Pick<RegistrationSettings, "capacity_men" | "capacity_women">, gender: Gender): number | null {
  return gender === "men" ? settings.capacity_men : settings.capacity_women;
}

export interface QueueEntry {
  id: string;
  gender: Gender;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  /** Approved onto the players' waitlist rather than into the auction. */
  waitlisted?: boolean;
}

/**
 * Waitlist positions (1 = next in line) for pending registrations beyond a
 * pool's spots. Spots go in submission order; rejected registrations don't
 * take one, so the next person moves up. Approved players always keep their
 * place (an admin may add someone from the waitlist on purpose), and those
 * approved onto the waitlist stay ahead of later registrations in it.
 */
export function waitlistPositions(
  entries: QueueEntry[],
  settings: Pick<RegistrationSettings, "capacity_men" | "capacity_women">,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const gender of ["men", "women"] as const) {
    const cap = capacityFor(settings, gender);
    if (cap === null) continue;
    const queue = entries
      .filter((e) => e.gender === gender && e.status !== "rejected")
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    let position = 0;
    queue.forEach((e, i) => {
      if (e.status === "approved" && e.waitlisted) position++;
      else if (i >= cap && e.status === "pending") out.set(e.id, ++position);
    });
  }
  return out;
}

export type Spots = Partial<Record<Gender, { capacity: number; taken: number }>>;

/** Spots taken (pending + approved) and the limit, per pool. */
export function spotsTaken(entries: Pick<QueueEntry, "gender" | "status">[], gender: Gender): number {
  return entries.filter((e) => e.gender === gender && e.status !== "rejected").length;
}

/**
 * The 10-digit Indian mobile number from what was typed or pasted: spaces
 * and dashes dropped, and a +91 / 91 / 0 prefix removed.
 */
export function normalizeMobile(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+91") || (d.length === 12 && d.startsWith("91"))) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
}

/** As the mobile number field is typed in: digits only, at most 10. */
export function typingMobile(raw: string): string {
  return normalizeMobile(raw).slice(0, 10);
}

/** 98765 43210 */
export function formatMobile(digits: string): string {
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export const AGE_MIN = 18;
export const AGE_MAX = 60;
const AGE_MESSAGE = `Age must be between ${AGE_MIN} and ${AGE_MAX}`;

/** Building-flat, e.g. "b 1203", "B/1203" or "b1203" -> "B-1203". */
export function normalizeFlat(raw: string): string {
  let v = raw
    .trim()
    .toUpperCase()
    .replace(/[\s/_.\\]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  const joined = /^([A-Z]{1,2})(\d{1,5})$/.exec(v);
  if (joined) v = `${joined[1]}-${joined[2]}`;
  return v;
}

/** As the flat number is typed: capitals, digits and one hyphen between parts. */
export function typingFlat(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s/_.\\]+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .slice(0, 10);
}

export const mobileNumber = z
  .string()
  .transform(normalizeMobile)
  .pipe(
    z
      .string()
      .min(1, "Enter your mobile number")
      .length(10, "Mobile number must be exactly 10 digits")
      .regex(/^[6-9]/, "Mobile numbers start with 6, 7, 8 or 9"),
  );

export const registrationFields = z.object({
  full_name: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, "Enter your full name")
        .max(80, "Name is too long")
        .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "Use letters only in your name"),
    ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email"))
    .superRefine((v, ctx) => {
      // Endings like ".con" can never work; other near misses are only suggested in the form.
      if (hasImpossibleDomain(v)) ctx.addIssue({ code: "custom", message: `Check your email: did you mean ${suggestEmail(v)}?` });
    }),
  phone: mobileNumber,
  flat_number: z
    .string()
    .transform(normalizeFlat)
    .pipe(
      z
        .string()
        .min(1, "Enter your flat number")
        .regex(/^[A-Z0-9]{1,4}-[A-Z0-9]{1,5}$/, "Use building number - flat number, e.g. B-1203"),
    ),
  age: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Enter your age in years")
    .transform(Number)
    .pipe(z.number().min(AGE_MIN, AGE_MESSAGE).max(AGE_MAX, AGE_MESSAGE)),
  gender: z.enum(["men", "women"], { message: "Choose Male or Female" }),
  role: z.enum(PLAYER_ROLES, { message: "Choose your playing role" }),
  batting_style: z.enum(BATTING_STYLES as [string, ...string[]], { message: "Choose your batting style" }),
  bowling_style: z.enum(BOWLING_STYLES as [string, ...string[]], { message: "Choose your bowling style" }),
  tshirt_size: z.enum(TSHIRT_SIZES as [string, ...string[]], { message: "Choose a T-shirt size" }),
  availability: z.string().trim().min(1, "Tell us your availability").max(300),
  additional_info: z.string().trim().max(500).optional().default(""),
  declaration: z.literal("yes", { message: "Please accept the Undertaking and Declaration" }),
  // Required by the server when a final agreement is set up.
  final_declaration: z.string().optional().default(""),
});

export type RegistrationInput = z.infer<typeof registrationFields>;

const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,63}$/;

/** UPI ID and payee name from a upi://pay link (null if it isn't one). */
export function parseUpi(payload: string): { upiId: string; name: string } | null {
  if (!/^upi:\/\/pay\?/i.test(payload)) return null;
  const params = new URLSearchParams(payload.slice(payload.indexOf("?") + 1));
  const upiId = params.get("pa")?.trim() ?? "";
  if (!UPI_ID.test(upiId)) return null;
  return { upiId, name: params.get("pn")?.trim() ?? "" };
}

/** A payment QR code ready to show on the form. */
export interface PaymentOption extends PaymentQr {
  upiId: string;
  name: string;
  /** The QR code as an SVG drawn on the server. */
  svg: string;
  /** The same QR code as a large PNG (data URL), for the downloadable image. */
  png: string;
}

/**
 * A minimal UPI payment link for a typed-in UPI ID. The ID is left unencoded,
 * as in app-generated QR codes (some UPI apps don't decode "%40").
 */
export function upiLink(upiId: string, name: string): string {
  const id = encodeURIComponent(upiId.trim()).replace(/%40/g, "@");
  return `upi://pay?pa=${id}${name.trim() ? `&pn=${encodeURIComponent(name.trim())}` : ""}&cu=INR`;
}
