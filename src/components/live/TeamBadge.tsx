import { cn, textOn } from "@/lib/format";
import type { Team } from "@/lib/types";

export function TeamBadge({ team, className, full }: { team: Team; className?: string; full?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold", className)}
      style={{ background: team.color, color: textOn(team.color) }}
    >
      {full ? team.name : team.short_name}
    </span>
  );
}
