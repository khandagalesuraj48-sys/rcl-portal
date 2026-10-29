-- =====================================================================
-- RCL ERP Portal – step 6: a site's workflow rules – what goes to Head Office once approved (29-10-2026, his words: "pratek task
-- approval nantr HO la nahi janar – konte jail konte nahi jail te super admin tharau shakel")
-- Run once in Supabase → SQL Editor, in the Portal's project. Safe to run again.
-- It only ADDS one empty column to the sites: rules (Portal → Workflow: for the Store – its requirements to HO Purchase, its GRNs and
-- its issues & returns to Head Office – Yes / No each). Nothing else is changed. Empty = as before: requirements to HO Purchase,
-- nothing else to Head Office.
-- Until it is run, the Workflow page shows these as before and says this file must be run first; who verifies and approves is given
-- per person (Users & Access → a person → Module access → Store) and works without it.
-- Rollback (only while no site has them): alter table public.sites drop column rules;
-- =====================================================================
alter table public.sites add column if not exists rules jsonb;
notify pgrst, 'reload schema';
select 'Portal step 6 done · site column rules ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sites'
  and column_name = 'rules') || ' of 1' as done;
