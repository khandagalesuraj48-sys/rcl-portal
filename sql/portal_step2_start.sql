-- RCL Portal – step 2: the module a person opens straight after signing in (his own choice, "My start").
-- Supabase (the Portal's project) → SQL Editor → New query → paste → Run. It can be run again safely.
-- It only ADDS one empty column to the users table; no row, no password and no access changes.
alter table public.users add column if not exists start_item text;      -- 'module|SITE', e.g. 'mechanical|S1'; empty = none
comment on column public.users.start_item is 'The module and site that open right after sign-in (chosen by the person on his dashboard).';
notify pgrst, 'reload schema';
select 'Portal step 2 done · users ' || (select count(*) from public.users) || ' · column start_item ' ||
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'start_item') then 'there' else 'MISSING' end as done;
