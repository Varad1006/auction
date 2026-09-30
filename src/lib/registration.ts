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

export interface RegistrationSettings {
  is_open: boolean;
  title: string;
  intro: string;
  payment_instructions: string;
  receipt_required: boolean;
  availability_question: string;
  availability_options: string[];
  declaration_text: string;
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
