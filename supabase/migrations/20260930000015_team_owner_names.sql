-- Names of a team's owners who don't play, shown on the team pages next to
-- the playing owners (who are players on the team). Display only: they
-- don't affect the purse or the squad. Safe to run more than once.

alter table public.teams
  add column if not exists owner_names text[] not null default '{}';

alter table public.teams drop constraint if exists teams_owner_names_check;
alter table public.teams
  add constraint teams_owner_names_check check (cardinality(owner_names) <= 6);
