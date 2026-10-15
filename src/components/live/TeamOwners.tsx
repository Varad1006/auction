import { cn } from "@/lib/format";
import { teamOwnerNames } from "@/lib/teams";
import type { Player, Team } from "@/lib/types";

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
