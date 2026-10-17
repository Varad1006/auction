-- AI scouting notes and suggested prices, one row per player.
--
-- The admin uploads previous seasons' stats (stored in stats), then the
-- server asks Claude for a short scouting note and a price range per player.
-- Private: only the server reads it (served to team owners and admins).
-- Safe to run more than once.

create table if not exists public.player_insights (
  player_id      uuid primary key references public.players (id) on delete cascade,
  stats          jsonb not null default '{}'::jsonb,
  cricheroes_url text check (char_length(cricheroes_url) <= 300),
  imported_at    timestamptz not null default now(),
  summary        text check (char_length(summary) <= 600),
  strengths      text[] not null default '{}',
  concerns       text[] not null default '{}',
  role_fit       text check (char_length(role_fit) <= 200),
  tier           text check (tier in ('marquee', 'premium', 'solid', 'value', 'unknown')),
  price_floor    integer check (price_floor >= 0),
  price_fair     integer check (price_fair >= 0),
  price_stretch  integer check (price_stretch >= 0),
  confidence     text check (confidence in ('high', 'medium', 'low')),
  generated_at   timestamptz,
  model          text
);

alter table public.player_insights enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.player_insights from anon, authenticated;
  end if;
end $$;
