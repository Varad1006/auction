import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The deployment currently live, so open pages can tell when they're out of date. */
export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { "Cache-Control": "no-store" } });
}
