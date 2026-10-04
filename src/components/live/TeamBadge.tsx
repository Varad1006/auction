import { cn, textOn } from "@/lib/format";
import type { Team } from "@/lib/types";

export function TeamBadge({ team, className }: { team: Team; className?: string }) {
  return (
    <span
      className={cn("inline-block max-w-[11rem] truncate rounded-md px-2 py-0.5 align-middle text-xs font-bold", className)}
      style={{ background: team.color, color: textOn(team.color) }}
    >
      {team.name}
    </span>
  );
}
