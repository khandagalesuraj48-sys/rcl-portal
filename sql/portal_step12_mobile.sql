-- =====================================================================
-- RCL ERP – Portal. Step 12 (13-11-2026): A MOBILE NUMBER ON A USER – the second thing a person signs in with.
-- Asked 13-11-2026: "LOGIN EMAIL PLUS MOBILE NUMBER – EMAIL WAR GELA USER TR OTP JAIL … ANI MOBILE NUMBER GELA TR PASSWORD NI
-- LOGIN"; "EMAIL MOBILE ASEL TR 2 TYPE NI SIGN IN HOIL, 2 NI PAIKI EK ASEL TR EKACH PADHTINE"; "SYSTEM MADHE … NASEL TR LOGIN NAHI".
-- WHERE: Supabase → the PORTAL's project → SQL Editor → paste the whole file → Run. After step 11.
-- WHAT:  ONE new column, users.mobile (10 digits, empty for everybody of today) – a number belongs to ONE user.
--        Nothing existing is changed, nothing is deleted. Safe to run twice.
--        Until it is run, everything works exactly as before (sign-in with the e-mail); a mobile number is simply not known.
-- Rollback (only while no number is kept):  drop index if exists public.users_mobile;  alter table public.users drop column if exists mobile;
-- =====================================================================
alter table public.users add column if not exists mobile text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_mobile_ok') then
    alter table public.users add constraint users_mobile_ok check (mobile is null or mobile ~ '^[6-9][0-9]{9}$');
  end if;
end $$;
create unique index if not exists users_mobile on public.users (mobile) where mobile is not null;

notify pgrst, 'reload schema';
select 'Portal step 12 done · users.mobile ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'mobile') as done;
