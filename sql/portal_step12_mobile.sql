-- =====================================================================
-- RCL ERP – Portal. Step 12 (13-11-2026): A USER'S MOBILE NUMBER – the second thing a person can sign in with.
-- Asked 13-11-2026: "LOGIN EMAIL PLUS MOBILE NUMBER … EMAIL WAR GELA USER TR OTP JAIL … MOBILE NUMBER GELA TR PASSWORD NI LOGIN …
-- 2 NI PAIKI EK ASEL TR EKACH PADHTINE HOIL … SYSTEM MADHE EMAIL N MOBILE NASEL TR LOGIN NAHI HA STRICT RULE".
-- WHERE: Supabase → the PORTAL's project → SQL Editor → paste the whole file → Run. After step 11. Safe to run twice.
-- WHAT:  ONE new column on the table of users: mobile (empty for everybody today). A number is ten digits beginning with
--        6 to 9, and belongs to ONE user – the database itself refuses a second one.
--        Nothing existing is changed: no user, no password, no access. Until a mobile number is put on a user (HR does it when
--        it gives an employee his sign-in), everybody signs in exactly as before.
-- Rollback (only while no user has a mobile number): drop index if exists public.users_mobile;
--        alter table public.users drop constraint if exists users_mobile_ok; alter table public.users drop column if exists mobile;
-- =====================================================================
alter table public.users add column if not exists mobile text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_mobile_ok' and conrelid = 'public.users'::regclass) then
    alter table public.users add constraint users_mobile_ok check (mobile is null or mobile ~ '^[6-9][0-9]{9}$');
  end if;
end $$;
create unique index if not exists users_mobile on public.users (mobile) where mobile is not null;

notify pgrst, 'reload schema';
select 'Portal step 12 done · users.mobile ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'mobile')
  || ' · users with a mobile number: ' || (select count(*) from public.users where mobile is not null) as done;
