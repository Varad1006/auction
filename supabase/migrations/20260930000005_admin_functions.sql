-- Admin edits that interact with the live auction take the same lock as the
-- auction functions, so they cannot race with a spin, bid or sale.

create function public.admin_delete_player(p_actor text, p_player_id uuid)
returns void language plpgsql as $$
declare
  s public.auction_state;
  pl public.players;
begin
  s := public.auction_lock();
  select * into pl from public.players where id = p_player_id;
  if not found then
    perform public.auction_fail('not_found', 'Player not found');
  end if;
  if pl.status = 'sold' then
    perform public.auction_fail('player_sold', 'Player is sold: undo the result before deleting');
  end if;
  if s.current_player_id = pl.id then
    if s.phase in ('spinning', 'revealed', 'bidding') then
      perform public.auction_fail('on_block', 'Player is on the block');
    end if;
    update public.auction_state set current_player_id = null, phase = 'idle' where id = 1;
  end if;
  if s.spin_candidates is not null and pl.id = any (s.spin_candidates) then
    update public.auction_state set spin_candidates = array_remove(spin_candidates, pl.id) where id = 1;
  end if;
  delete from public.players where id = pl.id;
  perform public.audit(p_actor, 'delete_player', jsonb_build_object('player_id', pl.id, 'name', pl.name));
end $$;

create function public.admin_delete_team(p_actor text, p_team_id uuid)
returns void language plpgsql as $$
declare
  s public.auction_state;
  t public.teams;
begin
  s := public.auction_lock();
  select * into t from public.teams where id = p_team_id;
  if not found then
    perform public.auction_fail('not_found', 'Team not found');
  end if;
  if exists (select 1 from public.players where sold_team_id = t.id) then
    perform public.auction_fail('team_has_players', 'Team has bought players: undo those results first');
  end if;
  if s.phase = 'bidding' and exists (
      select 1 from public.bids where team_id = t.id and player_id = s.current_player_id and voided_at is null) then
    perform public.auction_fail('team_bidding', 'Team has bids on the current player');
  end if;
  delete from public.teams where id = t.id;
  perform public.audit(p_actor, 'delete_team', jsonb_build_object('team_id', t.id, 'name', t.name));
end $$;

-- Sets every undecided player's base price in a pool to the pool's price for
-- their grade (the player on the block keeps theirs).
create function public.admin_apply_base_prices(p_actor text, p_pool public.pool_kind)
returns integer language plpgsql as $$
declare
  s public.auction_state;
  cfg public.pool_config;
  n integer;
begin
  s := public.auction_lock();
  select * into cfg from public.pool_config where pool = p_pool;
  update public.players p
     set base_price = case p.grade when 'A' then cfg.base_price_a
                                   when 'B' then cfg.base_price_b
                                   else cfg.base_price_c end
   where p.pool = p_pool and p.status <> 'sold'
     and not (p.id is not distinct from s.current_player_id and s.phase in ('spinning', 'revealed', 'bidding'));
  get diagnostics n = row_count;
  perform public.audit(p_actor, 'apply_base_prices', jsonb_build_object('pool', p_pool, 'players', n));
  return n;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_player', 'admin_delete_team', 'admin_apply_base_prices')
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
