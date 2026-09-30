import "server-only";

import type { User } from "@supabase/supabase-js";
import type { Me } from "@/lib/types";
import { adminSupabase, sessionSupabase } from "./supabase";

export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function signedInWithGoogle(user: User): boolean {
  return user.app_metadata?.provider === "google" || (user.identities ?? []).some((i) => i.provider === "google");
}

const VIEWER: Me = { role: "viewer", email: null, name: null, avatarUrl: null, teamId: null };

/** Resolves a verified Supabase user to admin / owner / viewer. */
export async function resolveRole(user: User | null): Promise<Me> {
  if (!user?.email) return VIEWER;
  const email = user.email.toLowerCase();
  const base = {
    email,
    name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
  // Only Google sign-ins are trusted for elevated roles.
  if (!signedInWithGoogle(user)) return { ...base, role: "viewer", teamId: null, notGoogle: true };
  if (adminEmails().has(email)) return { ...base, role: "admin", teamId: null };

  const { data, error } = await adminSupabase().from("owners").select("team_id").eq("email", email).maybeSingle();
  if (error) throw new Error(`Owner lookup failed: ${error.message}`);
  if (data) return { ...base, role: "owner", teamId: data.team_id as string };
  return { ...base, role: "viewer", teamId: null };
}

/**
 * The current caller, verified against Supabase Auth (getUser() validates the
 * access token with the auth server; cookie contents alone are not trusted).
 */
export async function currentUser(): Promise<Me> {
  const supabase = await sessionSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return VIEWER;
  return resolveRole(data.user);
}
