import QRCode from "qrcode";
import { RegisterForm } from "@/components/pages/RegisterForm";
import { isConfigured } from "@/lib/env";
import { parseUpi, type PaymentOption, type RegistrationSettings } from "@/lib/registration";
import { DEFAULT_SETTINGS, registrationSettings } from "@/server/registration";
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
    out.push({ ...q, ...upi, svg });
  }
  return out;
}

export default async function Register() {
  const settings = isConfigured ? await registrationSettings(adminSupabase()).catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  return <RegisterForm settings={settings} payments={await paymentOptions(settings)} />;
}
