import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/server/actions";
import { requireRole } from "@/server/http";
import { REG_BUCKET } from "@/server/registration";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every table, with the columns that order its rows (for paging).
const TABLES: Record<string, string[]> = {
  teams: ["id"],
  pool_config: ["pool"],
  team_pool_limits: ["team_id", "pool"],
  players: ["id"],
  auction_state: ["id"],
  bids: ["id"],
  results: ["id"],
  owners: ["email"],
  wishlist: ["team_id", "player_id"],
  push_subscriptions: ["endpoint"],
  user_sessions: ["email"],
  registration_settings: ["id"],
  registrations: ["id"],
  player_insights: ["player_id"],
  past_prices: ["id"],
  ai_status: ["id"],
  app_secrets: ["name"],
  audit_log: ["id"],
};
const PAGE = 1000;

async function dumpTable(db: SupabaseClient, table: string, order: string[]) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select("*");
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}

/** Every file in a bucket, folders included. */
async function listFiles(db: SupabaseClient, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error || !data) return out;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders have no id.
      if (item.id) out.push(path);
      else out.push(...(await listFiles(db, bucket, path)));
    }
    if (data.length < PAGE) return out;
  }
}

// A full copy of the auction's data, for the admin to keep: every table as
// JSON (?part=data), or links to every stored photo and receipt (?part=files)
// that the admin page downloads into a zip. Admin only; the file contains
// private details (emails, phone numbers, receipts), so keep it safe.
export async function GET(req: NextRequest) {
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;
  const db = adminSupabase();
  const headers = { "Cache-Control": "private, no-store" };

  if (req.nextUrl.searchParams.get("part") === "files") {
    const files: { bucket: string; path: string; url: string }[] = [];
    for (const bucket of [PHOTO_BUCKET, REG_BUCKET]) {
      const paths = await listFiles(db, bucket);
      for (let i = 0; i < paths.length; i += 100) {
        const { data } = await db.storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), 3600);
        for (const s of data ?? []) if (s.signedUrl && s.path) files.push({ bucket, path: s.path, url: s.signedUrl });
      }
    }
    return NextResponse.json({ files }, { headers });
  }

  const tables: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  for (const [table, order] of Object.entries(TABLES)) {
    const { rows, error } = await dumpTable(db, table, order);
    tables[table] = rows;
    if (error) errors[table] = error;
  }
  await db.from("audit_log").insert({ actor: guard.me.email, action: "backup", details: { rows: Object.values(tables).reduce((s, r) => s + r.length, 0) } });
  return NextResponse.json({ createdAt: new Date().toISOString(), tables, errors }, { headers });
}
