import { cn, initials, money, textOn } from "@/lib/format";
import { POOL_LABEL, type Player, type Team } from "@/lib/types";

const GRADE_STYLE: Record<string, string> = {
  A: "bg-amber-400 text-amber-950",
  B: "bg-sky-400 text-sky-950",
  C: "bg-slate-300 text-slate-900",
};

export function PlayerAvatar({ player, className }: { player: Player; className?: string }) {
  return player.photo_url ? (
    <img src={player.photo_url} alt="" className={cn("object-cover", className)} loading="lazy" />
  ) : (
    <div className={cn("flex items-center justify-center bg-slate-700 font-bold text-slate-200", className)}>
      {initials(player.name)}
    </div>
  );
}

export function PlayerCard({
  player,
  soldTo,
  unsold,
  reveal,
}: {
  player: Player;
  soldTo?: { team: Team; price: number } | null;
  unsold?: boolean;
  reveal?: boolean;
}) {
  return (
    <article className={cn("relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10", reveal && "reveal")}>
      <div className="flex gap-4 p-4 sm:p-5">
        <PlayerAvatar player={player} className="h-28 w-24 shrink-0 rounded-xl text-3xl sm:h-36 sm:w-32" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={cn("rounded-md px-2 py-0.5", GRADE_STYLE[player.grade])}>Grade {player.grade}</span>
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-200">{POOL_LABEL[player.pool]}</span>
          </div>
          <h2 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{player.name}</h2>
          <p className="mt-1 font-medium text-amber-300">{player.role}</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm text-slate-300 sm:grid-cols-2">
            {player.batting_style && (
              <div>
                <dt className="sr-only">Batting</dt>
                <dd><span className="text-slate-500">Bat</span> {player.batting_style}</dd>
              </div>
            )}
            {player.bowling_style && (
              <div>
                <dt className="sr-only">Bowling</dt>
                <dd><span className="text-slate-500">Bowl</span> {player.bowling_style}</dd>
              </div>
            )}
          </dl>
          <p className="mt-2 text-sm text-slate-400">
            Base price <span className="font-semibold text-slate-100">{money(player.base_price)}</span>
          </p>
        </div>
      </div>
      {player.notes && <p className="border-t border-white/5 px-4 py-3 text-sm text-slate-300 sm:px-5">{player.notes}</p>}
      {soldTo && (
        <div
          className="stamp flex items-center justify-between gap-3 px-4 py-3 font-black uppercase sm:px-5"
          style={{ background: soldTo.team.color, color: textOn(soldTo.team.color) }}
        >
          <span className="tracking-[0.2em]">Sold</span>
          <span className="truncate text-right">
            {soldTo.team.name} · {money(soldTo.price)}
          </span>
        </div>
      )}
      {unsold && (
        <div className="stamp bg-slate-200 px-4 py-3 text-center font-black uppercase tracking-[0.3em] text-slate-900 sm:px-5">
          Unsold
        </div>
      )}
    </article>
  );
}
