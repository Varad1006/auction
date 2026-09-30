-- Default configuration. Everything here can be changed from the admin
-- Settings page; these rows just make the app usable immediately.

insert into public.pool_config
  (pool, label, purse, min_squad, max_squad, base_price_a, base_price_b, base_price_c, increment_tiers)
values
  ('men',   'Men',   1000, 8, 12, 50, 30, 20, '[{"from": 0, "step": 5}]'),
  ('women', 'Women',  300, 3,  5, 30, 20, 10, '[{"from": 0, "step": 5}]')
on conflict (pool) do nothing;

insert into public.auction_state (id) values (1) on conflict (id) do nothing;

insert into public.teams (name, short_name, color, sort_order)
select * from (values
  ('Team 1', 'T1', '#e11d48', 1),
  ('Team 2', 'T2', '#2563eb', 2),
  ('Team 3', 'T3', '#16a34a', 3),
  ('Team 4', 'T4', '#d97706', 4),
  ('Team 5', 'T5', '#7c3aed', 5),
  ('Team 6', 'T6', '#0891b2', 6)
) v(name, short_name, color, sort_order)
where not exists (select 1 from public.teams);
