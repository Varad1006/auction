import type { Metadata } from "next";
import QRCode from "qrcode";
import { cache } from "react";
import { RegisterForm } from "@/components/pages/RegisterForm";
import { APP_DESCRIPTION, isConfigured } from "@/lib/env";
import { capacityFor, parseUpi, spotsTaken, type PaymentOption, type RegistrationSettings, type Spots } from "@/lib/registration";
import { DEFAULT_SETTINGS, registrationQueue, registrationSettings } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// Loaded once per request for both the link preview and the page.
const loadSettings = cache(() =>
  isConfigured ? registrationSettings(adminSupabase()).catch(() => DEFAULT_SETTINGS) : Promise.resolve(DEFAULT_SETTINGS),
);

// A shared /register link previews with the form's own title.
export async function generateMetadata(): Promise<Metadata> {
  const { title } = await loadSettings();
  return { title: { absolute: title }, openGraph: { title, description: APP_DESCRIPTION } };
}

/** Draws each payment QR code as a crisp SVG from its UPI link. */
async function paymentOptions(settings: RegistrationSettings): Promise<PaymentOption[]> {
  const out: PaymentOption[] = [];
  for (const q of settings.payment_qr ?? []) {
    const upi = parseUpi(q.payload);
    if (!upi) continue;
    const svg = await QRCode.toString(q.payload, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
    const png = await QRCode.toDataURL(q.payload, { width: 720, margin: 2, errorCorrectionLevel: "M" });
    out.push({ ...q, ...upi, svg, png });
  }
  return out;
}

/** Spots left per pool (counts only), when the organisers set a limit. */
async function spotsLeft(settings: RegistrationSettings): Promise<Spots> {
  if (settings.capacity_men === null && settings.capacity_women === null) return {};
  const queue = await registrationQueue(adminSupabase()).catch(() => null);
  if (!queue) return {};
  const out: Spots = {};
  for (const g of ["men", "women"] as const) {
    const capacity = capacityFor(settings, g);
    if (capacity !== null) out[g] = { capacity, taken: spotsTaken(queue, g) };
  }
  return out;
}

export default async function Register() {
  const settings = await loadSettings();
  const spots = isConfigured && settings.is_open ? await spotsLeft(settings) : {};
  return <RegisterForm settings={settings} payments={await paymentOptions(settings)} spots={spots} />;
}
