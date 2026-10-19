import { cn, initials } from "@/lib/format";
import type { Player } from "@/lib/types";
import { photoSrc } from "@/lib/photos";


export function PlayerAvatar({ player, className }: { player: Player; className?: string }) {
  return player.photo_url ? (
    <img src={photoSrc(player.photo_url, 640)} alt="" className={cn("object-cover", className)} loading="lazy" />
  ) : (
    <div className={cn("flex items-center justify-center bg-slate-700 font-bold text-slate-200", className)}>
      {initials(player.name)}
    </div>
  );
}
