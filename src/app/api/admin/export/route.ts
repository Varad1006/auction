import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import type { Player, Result, Team } from "@/lib/types";
import { jsonError, requireRole } from "@/server/http";
import { adminSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// GET /api/admin/export?kind=players|results  -> CSV download
export async function GET(req: NextRequest) {
  const guard = await requireRole(["admin"]);
  if ("response" in guard) return guard.response;
  const requested = req.nextUrl.searchParams.get("kind");
  const kind = requested === "results" || requested === "registrations" ? requested : "players";
  const db = adminSupabase();
  if (kind === "registrations") {
    const { data, error } = await db.from("registrations").select("*").order("created_at");
    if (error) return jsonError(500, "internal", "Export failed");
    const csv = toCsv(
      ["Submitted", "Status", "Name", "Email", "Phone", "Flat", "Age", "Gender", "Role", "Batting", "Bowling", "T-shirt", "Availability", "Additional info"],
      data.map((r) => [
        r.created_at, r.status, r.full_name, r.email, r.phone, r.flat_number, r.age, r.gender === "men" ? "Male" : "Female",
        r.role, r.batting_style, r.bowling_style, r.tshirt_size, r.availability, r.additional_info,
      ]),
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="registrations-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const [teamsRes, playersRes, resultsRes] = await Promise.all([
    db.from("teams").select("*"),
    db.from("players").select("*").order("pool").order("name"),
    db.from("results").select("*").order("id"),
  ]);
  if (teamsRes.error || playersRes.error || resultsRes.error) return jsonError(500, "internal", "Export failed");
  const teams = new Map((teamsRes.data as Team[]).map((t) => [t.id, t.name]));
  const players = playersRes.data as Player[];
  const byId = new Map(players.map((p) => [p.id, p]));

  let csv: string;
  if (kind === "players") {
    const sorted = [...players].sort(
      (a, b) =>
        (teams.get(a.sold_team_id ?? "") ?? "~").localeCompare(teams.get(b.sold_team_id ?? "") ?? "~") ||
        a.pool.localeCompare(b.pool) ||
        (b.sold_price ?? 0) - (a.sold_price ?? 0),
    );
    csv = toCsv(
      ["Team", "Player", "Pool", "Role", "Grade", "Batting", "Bowling", "Base price", "Status", "Sold price", "Round", "Notes"],
      sorted.map((p) => [
        p.sold_team_id ? teams.get(p.sold_team_id) : "",
        p.name, p.pool, p.role, p.grade, p.batting_style, p.bowling_style, p.base_price,
        p.status, p.sold_price, p.decided_round, p.notes,
      ]),
    );
  } else {
    csv = toCsv(
      ["#", "Time", "Player", "Pool", "Round", "Outcome", "Team", "Price", "Method", "Undone at"],
      (resultsRes.data as Result[]).map((r) => [
        r.id, r.created_at, byId.get(r.player_id)?.name ?? r.player_id, r.pool, r.round, r.outcome,
        r.team_id ? teams.get(r.team_id) : "", r.price, r.method, r.undone_at,
      ]),
    );
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auction-${kind}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
