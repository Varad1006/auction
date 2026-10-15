import { cn } from "@/lib/format";
import type { Player, Team } from "@/lib/types";

/** Everyone who owns the team: playing owners (players on it) first, then those who don't play. */
export function teamOwnerNames(team: Team, players: Player[]): string[] {
  const playing = players.filter((p) => p.signing === "owner" && p.status === "sold" && p.sold_team_id === team.id).map((p) => p.name);
  return [...playing, ...(team.owner_names ?? [])];
}

/** "Owners: A · B (co-owner)", or nothing when none are set. */
export function TeamOwners({ team, players, className }: { team: Team; players: Player[]; className?: string }) {
  const names = teamOwnerNames(team, players);
  if (names.length === 0) return null;
  return (
    <p className={cn("text-sm", className)}>
      <span className="opacity-75">{names.length > 1 ? "Owners" : "Owner"}:</span> <span className="font-semibold">{names.join(" · ")}</span>
    </p>
  );
}
