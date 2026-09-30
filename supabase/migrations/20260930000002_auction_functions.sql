-- Auction state machine.
--
-- Every write to the live auction goes through one of the auction_* functions
-- below. Each one starts by locking the single auction_state row
-- (SELECT ... FOR UPDATE), so concurrent calls are applied one at a time and
-- each sees the effects of the previous one. Callers pass the amount they are
-- bidding; if another bid landed first the amount is now too low and the call
-- is rejected with hint 'outbid' instead of silently overwriting it.
--
-- These functions are executable by service_role only (see the grants at the
-- end). The Next.js API resolves the caller's role from their Google sign-in
-- and passes it in; the owner/team check is repeated here as defence in depth.
--
-- Errors are raised with SQLSTATE P0001, a human-readable message and a
-- machine-readable code in HINT.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.auction_fail(p_code text, p_message text, p_detail text default null)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code,
    detail = coalesce(p_detail, '');
end $$;

create function public.increment_for(p_tiers jsonb, p_amount integer)
returns integer language sql immutable as $$
  select coalesce(
    (select (t ->> 'step')::integer
       from jsonb_array_elements(p_tiers) t
      where (t ->> 'from')::integer <= p_amount
      order by (t ->> 'from')::integer desc
      limit 1),
    (select (t ->> 'step')::integer
       from jsonb_array_elements(p_tiers) t
      order by (t ->> 'from')::integer
      limit 1))
$$;

-- Lowest base price in a pool: used for the purse-reserve rule.
create function public.pool_min_base(p_pool public.pool_kind)
returns integer language sql stable as $$
  select least(base_price_a, base_price_b, base_price_c)
    from public.pool_config where pool = p_pool
$$;

create function public.team_pool_status(p_team uuid, p_pool public.pool_kind)
returns table (purse integer, min_squad integer, max_squad integer, spent integer, squad_count integer)
language sql stable as $$
  select coalesce(l.purse, c.purse),
         coalesce(l.min_squad, c.min_squad),
         coalesce(l.max_squad, c.max_squad),
         coalesce((select sum(p.sold_price) from public.players p
                    where p.sold_team_id = t.id and p.pool = p_pool and p.status = 'sold'), 0)::integer,
         (select count(*) from public.players p
           where p.sold_team_id = t.id and p.pool = p_pool and p.status = 'sold')::integer
    from public.teams t
    join public.pool_config c on c.pool = p_pool
    left join public.team_pool_limits l on l.team_id = t.id and l.pool = p_pool
   where t.id = p_team
$$;

create function public.auction_lock()
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
begin
  select * into s from public.auction_state where id = 1 for update;
  if not found then
    perform public.auction_fail('not_initialized', 'Auction state row is missing');
  end if;
  return s;
end $$;

-- Latest non-voided bid for a player in a round, plus the active bid count.
create function public.auction_bid_summary(p_player uuid, p_round integer,
  out amount integer, out team_id uuid, out bid_count integer)
language sql stable as $$
  select (select b.amount from public.bids b
           where b.player_id = p_player and b.round = p_round and b.voided_at is null
           order by b.id desc limit 1),
         (select b.team_id from public.bids b
           where b.player_id = p_player and b.round = p_round and b.voided_at is null
           order by b.id desc limit 1),
         (select count(*)::integer from public.bids b
           where b.player_id = p_player and b.round = p_round and b.voided_at is null)
$$;

create function public.audit(p_actor text, p_action text, p_details jsonb)
returns void language sql as $$
  insert into public.audit_log (actor, action, details) values (p_actor, p_action, p_details)
$$;

-- Validates that p_team can buy a player from p_pool at p_amount.
create function public.auction_check_affordable(p_team uuid, p_pool public.pool_kind,
  p_amount integer, p_check_reserve boolean)
returns void language plpgsql as $$
declare
  st record;
  v_remaining integer;
  v_reserve integer;
  v_slots integer;
begin
  select * into st from public.team_pool_status(p_team, p_pool);
  if not found then
    perform public.auction_fail('invalid_team', 'Unknown team');
  end if;
  if st.squad_count >= st.max_squad then
    perform public.auction_fail('squad_full',
      format('Squad is full (%s/%s)', st.squad_count, st.max_squad));
  end if;
  v_remaining := st.purse - st.spent;
  if p_amount > v_remaining then
    perform public.auction_fail('insufficient_purse',
      format('Not enough purse: %s left', v_remaining));
  end if;
  if p_check_reserve then
    v_slots := greatest(st.min_squad - st.squad_count - 1, 0);
    v_reserve := v_slots * public.pool_min_base(p_pool);
    if v_remaining - p_amount < v_reserve then
      perform public.auction_fail('reserve',
        format('Must keep %s in reserve to fill %s more squad spot(s); max bid is %s',
               v_reserve, v_slots, v_remaining - v_reserve));
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Bidding
-- ---------------------------------------------------------------------------

create function public.auction_place_bid(
  p_actor text, p_actor_role text, p_actor_team uuid,
  p_team_id uuid, p_player_id uuid, p_amount integer)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
  cfg public.pool_config;
  v_min integer;
begin
  if p_actor_role not in ('owner', 'admin') then
    perform public.auction_fail('forbidden', 'Only owners and admins can bid');
  end if;
  if p_actor_role = 'owner' and p_team_id is distinct from p_actor_team then
    perform public.auction_fail('forbidden', 'Owners can only bid for their own team');
  end if;

  s := public.auction_lock();

  if s.phase <> 'bidding' then
    perform public.auction_fail('not_bidding', 'Bidding is not open');
  end if;
  if s.current_player_id is distinct from p_player_id then
    perform public.auction_fail('stale', 'That player is no longer on the block');
  end if;
  if s.leading_team_id = p_team_id then
    perform public.auction_fail('already_leading', 'You already hold the highest bid');
  end if;

  select * into pl from public.players where id = p_player_id;
  select * into cfg from public.pool_config where pool = pl.pool;

  if s.current_bid is null then
    v_min := pl.base_price;
  else
    v_min := s.current_bid + public.increment_for(cfg.increment_tiers, s.current_bid);
  end if;
  if p_amount < v_min then
    if s.current_bid is not null and p_amount <= s.current_bid then
      perform public.auction_fail('outbid',
        format('Outbid: current bid is now %s', s.current_bid), s.current_bid::text);
    end if;
    perform public.auction_fail('too_low', format('Minimum bid is %s', v_min), v_min::text);
  end if;

  perform public.auction_check_affordable(p_team_id, pl.pool, p_amount, true);

  insert into public.bids (player_id, pool, round, team_id, amount, placed_by_role)
  values (p_player_id, pl.pool, cfg.current_round, p_team_id, p_amount, p_actor_role);

  update public.auction_state
     set current_bid = p_amount, leading_team_id = p_team_id, bid_count = bid_count + 1
   where id = 1
  returning * into s;

  perform public.audit(p_actor, 'bid', jsonb_build_object(
    'player_id', p_player_id, 'team_id', p_team_id, 'amount', p_amount, 'role', p_actor_role));
  return s;
end $$;

create function public.auction_undo_bid(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  v_round integer;
  v_bid public.bids;
  sm record;
begin
  s := public.auction_lock();
  if s.phase <> 'bidding' then
    perform public.auction_fail('not_bidding', 'Bidding is not open');
  end if;
  select current_round into v_round from public.pool_config where pool = s.current_pool;

  select * into v_bid from public.bids
   where player_id = s.current_player_id and round = v_round and voided_at is null
   order by id desc limit 1;
  if not found then
    perform public.auction_fail('nothing_to_undo', 'No bids to undo');
  end if;

  update public.bids set voided_at = clock_timestamp() where id = v_bid.id;
  select * into sm from public.auction_bid_summary(s.current_player_id, v_round);

  update public.auction_state
     set current_bid = sm.amount, leading_team_id = sm.team_id, bid_count = sm.bid_count
   where id = 1
  returning * into s;

  perform public.audit(p_actor, 'undo_bid', jsonb_build_object(
    'bid_id', v_bid.id, 'team_id', v_bid.team_id, 'amount', v_bid.amount));
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Putting players on the block
-- ---------------------------------------------------------------------------

-- Fails if the block holds a player with active bids.
create function public.auction_require_block_free(s public.auction_state)
returns void language plpgsql as $$
begin
  if s.phase in ('spinning', 'revealed', 'bidding') and s.bid_count > 0 then
    perform public.auction_fail('block_busy',
      'The current player has bids: sell, mark unsold or undo the bids first');
  end if;
end $$;

-- Randomly picks the next player from the current pool (equal weights; only
-- players with status 'pool', so sold and this round's unsold are excluded).
-- The server decides the result; clients only animate the wheel towards it.
create function public.auction_spin(p_actor text, p_duration_ms integer default 6000)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  v_candidates uuid[];
  v_target uuid;
begin
  s := public.auction_lock();
  perform public.auction_require_block_free(s);

  select array_agg(id order by name, id) into v_candidates
    from public.players where pool = s.current_pool and status = 'pool';
  if v_candidates is null then
    perform public.auction_fail('pool_empty',
      'No players left in this pool for this round. Advance the round or switch pools.');
  end if;

  -- gen_random_uuid() is backed by a cryptographically strong RNG.
  select c into v_target from unnest(v_candidates) c order by gen_random_uuid() limit 1;

  update public.auction_state
     set phase = 'spinning', current_player_id = v_target, current_bid = null,
         leading_team_id = null, bid_count = 0, spin_candidates = v_candidates,
         spin_started_at = now(), spin_duration_ms = greatest(1000, least(p_duration_ms, 15000))
   where id = 1
  returning * into s;

  perform public.audit(p_actor, 'spin', jsonb_build_object(
    'player_id', v_target, 'candidates', cardinality(v_candidates)));
  return s;
end $$;

-- Puts a specific player on the block without spinning.
create function public.auction_select_player(p_actor text, p_player_id uuid)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
begin
  s := public.auction_lock();
  perform public.auction_require_block_free(s);

  select * into pl from public.players where id = p_player_id;
  if not found then
    perform public.auction_fail('not_found', 'Player not found');
  end if;
  if pl.status <> 'pool' then
    perform public.auction_fail('not_in_pool', 'Player is not in the pool for this round');
  end if;

  update public.auction_state
     set current_pool = pl.pool, phase = 'revealed', current_player_id = pl.id,
         current_bid = null, leading_team_id = null, bid_count = 0,
         spin_candidates = null, spin_started_at = null
   where id = 1
  returning * into s;

  perform public.audit(p_actor, 'select_player', jsonb_build_object('player_id', pl.id));
  return s;
end $$;

create function public.auction_open_bidding(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
begin
  s := public.auction_lock();
  if s.phase not in ('spinning', 'revealed') or s.current_player_id is null then
    perform public.auction_fail('bad_phase', 'Spin or pick a player first');
  end if;
  update public.auction_state set phase = 'bidding' where id = 1 returning * into s;
  perform public.audit(p_actor, 'open_bidding', jsonb_build_object('player_id', s.current_player_id));
  return s;
end $$;

-- Takes the current player off the block without a result (e.g. picked by
-- mistake). Only allowed while there are no active bids.
create function public.auction_return_to_pool(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  v_player uuid;
begin
  s := public.auction_lock();
  if s.phase not in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('bad_phase', 'No player on the block');
  end if;
  perform public.auction_require_block_free(s);
  v_player := s.current_player_id;
  update public.auction_state
     set phase = 'idle', current_player_id = null, current_bid = null,
         leading_team_id = null, bid_count = 0, spin_candidates = null, spin_started_at = null
   where id = 1
  returning * into s;
  perform public.audit(p_actor, 'return_to_pool', jsonb_build_object('player_id', v_player));
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------

create function public.auction_sell(p_actor text, p_player_id uuid)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
  cfg public.pool_config;
  v_result bigint;
begin
  s := public.auction_lock();
  if s.phase <> 'bidding' then
    perform public.auction_fail('not_bidding', 'Bidding is not open');
  end if;
  if s.current_player_id is distinct from p_player_id then
    perform public.auction_fail('stale', 'That player is no longer on the block');
  end if;
  if s.leading_team_id is null then
    perform public.auction_fail('no_bids', 'No bids yet: mark the player unsold instead');
  end if;

  select * into pl from public.players where id = p_player_id;
  select * into cfg from public.pool_config where pool = pl.pool;

  -- Re-check limits in case settings changed after the bid was placed.
  perform public.auction_check_affordable(s.leading_team_id, pl.pool, s.current_bid, false);

  update public.players
     set status = 'sold', sold_team_id = s.leading_team_id, sold_price = s.current_bid,
         decided_round = cfg.current_round
   where id = pl.id;

  insert into public.results (player_id, pool, round, outcome, team_id, price)
  values (pl.id, pl.pool, cfg.current_round, 'sold', s.leading_team_id, s.current_bid)
  returning id into v_result;

  update public.auction_state set phase = 'sold', last_result_id = v_result
   where id = 1 returning * into s;

  perform public.audit(p_actor, 'sell', jsonb_build_object(
    'player_id', pl.id, 'team_id', s.leading_team_id, 'price', s.current_bid, 'result_id', v_result));
  return s;
end $$;

create function public.auction_mark_unsold(p_actor text, p_player_id uuid)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
  cfg public.pool_config;
  v_result bigint;
begin
  s := public.auction_lock();
  if s.phase not in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('bad_phase', 'No player on the block');
  end if;
  if s.current_player_id is distinct from p_player_id then
    perform public.auction_fail('stale', 'That player is no longer on the block');
  end if;
  if s.bid_count > 0 then
    perform public.auction_fail('has_bids', 'There are bids on this player: sell or undo the bids first');
  end if;

  select * into pl from public.players where id = p_player_id;
  select * into cfg from public.pool_config where pool = pl.pool;

  update public.players set status = 'unsold', decided_round = cfg.current_round where id = pl.id;

  insert into public.results (player_id, pool, round, outcome)
  values (pl.id, pl.pool, cfg.current_round, 'unsold')
  returning id into v_result;

  update public.auction_state set phase = 'unsold', last_result_id = v_result
   where id = 1 returning * into s;

  perform public.audit(p_actor, 'unsold', jsonb_build_object('player_id', pl.id, 'result_id', v_result));
  return s;
end $$;

-- Soft-undoes the most recent active result. An auction result puts the
-- player back on the block with bidding open and the last bid restored.
-- A manual assignment just returns the player to the pool.
create function public.auction_undo_result(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  r public.results;
  cfg public.pool_config;
  sm record;
  v_prev bigint;
begin
  s := public.auction_lock();

  select * into r from public.results where undone_at is null order by id desc limit 1 for update;
  if not found then
    perform public.auction_fail('nothing_to_undo', 'No results to undo');
  end if;
  select * into cfg from public.pool_config where pool = r.pool;
  if r.round <> cfg.current_round then
    perform public.auction_fail('round_advanced',
      'The round has advanced since that result, so it can no longer be undone');
  end if;

  if r.method = 'auction' then
    -- The undone player goes back on the block, so it must be free.
    perform public.auction_require_block_free(s);
  end if;

  update public.results set undone_at = clock_timestamp() where id = r.id;
  update public.players
     set status = 'pool', sold_team_id = null, sold_price = null, decided_round = null
   where id = r.player_id;

  select id into v_prev from public.results where undone_at is null order by id desc limit 1;

  if r.method = 'auction' then
    select * into sm from public.auction_bid_summary(r.player_id, r.round);
    update public.auction_state
       set current_pool = r.pool, phase = 'bidding', current_player_id = r.player_id,
           current_bid = sm.amount, leading_team_id = sm.team_id, bid_count = sm.bid_count,
           spin_candidates = null, spin_started_at = null, last_result_id = v_prev
     where id = 1
    returning * into s;
  else
    update public.auction_state set last_result_id = v_prev where id = 1 returning * into s;
  end if;

  perform public.audit(p_actor, 'undo_result', jsonb_build_object(
    'result_id', r.id, 'player_id', r.player_id, 'outcome', r.outcome, 'price', r.price));
  return s;
end $$;

-- Assigns a player (pool or unsold) to a team at a fixed price, outside the
-- live bidding. Used to fill squads with leftovers after the final round.
create function public.auction_assign_player(p_actor text, p_player_id uuid, p_team_id uuid, p_price integer)
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

-- ---------------------------------------------------------------------------
-- Pools and rounds
-- ---------------------------------------------------------------------------

create function public.auction_set_pool(p_actor text, p_pool public.pool_kind)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
begin
  s := public.auction_lock();
  if s.phase in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('block_busy', 'Finish the player on the block first');
  end if;
  update public.auction_state
     set current_pool = p_pool, phase = 'idle', current_player_id = null, current_bid = null,
         leading_team_id = null, bid_count = 0, spin_candidates = null, spin_started_at = null
   where id = 1
  returning * into s;
  perform public.audit(p_actor, 'set_pool', jsonb_build_object('pool', p_pool));
  return s;
end $$;

-- Unsold players from round N become the pool for round N+1.
create function public.auction_advance_round(p_actor text, p_pool public.pool_kind)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
  v_left integer;
  v_unsold integer;
  v_round integer;
begin
  s := public.auction_lock();
  if s.current_pool = p_pool and s.phase in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('block_busy', 'Finish the player on the block first');
  end if;
  select count(*) into v_left from public.players where pool = p_pool and status = 'pool';
  if v_left > 0 then
    perform public.auction_fail('pool_not_empty',
      format('%s player(s) are still in this round''s pool', v_left));
  end if;
  select count(*) into v_unsold from public.players where pool = p_pool and status = 'unsold';
  if v_unsold = 0 then
    perform public.auction_fail('nothing_unsold', 'There are no unsold players to carry over');
  end if;

  update public.players set status = 'pool', decided_round = null
   where pool = p_pool and status = 'unsold';
  update public.pool_config set current_round = current_round + 1
   where pool = p_pool returning current_round into v_round;

  -- Touch the state so every client picks up the new round.
  if s.current_pool = p_pool then
    update public.auction_state
       set phase = 'idle', current_player_id = null, current_bid = null, leading_team_id = null,
           bid_count = 0, spin_candidates = null, spin_started_at = null
     where id = 1
    returning * into s;
  else
    update public.auction_state set spin_duration_ms = spin_duration_ms where id = 1
    returning * into s;
  end if;

  perform public.audit(p_actor, 'advance_round', jsonb_build_object(
    'pool', p_pool, 'round', v_round, 'players', v_unsold));
  return s;
end $$;

-- Rehearsal helper: puts every player back in the pool and clears all bids
-- and results. Irreversible.
create function public.auction_reset(p_actor text)
returns public.auction_state language plpgsql as $$
declare
  s public.auction_state;
begin
  s := public.auction_lock();
  update public.auction_state
     set phase = 'idle', current_player_id = null, current_bid = null, leading_team_id = null,
         bid_count = 0, spin_candidates = null, spin_started_at = null, last_result_id = null
   where id = 1;
  delete from public.bids;
  delete from public.results;
  update public.players
     set status = 'pool', sold_team_id = null, sold_price = null, decided_round = null
   where status <> 'pool' or decided_round is not null;
  update public.pool_config set current_round = 1;
  select * into s from public.auction_state where id = 1;
  perform public.audit(p_actor, 'reset', '{}'::jsonb);
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: only the server (service_role) may execute any of these.
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('auction_fail', 'increment_for', 'pool_min_base', 'team_pool_status',
                         'auction_lock', 'auction_bid_summary', 'audit', 'auction_check_affordable',
                         'auction_place_bid', 'auction_undo_bid', 'auction_require_block_free',
                         'auction_spin', 'auction_select_player', 'auction_open_bidding',
                         'auction_return_to_pool', 'auction_sell', 'auction_mark_unsold',
                         'auction_undo_result', 'auction_assign_player', 'auction_set_pool',
                         'auction_advance_round', 'auction_reset',
                         'tg_auction_state_version', 'tg_touch_updated_at', 'tg_team_limits')
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
