-- =====================================================================
-- RCL ERP Portal – step 8: the ADVERTISE CORNER (11-11-2026, his words: "Rachana Media & Celebration Hub … Super Admin kadun mi ekach
-- veli anek Posts, Images, Animated Videos ani Announcements upload karu shaken … he aple advertise corner asel"; "super admin tharau
-- shakel vedio app web kuthe show kraych aahe size swata tharau shakel … period wise day wise timing wise")
-- Run once in Supabase → SQL Editor, in the Portal's project. Safe to run again.
-- It only ADDS one table and one PRIVATE place for files. Nothing that is there today is changed:
--   public.ads          – one row = one post: its name and kind, its image or video, its size (strip / banner / card / full),
--                         where it shows (app, web), its period (from – to), its days of the week, its hours, how long a slide
--                         stays, which sites and which company see it, its place in the order, Active / Inactive
--   storage bucket ads  – the images and videos themselves: PRIVATE (never public, never in git); a person signed in gets a link
--                         that works for a short time. At most 25 MB a file; images (jpeg, png, webp, gif) and videos (mp4, webm).
-- Until it is run, the Portal, the web and the app work exactly as before (no post is shown) and the Advertise Corner says this
-- file must be run first.
-- A post is never deleted by the Portal: it is made Inactive.
-- Rollback (only while no post is wanted any more): drop table public.ads;  and in Storage, empty and delete the bucket "ads".
-- =====================================================================
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  kind text not null default 'notice' check (kind in ('festival', 'birthday', 'achievement', 'notice', 'campaign')),
  media text not null check (media in ('image', 'video')),
  path text not null,                                   -- the file in the bucket "ads"
  poster text,                                          -- a video's still picture (shown first, and on a slow network)
  size text not null default 'strip' check (size in ('strip', 'banner', 'card', 'full')),
  on_app boolean not null default true,
  on_web boolean not null default true,
  date_from date not null,
  date_to date not null,
  days text not null default '1234567' check (days ~ '^[1-7]{1,7}$'),      -- 1 = Monday … 7 = Sunday
  time_from time not null default '00:00',
  time_to time not null default '23:59',
  seconds int not null default 6 check (seconds between 3 and 60),
  sites text[] not null default '{}',                   -- empty = every site
  company text not null default '',                     -- '' = every company
  sort int not null default 0,
  active boolean not null default true,
  created_by text not null default '', updated_by text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (date_to >= date_from)
);
create index if not exists ads_live on public.ads (active, date_from, date_to);
alter table public.ads enable row level security;
revoke all on public.ads from public, anon, authenticated;
grant select, insert, update on public.ads to service_role;      -- no delete: a post is made Inactive
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ads', 'ads', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
  on conflict (id) do nothing;
notify pgrst, 'reload schema';
select 'Portal step 8 done · table ads ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ads')
  || ' · bucket ads ' || (select count(*) from storage.buckets where id = 'ads' and public = false) as result;
