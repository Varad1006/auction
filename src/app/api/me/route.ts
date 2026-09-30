import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await currentUser(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("GET /api/me failed", e);
    return NextResponse.json({ error: "auth_unavailable" }, { status: 503 });
  }
}
