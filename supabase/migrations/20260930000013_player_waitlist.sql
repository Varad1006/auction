-- A public waiting list. Waitlisted players are shown to everyone on the
-- Waitlist page, in order, but they are not in the auction: not on the
-- wheel, can't be picked, sold or assigned, and aren't counted as players
-- left. An admin adds players to it (by hand, or by approving a
-- registration that came in after the spots were full) and moves them into
-- the auction when a place opens up.
--
-- The new enum value is only referenced inside plpgsql bodies, which are
-- checked when they run, so this file works as a single transaction (e.g.
-- pasted into the Supabase SQL Editor). Safe to run more than once.

alter type public.player_status add value if not exists 'waitlist';

-- Queue order: registration time for registrations, otherwise when added.
alter table public.players add column if not exists waitlisted_at timestamptz;

-- Moves a not-yet-auctioned player onto the waitlist, or a waitlisted player
-- into the auction (the current round of their pool).
create or replace function public.admin_set_waitlist(p_actor text, p_player_id uuid, p_waitlisted boolean)
returns public.players language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
begin
  s := public.auction_lock();
  select * into pl from public.players where id = p_player_id for update;
  if not found then
    perform public.auction_fail('not_found', 'Player not found');
  end if;

  if p_waitlisted then
    if pl.status::text = 'waitlist' then
      return pl;
    end if;
    if pl.status::text <> 'pool' then
      perform public.auction_fail('already_auctioned',
        format('%s has already been auctioned (%s): undo the result first', pl.name, pl.status));
    end if;
    if s.current_player_id = pl.id and s.phase in ('spinning', 'revealed', 'bidding') then
      perform public.auction_fail('on_block', 'Player is on the block: return them to the pool first');
    end if;
    if s.spin_candidates is not null and pl.id = any (s.spin_candidates) then
      update public.auction_state set spin_candidates = array_remove(spin_candidates, pl.id) where id = 1;
    end if;
    update public.players
       set status = 'waitlist', waitlisted_at = now(), decided_round = null
     where id = pl.id
    returning * into pl;
    perform public.audit(p_actor, 'waitlist_add', jsonb_build_object('player_id', pl.id, 'name', pl.name));
  else
    if pl.status::text <> 'waitlist' then
      perform public.auction_fail('not_waitlisted', format('%s is not on the waitlist', pl.name));
    end if;
    update public.players
       set status = 'pool', waitlisted_at = null, decided_round = null
     where id = pl.id
    returning * into pl;
    perform public.audit(p_actor, 'waitlist_remove', jsonb_build_object('player_id', pl.id, 'name', pl.name));
  end if;
  return pl;
end $$;

-- Approving a registration can now put the new player straight on the
-- waitlist, keeping their place by registration time. The old 5-argument
-- version is replaced; callers that leave p_waitlist out get the old
-- behaviour.
drop function if exists public.admin_approve_registration(text, uuid, public.player_grade, integer, text);
create or replace function public.admin_approve_registration(
  p_actor text, p_id uuid, p_grade public.player_grade, p_base_price integer, p_photo_url text,
  p_waitlist boolean default false)
returns uuid language plpgsql as $$
declare
  r public.registrations;
  cfg public.pool_config;
  v_player uuid;
  v_details jsonb := '[]'::jsonb;
begin
  select * into r from public.registrations where id = p_id for update;
  if not found then
    perform public.auction_fail('not_found', 'Registration not found');
  end if;
  if r.status <> 'pending' then
    perform public.auction_fail('not_pending', format('Registration is already %s', r.status));
  end if;
  select * into cfg from public.pool_config where pool = r.gender;

  if coalesce(r.availability, '') <> '' then
    v_details := v_details || jsonb_build_array(jsonb_build_object('label', 'Availability', 'value', r.availability));
  end if;
  v_details := v_details || jsonb_build_array(jsonb_build_object('label', 'Age', 'value', r.age::text));

  insert into public.players (name, pool, role, grade, batting_style, bowling_style, base_price, photo_url, notes, details,
                              status, waitlisted_at)
  values (r.full_name, r.gender, r.role, p_grade, nullif(r.batting_style, ''), nullif(r.bowling_style, ''),
          coalesce(p_base_price, case p_grade when 'A' then cfg.base_price_a when 'B' then cfg.base_price_b
                                              else cfg.base_price_c end),
          p_photo_url, nullif(r.additional_info, ''), v_details,
          case when p_waitlist then 'waitlist' else 'pool' end::text::public.player_status,
          case when p_waitlist then r.created_at end)
  returning id into v_player;

  update public.registrations
     set status = 'approved', player_id = v_player, reviewed_by = p_actor, reviewed_at = now()
   where id = r.id;
  perform public.audit(p_actor, 'approve_registration', jsonb_build_object(
    'registration_id', r.id, 'player_id', v_player, 'waitlist', p_waitlist));
  return v_player;
end $$;

-- Assigning a player by hand skips the waitlist check otherwise, so it is
-- repeated here.
create or replace function public.auction_assign_player(p_actor text, p_player_id uuid, p_team_id uuid, p_price integer)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
  cfg public.pool_config;
  v_result bigint;
begin
  s := public.auction_lock();
  select * into pl from public.players where id = p_player_id for update;
  if not found then
    perform public.auction_fail('not_found', 'Player not found');
  end if;
  if pl.status = 'sold' then
    perform public.auction_fail('already_sold', 'Player is already sold');
  end if;
  if pl.status::text = 'waitlist' then
    perform public.auction_fail('waitlisted', 'Player is on the waitlist: move them to the players list first');
  end if;
  if s.current_player_id = pl.id and s.phase in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('on_block', 'Player is on the block: sell them through bidding');
  end if;
  if p_price is null or p_price < 0 then
    perform public.auction_fail('bad_price', 'Price must be zero or more');
  end if;
  perform public.auction_check_affordable(p_team_id, pl.pool, p_price, false);
  select * into cfg from public.pool_config where pool = pl.pool;

  update public.players
     set status = 'sold', sold_team_id = p_team_id, sold_price = p_price,
         decided_round = cfg.current_round
   where id = pl.id;
  insert into public.results (player_id, pool, round, outcome, team_id, price, method)
  values (pl.id, pl.pool, cfg.current_round, 'sold', p_team_id, p_price, 'manual')
  returning id into v_result;

  update public.auction_state set last_result_id = v_result where id = 1 returning * into s;
  perform public.audit(p_actor, 'assign', jsonb_build_object(
    'player_id', pl.id, 'team_id', p_team_id, 'price', p_price, 'result_id', v_result));
  return s;
end $$;

-- Resetting the auction no longer pulls waitlisted players into the pool.
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
   where status::text in ('sold', 'unsold') or (status::text = 'pool' and decided_round is not null);
  update public.pool_config set current_round = 1 where true;
  select * into s from public.auction_state where id = 1;
  perform public.audit(p_actor, 'reset', '{}'::jsonb);
  return s;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_set_waitlist', 'admin_approve_registration', 'auction_assign_player', 'auction_reset')
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
