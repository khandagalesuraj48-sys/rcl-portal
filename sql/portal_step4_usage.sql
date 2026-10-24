-- =====================================================================
-- RCL ERP Portal – step 4: how full this database is (with Mechanical's update-158, asked 24-10-2026)
-- Run once in Supabase → SQL Editor, in the Portal's project, AFTER portal_step3_pages.sql. Safe to run again.
-- It only ADDS one function, web_usage(): the size of this database and of its files (the phone app's files too) – it only READS.
-- Only the server (the secret key) can call it. The Super Admin sees it in the Portal (Sites → Storage).
-- No table, row or rule is changed. Until it is run, Storage says this file must be run first.
-- Rollback: drop function public.web_usage();
-- =====================================================================
-- the size of this database and of its files (how many, how big, per place) – it only reads
create or replace function public.web_usage()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'db', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'files', coalesce((select jsonb_agg(jsonb_build_object('bucket', b, 'n', n, 'bytes', s) order by b) from (
        select bucket_id as b, count(*) as n,
               coalesce(sum(case when (metadata->>'size') ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end), 0) as s
          from storage.objects group by bucket_id) x), '[]'::jsonb),
    'at', now());
$$;
revoke all on function public.web_usage() from public, anon, authenticated;
grant execute on function public.web_usage() to service_role;
notify pgrst, 'reload schema';
