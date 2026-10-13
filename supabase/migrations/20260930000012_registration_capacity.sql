-- Registration spots per pool, first come first served. Registrations
-- beyond the limit (counted in submission order, rejected ones not counted)
-- go on a waitlist and only reach the auction when an admin adds them.
-- Empty = no limit. Safe to run more than once.

alter table public.registration_settings
  add column if not exists capacity_men integer check (capacity_men >= 0),
  add column if not exists capacity_women integer check (capacity_women >= 0);
