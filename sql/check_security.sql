-- RCL Portal – security check (READ ONLY: changes nothing). Run in the Portal's Supabase → SQL Editor.
-- Every line of the answer must say OK. A line saying PROBLEM names what to fix.
with t as (
  select c.relname, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
), g as (
  select table_name, string_agg(distinct grantee || ':' || privilege_type, ', ') as grants
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
  group by table_name
), f as (
  select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select 'table ' || t.relname || ': row security ' ||
       case when t.rls then 'on – OK' else 'OFF – PROBLEM' end as check_line from t
union all
select 'table ' || t.relname || ': browser keys (anon / authenticated) ' ||
       case when g.grants is null then 'have no access – OK' else 'can ' || g.grants || ' – PROBLEM' end
from t left join g on g.table_name = t.relname
union all
select 'function ' || f.proname || ': ' ||
       case when f.anon_exec or f.auth_exec then 'browser keys can run it – PROBLEM'
            when f.prosecdef and f.cfg not like '%search_path=%' then 'runs as owner without a fixed search_path – PROBLEM'
            else 'OK' end
from f
union all
select 'Super Admin: ' || case (select count(*) from public.users where is_super)
         when 0 then 'not yet (first start not done) – OK before the import'
         when 1 then 'exactly one – OK' else 'more than one – PROBLEM' end
union all
select 'passwords kept as plain text: ' ||
       case (select count(*) from public.users where password_hash is not null and password_hash !~ '^(tmp\$)?(scrypt\$|sha256\$)')
         when 0 then 'none – OK' else (select count(*) from public.users where password_hash is not null and password_hash !~ '^(tmp\$)?(scrypt\$|sha256\$)')::text || ' – PROBLEM (give them a one-time password)' end
union all
select 'signing keys stored locked: ' ||
       case when (select count(*) from public.signing_keys where private_sealed !~ '^v1\.') = 0 then 'yes – OK' else 'NO – PROBLEM' end
order by 1;
