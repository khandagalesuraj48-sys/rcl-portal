-- RCL Portal – step 3: the pages of a module a person may open on a site (set by the Super Admin under Users & Access → Pages).
-- Used by the Store (Dashboard: View / No access; Item Master: Edit / View / No access). Mechanical keeps its pages itself, as
-- before. Supabase (the Portal's project) → SQL Editor → New query → paste → Run. It can be run again safely.
-- It only ADDS one empty column to the access table; no row, no password and no access changes. Empty = every page, as before.
alter table public.access add column if not exists pages jsonb;
comment on column public.access.pages is 'The pages of the module (e.g. {"dashboard":"View","items":"Edit"}); empty = every page.';
notify pgrst, 'reload schema';
select 'Portal step 3 done · access ' || (select count(*) from public.access) || ' · column pages ' ||
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'access' and column_name = 'pages') then 'there' else 'MISSING' end as done;
