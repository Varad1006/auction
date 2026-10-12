// Shared definition of the registration form: options and validation used by
// both the public form and the /api/register endpoint.
import { z } from "zod";
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

export const PAYEE_PHONE = /^\+?[\d\s-]{10,16}$/;

/** A phone number as typed into a UPI app: the last 10 digits. */
export function upiPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export const PAYMENT_QR_MAX = 4;
export const DECLARATION_MAX = 6000;

export interface RegistrationSettings {
  is_open: boolean;
  title: string;
  intro: string;
  payment_instructions: string;
  receipt_required: boolean;
  availability_question: string;
  availability_options: string[];
  declaration_text: string;
  /** Link to the tournament rulebook, shown with `rulebook_message` at the top of the form. */
  rulebook_url: string | null;
  rulebook_message: string;
  /** QR codes to pay the registration fee. */
  payment_qr: PaymentQr[];
}

export const registrationFields = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s-]{5,19}$/, "Enter a valid phone number"),
  flat_number: z.string().trim().min(1, "Enter your flat number").max(30),
  age: z.coerce.number().int().min(5, "Enter a valid age").max(100, "Enter a valid age"),
  gender: z.enum(["men", "women"], { message: "Choose Male or Female" }),
  role: z.enum(PLAYER_ROLES, { message: "Choose your playing role" }),
  batting_style: z.enum(BATTING_STYLES as [string, ...string[]], { message: "Choose your batting style" }),
  bowling_style: z.enum(BOWLING_STYLES as [string, ...string[]], { message: "Choose your bowling style" }),
  tshirt_size: z.enum(TSHIRT_SIZES as [string, ...string[]], { message: "Choose a T-shirt size" }),
  availability: z.string().trim().min(1, "Tell us your availability").max(300),
  additional_info: z.string().trim().max(500).optional().default(""),
  declaration: z.literal("yes", { message: "Please accept the declaration" }),
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
