-- Row-level security and grants.
--
-- Browsers (anon and authenticated roles) may only READ the public auction
-- tables. They cannot insert, update or delete anything: every write goes
-- through the Next.js API, which checks the caller's role and then uses the
-- service_role key. owners, user_sessions and audit_log are not readable by
-- browsers at all (they contain email addresses).

alter table public.pool_config      enable row level security;
alter table public.teams            enable row level security;
alter table public.team_pool_limits enable row level security;
alter table public.players          enable row level security;
alter table public.auction_state    enable row level security;
alter table public.bids             enable row level security;
alter table public.results          enable row level security;
alter table public.owners           enable row level security;
alter table public.user_sessions    enable row level security;
alter table public.audit_log        enable row level security;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    return; -- not running on Supabase (plain Postgres without the API roles)
  end if;

  foreach t in array array['pool_config', 'teams', 'team_pool_limits', 'players',
                           'auction_state', 'bids', 'results']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  foreach t in array array['owners', 'user_sessions', 'audit_log']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;

  execute 'revoke all on all sequences in schema public from anon, authenticated';
end $$;

-- Realtime: stream changes on the public tables to subscribed clients.
-- Realtime applies the same RLS policies, so owners/user_sessions never leak.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['pool_config', 'teams', 'team_pool_limits', 'players',
                           'auction_state', 'bids', 'results']
  loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Player photos: public-read bucket. Uploads happen server-side with the
-- service role, so no insert/update policies are granted to browsers.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('player-photos', 'player-photos', true, 2097152,
            array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
