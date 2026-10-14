-- Playing owners and star players.
--
-- Each team's owner(s) and one star player join the team outside the
-- auction. Their price (set by the admin, and changeable at any time) comes
-- out of the team's purse like any purchase, but they don't count towards
-- the squad limits: min/max squad are about the players a team buys in the
-- auction. They aren't auction results either, so they never appear among
-- the results, can't be undone with "Undo", and a reset leaves them on
-- their teams.
-- Safe to run more than once. Function bodies fill variables with
-- "x := (select ...)" so the Supabase SQL Editor doesn't mistake them for
-- new tables (see 20260930000013).

alter table public.players
  add column if not exists signing text check (signing in ('owner', 'star'));

alter table public.players drop constraint if exists signing_needs_team;
alter table public.players
  add constraint signing_needs_team check (signing is null or status = 'sold');

-- One star player per team.
create unique index if not exists players_one_star_per_team
  on public.players (sold_team_id) where signing = 'star';

-- Purse spent counts everyone on the team; the squad count only players
-- bought in the auction (or assigned in their place).
create or replace function public.team_pool_status(p_team uuid, p_pool public.pool_kind)
returns table (purse integer, min_squad integer, max_squad integer, spent integer, squad_count integer)
language sql stable as $$
  select coalesce(l.purse, c.purse),
         coalesce(l.min_squad, c.min_squad),
         coalesce(l.max_squad, c.max_squad),
         coalesce((select sum(p.sold_price) from public.players p
                    where p.sold_team_id = t.id and p.pool = p_pool and p.status = 'sold'), 0)::integer,
         (select count(*) from public.players p
           where p.sold_team_id = t.id and p.pool = p_pool and p.status = 'sold' and p.signing is null)::integer
    from public.teams t
    join public.pool_config c on c.pool = p_pool
    left join public.team_pool_limits l on l.team_id = t.id and l.pool = p_pool
   where t.id = p_team
$$;

-- Puts a player on a team as an owner or its star player at p_price, or
-- changes the team, role or price of one already signed. A player who was
-- assigned by hand can become one (their manual result is
-- removed); a player bought in the auction can't.
create or replace function public.admin_sign_player(
  p_actor text, p_player_id uuid, p_team_id uuid, p_signing text, p_price integer)
returns public.players language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
  t public.teams;
  v_star text;
  v_purse integer;
  v_spent integer;
  v_remaining integer;
  v_was_signing text;
begin
  s := public.auction_lock();
  if p_signing is null or p_signing not in ('owner', 'star') then
    perform public.auction_fail('bad_signing', 'Choose owner or star player');
  end if;
  if p_price is null or p_price < 0 then
    perform public.auction_fail('bad_price', 'Price must be zero or more');
  end if;
  pl := (select x from public.players x where x.id = p_player_id for update);
  if pl.id is null then
    perform public.auction_fail('not_found', 'Player not found');
  end if;
  t := (select x from public.teams x where x.id = p_team_id);
  if t.id is null then
    perform public.auction_fail('invalid_team', 'Unknown team');
  end if;
  if s.current_player_id = pl.id and s.phase in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('on_block', 'Player is on the block: return them to the pool first');
  end if;
  if pl.status = 'sold' and pl.signing is null and exists (
      select 1 from public.results r where r.player_id = pl.id and r.undone_at is null and r.method = 'auction') then
    perform public.auction_fail('sold_in_auction',
      format('%s was bought in the auction: undo that sale first', pl.name));
  end if;
  if p_signing = 'star' then
    v_star := (select x.name from public.players x
                where x.sold_team_id = p_team_id and x.signing = 'star' and x.id <> pl.id limit 1);
    if v_star is not null then
      perform public.auction_fail('star_taken',
        format('%s already has a star player (%s)', t.name, v_star));
    end if;
  end if;

  -- The price comes out of the purse for the player's pool.
  v_purse := (select x.purse from public.team_pool_status(p_team_id, pl.pool) x);
  v_spent := (select x.spent from public.team_pool_status(p_team_id, pl.pool) x);
  v_remaining := v_purse - v_spent
    + case when pl.status = 'sold' and pl.sold_team_id = p_team_id then coalesce(pl.sold_price, 0) else 0 end;
  if p_price > v_remaining then
    perform public.auction_fail('insufficient_purse',
      format('Not enough purse: %s has %s left', t.name, v_remaining));
  end if;

  -- Owners and stars aren't auction results: drop any open result (a manual
  -- assignment, or an unsold from this round) so it can't be undone later.
  if exists (select 1 from public.results where player_id = pl.id and undone_at is null) then
    delete from public.results where player_id = pl.id and undone_at is null;
    update public.auction_state
       set last_result_id = (select max(id) from public.results where undone_at is null)
     where id = 1;
  end if;
  if s.spin_candidates is not null and pl.id = any (s.spin_candidates) then
    update public.auction_state set spin_candidates = array_remove(spin_candidates, pl.id) where id = 1;
  end if;

  v_was_signing := pl.signing;
  update public.players
     set status = 'sold', sold_team_id = p_team_id, sold_price = p_price, signing = p_signing,
         decided_round = null, waitlisted_at = null
   where id = pl.id;

  perform public.audit(p_actor, case when v_was_signing is null then 'sign_' || p_signing else 'update_signing' end,
    jsonb_build_object('player_id', pl.id, 'name', pl.name, 'team_id', p_team_id, 'signing', p_signing, 'price', p_price));
  return (select x from public.players x where x.id = p_player_id);
end $$;

-- Takes an owner or star player off their team and back to the pool.
create or replace function public.admin_release_signing(p_actor text, p_player_id uuid)
returns public.players language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
begin
  s := public.auction_lock();
  pl := (select x from public.players x where x.id = p_player_id for update);
  if pl.id is null then
    perform public.auction_fail('not_found', 'Player not found');
  end if;
  if pl.signing is null then
    perform public.auction_fail('not_signed', format('%s is not an owner or star player', pl.name));
  end if;
  update public.players
     set status = 'pool', sold_team_id = null, sold_price = null, signing = null, decided_round = null
   where id = pl.id;
  perform public.audit(p_actor, 'release_signing', jsonb_build_object('player_id', pl.id, 'name', pl.name));
  return (select x from public.players x where x.id = p_player_id);
end $$;

-- Resetting the auction leaves owners, stars and the waitlist alone.
create or replace function public.auction_reset(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
begin
  s := public.auction_lock();
  update public.auction_state
     set phase = 'idle', current_player_id = null, current_bid = null, leading_team_id = null,
         bid_count = 0, spin_candidates = null, spin_started_at = null, last_result_id = null
   where id = 1;
  -- Supabase's safeupdate extension rejects UPDATE/DELETE without WHERE on
  -- API requests, hence the explicit "where true".
  delete from public.bids where true;
  delete from public.results where true;
  update public.players
     set status = 'pool', sold_team_id = null, sold_price = null, decided_round = null
   where signing is null
     and (status::text in ('sold', 'unsold') or (status::text = 'pool' and decided_round is not null));
  update public.pool_config set current_round = 1 where true;
  perform public.audit(p_actor, 'reset', '{}'::jsonb);
  return (select a from public.auction_state a where a.id = 1);
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('team_pool_status', 'admin_sign_player', 'admin_release_signing', 'auction_reset')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
