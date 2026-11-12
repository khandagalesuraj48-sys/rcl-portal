-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RCL ERP – PORTAL – STEP 10: sign-in with a code sent by e-mail (OTP), and "is this e-mail really his" (verified)
-- Run ONCE in the PORTAL's Supabase → SQL Editor. It only ADDS three columns and one table: no user, password, access line or
-- sign-in is changed. Safe to run again. Until it is run the Portal works exactly as before (password sign-in only).
--
--   users.email_verified_at   when the person proved the e-mail is his (he typed the code sent to it) – empty = not yet
--   users.email_alerts        how many times he was shown "verify your e-mail"      users.email_alert_at   when last
--   otps                      one row a code: for whom, what for (login / verify), the code's keyed HASH (never the code),
--                             until when, wrong tries, when used. Only the Portal's server reaches it.
-- Rollback (nothing else reads them): drop table public.otps; alter table public.users drop column email_verified_at,
--   drop column email_alerts, drop column email_alert_at;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.users
  add column if not exists email_verified_at timestamptz,
  add column if not exists email_alerts integer not null default 0,
  add column if not exists email_alert_at timestamptz;

create table if not exists public.otps (
  id bigserial primary key,
  email text not null,
  purpose text not null check (purpose in ('login', 'verify')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists otps_email on public.otps (email, purpose, created_at desc);
alter table public.otps enable row level security;
revoke all on public.otps from public, anon, authenticated;
grant select, insert, update on public.otps to service_role;
revoke all on sequence public.otps_id_seq from public, anon, authenticated;
grant usage, select on sequence public.otps_id_seq to service_role;

notify pgrst, 'reload schema';
select 'Portal step 10 done · users columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users'
  and column_name in ('email_verified_at', 'email_alerts', 'email_alert_at')) || ' of 3 · table otps ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'otps') as done;
