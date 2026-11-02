-- =====================================================================
-- RCL ERP Portal – step 7: the BETA channel (02-11-2026, his words: "ethun pudhe je kahi asel agodr testing hoil as like beta version …
-- mi kahi user la testing sathi deu shakel nantr … other la pn app web stable deu shakel … je cuurent chalu aahe te bighdnar nahi")
-- Run once in Supabase → SQL Editor, in the Portal's project. Safe to run again.
-- It only ADDS two columns. Nothing else is changed; nobody is a tester until the Super Admin ticks him; a module without a beta
-- link opens as today for everybody:
--   users.tester     – a tester opens the BETA copy of each module that has one (web and app), everybody else the stable one
--   modules.beta_url – the address of the module's beta copy (Portal → Modules)
-- Until it is run, the Portal works exactly as before (no tester, no beta link) and says this file must be run first.
-- Rollback (only while nobody is a tester and no module has a beta link): alter table public.users drop column tester;
--   alter table public.modules drop column beta_url;
-- =====================================================================
alter table public.users add column if not exists tester boolean not null default false;
alter table public.modules add column if not exists beta_url text;
notify pgrst, 'reload schema';
select 'Portal step 7 done · users.tester ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'tester')
  || ' · modules.beta_url ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'modules' and column_name = 'beta_url') as result;
