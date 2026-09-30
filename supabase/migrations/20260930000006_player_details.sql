-- Extra per-player information from the registration sheet/form (e.g. year,
-- branch, previous teams, stats). Stored as an ordered list of
-- {"label": ..., "value": ...} pairs so any column can be shown on the
-- player card without a schema change.
alter table public.players
  add column if not exists details jsonb not null default '[]'::jsonb
  check (jsonb_typeof(details) = 'array');
