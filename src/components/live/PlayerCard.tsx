import { cn, initials } from "@/lib/format";
import type { Player } from "@/lib/types";


export function PlayerAvatar({ player, className }: { player: Player; className?: string }) {
  return player.photo_url ? (
    <img src={player.photo_url} alt="" className={cn("object-cover", className)} loading="lazy" />
  ) : (
    <div className={cn("flex items-center justify-center bg-slate-700 font-bold text-slate-200", className)}>
      {initials(player.name)}
    </div>
  );
}
