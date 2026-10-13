import QRCode from "qrcode";
import { RegisterForm } from "@/components/pages/RegisterForm";
import { isConfigured } from "@/lib/env";
import { capacityFor, parseUpi, spotsTaken, type PaymentOption, type RegistrationSettings, type Spots } from "@/lib/registration";
import { DEFAULT_SETTINGS, registrationQueue, registrationSettings } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player registration" };

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
  const settings = isConfigured ? await registrationSettings(adminSupabase()).catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  const spots = isConfigured && settings.is_open ? await spotsLeft(settings) : {};
  return <RegisterForm settings={settings} payments={await paymentOptions(settings)} spots={spots} />;
}
