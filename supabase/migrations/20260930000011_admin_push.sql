-- Push notifications for admins (e.g. "new registration to review"), not
-- just team owners. Subscriptions now record the role they were made for;
-- the server checks the person still has that role before sending.
-- Safe to run more than once.

alter table public.push_subscriptions drop constraint if exists push_subscriptions_email_fkey;
alter table public.push_subscriptions
  add column if not exists role text not null default 'owner' check (role in ('owner', 'admin'));
create index if not exists push_subscriptions_role_idx on public.push_subscriptions (role);
