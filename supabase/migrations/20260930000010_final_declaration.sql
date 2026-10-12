-- A second, separate agreement shown at the end of the registration form,
-- just above Submit, with its own "I agree" box (e.g. the rule book and
-- conduct clause). Empty = no second agreement. Safe to run more than once.

alter table public.registration_settings
  add column if not exists final_declaration_text text not null default ''
    check (char_length(final_declaration_text) <= 2000);
