-- =====================================================================
-- RCL ERP Portal – step 9: the Advertise Corner – ONE STRIP, FITTED FOR THE WEB AND FOR THE APP (12-11-2026, his words: "jast mothe
-- size thewaychich nahi fkt strip madhe thewaychi … strip web sathi wegli size ani app sathi mobile screen nusar wegli size … fit to
-- strip as ek option de te mi dable ki vedio image web and app nusar set hoil")
-- Run once in Supabase → SQL Editor, in the Portal's project. Safe to run again.
-- It only ADDS one column. Nothing else is changed; the posts of today stay as they are (shown from their middle, as now):
--   ads.fit – how a post's image or video sits in the strip, once for the web and once for the app:
--             { "web": { "x": 50, "y": 50, "z": 1 }, "app": { "x": 50, "y": 50, "z": 1 } }
--             x, y = which part is kept in view (0 – 100 %, 50 = the middle); z = how much bigger (1 – 4)
-- Until it is run, the Advertise Corner works as before; "Fit to strip" then says this file must be run first.
-- Rollback (only while no post is fitted): alter table public.ads drop column fit;
-- =====================================================================
alter table public.ads add column if not exists fit jsonb;
notify pgrst, 'reload schema';
select 'Portal step 9 done · ads.fit ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'fit') as result;
