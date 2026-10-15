import type { Player, Team } from "./types";

/** "Nikhil Dhane (co-owner)" and "nikhil  dhane" are the same person. */
export function ownerKey(name: string): string {
  return name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Players on the team as playing owners. */
export function playingOwners(team: Pick<Team, "id">, players: Player[]): Player[] {
  return players.filter((p) => p.signing === "owner" && p.status === "sold" && p.sold_team_id === team.id);
}

/**
 * Everyone who owns the team, as shown on the team pages. Names typed in
 * Settings come in the order typed; a playing owner written there (e.g. to
 * add "(co-owner)" or fix capitals) shows that way instead of twice. Playing
 * owners not mentioned there come first.
 */
export function teamOwnerNames(team: Pick<Team, "id" | "owner_names">, players: Player[]): string[] {
  const typed = team.owner_names ?? [];
  const typedKeys = new Set(typed.map(ownerKey));
  const unmentioned = playingOwners(team, players)
    .map((p) => p.name)
    .filter((n) => !typedKeys.has(ownerKey(n)));
  const seen = new Set<string>();
  return [...unmentioned, ...typed].filter((n) => {
    const k = ownerKey(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Names typed in Settings that aren't this team's playing owners. */
export function nonPlayingOwnerNames(team: Pick<Team, "id" | "owner_names">, players: Player[]): string[] {
  const playing = new Set(playingOwners(team, players).map((p) => ownerKey(p.name)));
  return (team.owner_names ?? []).filter((n) => !playing.has(ownerKey(n)));
}

/** Typed names that belong to another team's playing owner (a likely mix-up). */
export function ownersOfOtherTeams(teamId: string, names: string[], players: Player[], teams: Team[]): { name: string; team: string }[] {
  return names.flatMap((name) => {
    const p = players.find((x) => x.signing === "owner" && x.status === "sold" && x.sold_team_id !== teamId && ownerKey(x.name) === ownerKey(name));
    const other = p && teams.find((t) => t.id === p.sold_team_id);
    return other ? [{ name, team: other.name }] : [];
  });
}
