-- AI notes are written automatically: when an owner opens or stars a player,
-- when the player comes up, and a few at a time in the background. These keep
-- two requests from writing the same note, space the background requests out
-- and pause everything while the AI's free rate limit is reached.
--
-- Private: only the server uses them. Safe to run more than once.

alter table public.player_insights add column if not exists note_claimed_at timestamptz;

create table if not exists public.ai_status (
  id            integer primary key default 1 check (id = 1),
  last_call_at  timestamptz,
  blocked_until timestamptz
);
insert into public.ai_status (id) values (1) on conflict (id) do nothing;
alter table public.ai_status enable row level security;

-- Claims the listed players that still need a note (none claimed in the
-- last 2 minutes) and returns them. Returns nothing while the AI is paused,
-- or when another request went out less than p_gap_seconds ago (0 = no gap).
create or replace function public.claim_insight_notes(p_players uuid[], p_gap_seconds integer)
returns setof uuid
language sql as $$
  with slot as (
    update public.ai_status
       set last_call_at = now()
     where id = 1
       and coalesce(blocked_until, '-infinity') <= now()
       and (p_gap_seconds <= 0 or coalesce(last_call_at, '-infinity') <= now() - make_interval(secs => p_gap_seconds))
    returning id
  ), fresh as (
    insert into public.player_insights (player_id, note_claimed_at)
    select p.id, now() from public.players p
     where p.id = any (p_players) and exists (select 1 from slot)
    on conflict (player_id) do nothing
    returning player_id
  ), stale as (
    update public.player_insights i
       set note_claimed_at = now()
     where i.player_id = any (p_players)
       and i.summary is null
       and (i.note_claimed_at is null or i.note_claimed_at < now() - interval '2 minutes')
       and exists (select 1 from slot)
    returning i.player_id
  )
  select player_id from fresh
  union
  select player_id from stale
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.ai_status from anon, authenticated;
    grant all on public.ai_status to service_role;
    revoke all on function public.claim_insight_notes(uuid[], integer) from public, anon, authenticated;
    grant execute on function public.claim_insight_notes(uuid[], integer) to service_role;
  end if;
end $$;
