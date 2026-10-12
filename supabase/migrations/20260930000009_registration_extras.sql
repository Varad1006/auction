-- Registration form extras and a "start fresh" clean-up.
--
-- * A rulebook link with a message, shown at the top of the form.
-- * Payment QR codes, stored as their UPI payment links (upi://pay?...); the
--   form draws the QR code and shows the UPI ID with a copy button.
-- * Room for a full undertaking & declaration (terms and conditions).
-- * admin_delete_all_players: wipes players (and with them bids, results
--   and wishlist entries) so a mock auction can be cleared before the real one.
--
-- Safe to run more than once.

alter table public.registration_settings
  add column if not exists rulebook_url text
    check (rulebook_url is null or (char_length(rulebook_url) <= 500 and rulebook_url ~ '^https://')),
  add column if not exists rulebook_message text not null default 'Please read the rulebook before registering.'
    check (char_length(rulebook_message) <= 300),
  -- [{"label": "...", "payload": "upi://pay?pa=...&pn=..."}]
  add column if not exists payment_qr jsonb not null default '[]'::jsonb
    check (jsonb_typeof(payment_qr) = 'array' and jsonb_array_length(payment_qr) <= 4);

alter table public.registration_settings drop constraint if exists registration_settings_declaration_text_check;
alter table public.registration_settings
  add constraint registration_settings_declaration_text_check check (char_length(declaration_text) <= 6000);

-- Deletes every player. Bids, results and wishlist entries go with them
-- (on delete cascade); registrations that had been approved go back to
-- pending so they can be approved again. Returns the number deleted.
create or replace function public.admin_delete_all_players(p_actor text)
returns integer language plpgsql as $$
declare
  s public.auction_state;
  v_count integer;
begin
  s := public.auction_lock();
  if s.phase in ('spinning', 'revealed', 'bidding') then
    perform public.auction_fail('block_busy', 'A player is on the block: finish or return them to the pool first');
  end if;
  update public.auction_state
     set phase = 'idle', current_player_id = null, current_bid = null, leading_team_id = null,
         bid_count = 0, spin_candidates = null, spin_started_at = null, last_result_id = null
   where id = 1;
  delete from public.players where true;
  get diagnostics v_count = row_count;
  update public.pool_config set current_round = 1 where true;
  update public.registrations
     set status = 'pending', reviewed_by = null, reviewed_at = null
   where status = 'approved' and player_id is null;
  perform public.audit(p_actor, 'delete_all_players', jsonb_build_object('count', v_count));
  return v_count;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_delete_all_players'
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
