-- =====================================================================
-- RCL ERP Portal – step 5: a site's address and its contact (29-10-2026, his words: "jewa site option ahe portal madhe tithech site
-- address and contact number name he option de")
-- Run once in Supabase → SQL Editor, in the Portal's project. Safe to run again.
-- It only ADDS three empty columns to the sites: address, contact_name, contact_phone (Sites → under each site). The Store's papers
-- take them: the purchase order's Shipping Address and Site Contact, the requirement's contact. Nothing else is changed.
-- Until it is run, a site is saved as before (without them) and the page says this file must be run first.
-- Rollback (only while no site has them): alter table public.sites drop column address, drop column contact_name, drop column contact_phone;
-- =====================================================================
alter table public.sites add column if not exists address text;
alter table public.sites add column if not exists contact_name text;
alter table public.sites add column if not exists contact_phone text;
notify pgrst, 'reload schema';
select 'Portal step 5 done · site columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sites'
  and column_name in ('address', 'contact_name', 'contact_phone')) || ' of 3' as done;
