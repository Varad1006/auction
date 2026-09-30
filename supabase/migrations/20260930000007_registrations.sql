-- In-house player registration form.
--
-- Anyone can submit the form (no sign-in); submissions land here as
-- 'pending' and an admin approves them into the players table. Everything in
-- this table is private (contact details, flat numbers, receipts): browsers
-- have no access, the Next.js API reads and writes it with the service role.

create type public.registration_status as enum ('pending', 'approved', 'rejected');

create table public.registrations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  full_name        text not null check (char_length(full_name) between 1 and 80),
  email            text not null unique check (email = lower(email) and email like '%_@_%'),
  phone            text not null check (char_length(phone) between 6 and 20),
  flat_number      text not null check (char_length(flat_number) between 1 and 30),
  age              integer not null check (age between 5 and 100),
  gender           public.pool_kind not null,
  role             public.player_role not null,
  batting_style    text check (char_length(batting_style) <= 40),
  bowling_style    text check (char_length(bowling_style) <= 40),
  tshirt_size      text check (char_length(tshirt_size) <= 10),
  availability     text check (char_length(availability) <= 300),
  additional_info  text check (char_length(additional_info) <= 500),
  photo_path       text not null,
  receipt_path     text,
  declaration      boolean not null check (declaration),
  status           public.registration_status not null default 'pending',
  player_id        uuid references public.players (id) on delete set null,
  reviewed_by      text,
  reviewed_at      timestamptz
);
create index registrations_status_idx on public.registrations (status, created_at);

-- Form settings (single row), edited on the admin Registrations page.
create table public.registration_settings (
  id                     smallint primary key default 1 check (id = 1),
  is_open                boolean not null default false,
  title                  text not null default 'Player registration' check (char_length(title) <= 80),
  intro                  text not null default '' check (char_length(intro) <= 2000),
  payment_instructions   text not null default '' check (char_length(payment_instructions) <= 1000),
  receipt_required       boolean not null default true,
  availability_question  text not null default 'Availability' check (char_length(availability_question) <= 150),
  -- Checkbox options (e.g. match dates); empty = free-text answer.
  availability_options   text[] not null default '{}',
  declaration_text       text not null default 'I confirm the details above are correct and I will follow the tournament rules.'
                         check (char_length(declaration_text) <= 2000),
  updated_at             timestamptz not null default now()
);
insert into public.registration_settings (id) values (1) on conflict do nothing;

create trigger registration_settings_touch before update on public.registration_settings
  for each row execute function public.tg_touch_updated_at();

alter table public.registrations enable row level security;
alter table public.registration_settings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.registrations from anon, authenticated;
    revoke all on public.registration_settings from anon, authenticated;
  end if;
end $$;

-- Approves a pending registration into the players table (atomically).
create function public.admin_approve_registration(
  p_actor text, p_id uuid, p_grade public.player_grade, p_base_price integer, p_photo_url text)
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

  insert into public.players (name, pool, role, grade, batting_style, bowling_style, base_price, photo_url, notes, details)
  values (r.full_name, r.gender, r.role, p_grade, nullif(r.batting_style, ''), nullif(r.bowling_style, ''),
          coalesce(p_base_price, case p_grade when 'A' then cfg.base_price_a when 'B' then cfg.base_price_b
                                              else cfg.base_price_c end),
          p_photo_url, nullif(r.additional_info, ''), v_details)
  returning id into v_player;

  update public.registrations
     set status = 'approved', player_id = v_player, reviewed_by = p_actor, reviewed_at = now()
   where id = r.id;
  perform public.audit(p_actor, 'approve_registration', jsonb_build_object('registration_id', r.id, 'player_id', v_player));
  return v_player;
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_approve_registration'
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

-- Private bucket for registration photos and payment receipts (admins view
-- them through short-lived signed URLs). Approved photos are copied to the
-- public player-photos bucket.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('registrations', 'registrations', false, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;
