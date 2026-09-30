import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { Me, Role } from "@/lib/types";
import { currentUser } from "./auth";

/**
 * Rejects cross-site requests to state-changing endpoints. Auth cookies are
 * SameSite=Lax already; this is a second layer.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

type Guarded = { me: Me & { email: string } } | { response: NextResponse };

/** Resolves the caller and checks their role. */
export async function requireRole(roles: Role[]): Promise<Guarded> {
  let me: Me;
  try {
    me = await currentUser();
  } catch (e) {
    console.error("Role resolution failed", e);
    return { response: jsonError(503, "auth_unavailable", "Could not verify your sign-in, try again") };
  }
  if (!roles.includes(me.role) || !me.email) {
    return me.email
      ? { response: jsonError(403, "forbidden", "You don't have permission to do that") }
      : { response: jsonError(401, "signed_out", "Sign in first") };
  }
  return { me: me as Me & { email: string } };
}
