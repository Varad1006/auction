-- Previous auctions' prices, uploaded by the admin from the organisers'
-- tracker sheets (name, pool, team and price only), and the calculated price
-- guide behind each player's suggested prices.
--
-- Private: only the server reads them. Safe to run more than once.

create table if not exists public.past_prices (
  id     bigint generated always as identity primary key,
  season integer not null check (season between 1 and 99),
  pool   public.pool_kind not null,
  name   text not null check (char_length(name) between 1 and 120),
  team   text check (char_length(team) <= 80),
  -- 0 = not sold in that auction (owner, icon player or unsold).
  price  integer not null check (price >= 0)
);

create index if not exists past_prices_season on public.past_prices (season);

alter table public.past_prices enable row level security;

alter table public.player_insights add column if not exists valuation jsonb;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.past_prices from anon, authenticated;
  end if;
end $$;
