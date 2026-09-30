import { RegisterForm } from "@/components/pages/RegisterForm";
import { isConfigured } from "@/lib/env";
import { DEFAULT_SETTINGS, registrationSettings } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player registration" };

export default async function Register() {
  const settings = isConfigured ? await registrationSettings(adminSupabase()).catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  return <RegisterForm settings={settings} />;
}
