-- =====================================================================
-- Portal. Step 13 (14-11-2026): THE BRAND – the product's name, line and logo, and each client company's logo, kept in the Portal
-- so that the Super Admin changes them himself, with no change of code.
-- Asked 14-11-2026: "aple app ch name change kraych aahe ani logo pn – Sketchline Lion … app aso web aso … ata super admin multiple
-- changes kru shakel, pratek weli code change krne garjech nahi … RCL ha Sketchline cha client aasel, login zale nantr Sketchline
-- Lion ha logo pn asel ani client cha logo pn".
-- WHERE: Supabase → the PORTAL's project → SQL Editor → paste the whole file → Run. After step 12. Safe to run twice.
-- WHAT:  TWO new tables, nothing existing is changed:
--   public.brand        – ONE row ("product"): the product's name in two parts ("Sketchline" + "Lion") and the line under it
--   public.brand_files  – the pictures themselves, small (a logo, the opening screen's photo, one logo for each company):
--                         "logo", "photo", "co-<company id>". Read only by the Portal's server, which hands them to the pages
--                         and the app (a logo is shown before the sign-in too, so it is given without one; nothing else is).
-- Until it is run, the web and the app show the name and logo built into them ("Sketchline Lion") and the Portal's page
-- "Branding" says this file must be run first.
-- Rollback (only while the built-in name and logo are wanted again): drop table public.brand_files, public.brand;
-- =====================================================================
create table if not exists public.brand (
  id text primary key check (id = 'product'),
  first text not null check (length(first) between 1 and 24),
  second text not null default '' check (length(second) <= 24),
  line text not null default '' check (length(line) <= 60),
  updated_by text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.brand_files (
  name text primary key check (name ~ '^(logo|photo|co-[A-Z0-9]{1,20})$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  data text not null check (length(data) between 1 and 1400000),      -- the picture as base64 (at most about 1 MB)
  updated_by text not null default '', updated_at timestamptz not null default now()
);
alter table public.brand enable row level security;
alter table public.brand_files enable row level security;
revoke all on public.brand, public.brand_files from public, anon, authenticated;
grant select, insert, update on public.brand to service_role;
grant select, insert, update, delete on public.brand_files to service_role;      -- "Remove the logo" takes its row away (the built-in one shows again)

notify pgrst, 'reload schema';
select 'Portal step 13 done · brand ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'brand')
  || ' · brand_files ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'brand_files') as done;
