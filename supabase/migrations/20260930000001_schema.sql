-- Core schema for the cricket auction.
--
-- Money is stored as integer "points". Remaining purse and squad counts are
-- never stored: they are always derived from sold players, so they cannot
-- drift out of sync with the results log.

create type public.pool_kind as enum ('men', 'women');
create type public.player_grade as enum ('A', 'B', 'C');
create type public.player_role as enum ('Batter', 'Bowler', 'All-rounder', 'Wicket-keeper');
create type public.player_status as enum ('pool', 'sold', 'unsold');
-- idle      : nobody on the block
-- spinning  : wheel picked a player, clients are animating the spin
-- revealed  : player on the block (picked manually), bidding not yet open
-- bidding   : bids accepted
-- sold/unsold: last player decided, block is free for the next spin
create type public.auction_phase as enum ('idle', 'spinning', 'revealed', 'bidding', 'sold', 'unsold');
create type public.result_outcome as enum ('sold', 'unsold');

-- Per-pool configuration (one row for men, one for women).
create table public.pool_config (
  pool            public.pool_kind primary key,
  label           text not null,
  purse           integer not null check (purse >= 0),
  min_squad       integer not null check (min_squad >= 0),
  max_squad       integer not null check (max_squad >= 1 and max_squad >= min_squad),
  base_price_a    integer not null check (base_price_a >= 0),
  base_price_b    integer not null check (base_price_b >= 0),
  base_price_c    integer not null check (base_price_c >= 0),
  -- Ordered list of {"from": amount, "step": increment}. The step used is the
  -- one with the largest "from" that is <= the current bid.
  increment_tiers jsonb not null default '[{"from": 0, "step": 5}]'::jsonb
                  check (jsonb_typeof(increment_tiers) = 'array' and jsonb_array_length(increment_tiers) > 0),
  current_round   integer not null default 1 check (current_round >= 1),
  updated_at      timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(name) between 1 and 40),
  short_name  text not null check (char_length(short_name) between 1 and 5),
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Optional per-team overrides of the pool defaults (null = use pool_config).
create table public.team_pool_limits (
  team_id    uuid not null references public.teams (id) on delete cascade,
  pool       public.pool_kind not null,
  purse      integer check (purse >= 0),
  min_squad  integer check (min_squad >= 0),
  max_squad  integer check (max_squad >= 1),
  primary key (team_id, pool)
);

create table public.players (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 80),
  pool           public.pool_kind not null,
  role           public.player_role not null,
  batting_style  text check (char_length(batting_style) <= 40),
  bowling_style  text check (char_length(bowling_style) <= 40),
  grade          public.player_grade not null,
  base_price     integer not null check (base_price >= 0),
  photo_url      text,
  notes          text check (char_length(notes) <= 500),
  status         public.player_status not null default 'pool',
  sold_team_id   uuid references public.teams (id) on delete restrict,
  sold_price     integer check (sold_price >= 0),
  decided_round  integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint sold_fields_consistent check (
    (status = 'sold') = (sold_team_id is not null and sold_price is not null)
  )
);
create index players_pool_status_idx on public.players (pool, status);
create index players_sold_team_idx on public.players (sold_team_id) where status = 'sold';

-- Single-row table holding the live auction. Every write goes through the
-- auction_* functions, which lock this row first, so all state transitions
-- (bids, sells, undo) are serialized.
create table public.auction_state (
  id                 smallint primary key default 1 check (id = 1),
  current_pool       public.pool_kind not null default 'men',
  phase              public.auction_phase not null default 'idle',
  current_player_id  uuid references public.players (id) on delete set null,
  current_bid        integer,
  leading_team_id    uuid references public.teams (id) on delete set null,
  bid_count          integer not null default 0,
  spin_candidates    uuid[],
  spin_started_at    timestamptz,
  spin_duration_ms   integer not null default 6000,
  last_result_id     bigint,
  version            bigint not null default 0,
  updated_at         timestamptz not null default now()
);

create table public.bids (
  id              bigint generated always as identity primary key,
  player_id       uuid not null references public.players (id) on delete cascade,
  pool            public.pool_kind not null,
  round           integer not null,
  team_id         uuid not null references public.teams (id) on delete cascade,
  amount          integer not null check (amount >= 0),
  placed_by_role  text not null check (placed_by_role in ('owner', 'admin')),
  created_at      timestamptz not null default clock_timestamp(),
  voided_at       timestamptz
);
create index bids_player_round_idx on public.bids (player_id, round, id);

-- Permanent results log. Undo marks a row undone; rows are never deleted
-- (except when the player itself is deleted).
create table public.results (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references public.players (id) on delete cascade,
  pool        public.pool_kind not null,
  round       integer not null,
  outcome     public.result_outcome not null,
  team_id     uuid references public.teams (id) on delete set null,
  price       integer,
  method      text not null default 'auction' check (method in ('auction', 'manual')),
  created_at  timestamptz not null default clock_timestamp(),
  undone_at   timestamptz
);
create index results_active_idx on public.results (id desc) where undone_at is null;

-- Owner email -> team mapping, maintained by admins. Private (no public read).
create table public.owners (
  email       text primary key check (email = lower(email) and email like '%_@_%'),
  team_id     uuid not null references public.teams (id) on delete cascade,
  label       text check (char_length(label) <= 60),
  created_at  timestamptz not null default now()
);

-- Signed-in users, refreshed by a server-side heartbeat. Private.
create table public.user_sessions (
  email       text primary key,
  name        text,
  avatar_url  text,
  role        text not null check (role in ('admin', 'owner', 'viewer')),
  team_id     uuid references public.teams (id) on delete set null,
  user_agent  text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- Who did what. Private; keeps emails out of the public bid/result tables.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor       text not null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default clock_timestamp()
);

-- Bump version on every auction_state change so clients can drop stale
-- realtime payloads that arrive out of order.
create function public.tg_auction_state_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create trigger auction_state_version
  before update on public.auction_state
  for each row execute function public.tg_auction_state_version();

create function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger players_touch before update on public.players
  for each row execute function public.tg_touch_updated_at();
create trigger pool_config_touch before update on public.pool_config
  for each row execute function public.tg_touch_updated_at();

-- Every team gets a limits row for each pool.
create function public.tg_team_limits() returns trigger
language plpgsql as $$
begin
  insert into public.team_pool_limits (team_id, pool)
  select new.id, p from unnest(enum_range(null::public.pool_kind)) p
  on conflict do nothing;
  return new;
end $$;

create trigger teams_create_limits after insert on public.teams
  for each row execute function public.tg_team_limits();
