-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RCL ERP – PORTAL – STEP 11: a person's own, verified sign-in e-mail beside his fixed user ID
-- (his decision of 12-11-2026: "pk@gmail.com … he delet nahi honar … he user id banel … fix rahil" – the e-mail a user was made
--  with stays his USER ID for ever, in every module; the e-mail he himself types and verifies with a code becomes the one he
--  signs in with.)
-- Run ONCE in the PORTAL's Supabase → SQL Editor. It only ADDS two columns and one index: no user, password, access line or
-- sign-in is changed. Safe to run again. Until it is run the Portal works exactly as after step 10.
--
--   users.login_email   the e-mail he verified – he signs in with it (password or code); empty = he signs in with his user ID
--   otps.send_to        the address a "verify" code was sent to (so exactly that address becomes verified)
-- Rollback: drop index public.users_login_email; alter table public.users drop column login_email;
--   alter table public.otps drop column send_to;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.users add column if not exists login_email text;
create unique index if not exists users_login_email on public.users (lower(login_email)) where login_email is not null;
alter table public.otps add column if not exists send_to text;

notify pgrst, 'reload schema';
select 'Portal step 11 done · users.login_email ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'login_email')
  || ' · otps.send_to ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'otps' and column_name = 'send_to') as done;
