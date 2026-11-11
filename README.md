# RCL ERP – Portal

One sign-in for every RCL ERP module (Mechanical first; Store, Engineering … later).

* **Everyone signs in here.** The Portal shows each person his own modules, site by site. A person with exactly one module on one site goes straight into it.
* **The sign-in look (11-11-2026, his pick from the pictures: "orbit 1 number mast aahe … screen white aswi", "ha character ok
  aahe", "he fkt web sathi aahe"):** a white page; on the left the One Click Solution logo in two rings with the modules'
  pictures going round (`public/login/*.png` – Microsoft Fluent Emoji, MIT); on the right the card – the company's logo
  (`public/login/company-logo.png`: another company = its own file), "Sign in", Email, Password, the blue button, "Forgot
  password?" (opens the help and the Super Admin's recovery link that were always there) – and our own character looking over the
  card: its eyes follow the email, it covers them while the password is typed, looks with one eye when the password is shown.
  Look only: the form, its checks and the sign-in call are as before; the character is told a count of letters, never the
  password. No movement with "reduce motion". Web only (the phone app has its own sign-in).
  **On a phone's browser** the orbit is on top (smaller, turning) and the card under it; while a box is typed in, the page folds to
  the character, the two boxes and the button, so they stay above the keyboard (iPhone SE … Pixel sizes tried).
  **After sign-in** the person goes straight into the ERP under a white loading look (`#go_boot`, the same as Mechanical's
  update-224): "My start", else the module opened last from here, else Machinery, else his first; the Portal's own page is one
  click away (a module's "Modules" button). The Super Admin opens his console as before.
* **A sign-in stays until "Sign out" (18-10-2026, asked: "user jo prynt log out krt nahi to prynt log in rahil mg app aso ki
  web").** No more "6 hours without use" and no more "30 days" – on the web, in the phone app and in the Windows app. It ends
  only at "Sign out" (here or in a module), when the Super Admin switches the person off or gives him a new password, or when
  the person changes his password (`lib/session.js`). A browser keeps a cookie 400 days at most, so the cookie and the sign-in's
  end are moved on while it is used: only a sign-in left unused for 400 days ends by itself. The modules' own sign-ins stay as
  they are; when one ends, the module gets a new ticket from this sign-in by itself – nothing is typed.
  **A lost phone:** the Super Admin gives that person a new password (or switches him off) – every sign-in of his ends at once.
* **The Super Admin** designs the system here and only here: users, which module each user may open on which site (Admin / User / No access), sites, companies, modules, the activity log.
  **(14-10-2026)** He also opens every module of every site, as its Admin: "Dashboard" in his console's menu on the left (or
  "Open modules" under his name, top right) shows them all (and "Super Admin console" goes back). A module creates him as its
  Admin on that site the first time he opens it.
  **The console's look (23-10-2026, from his picture – "fkt ui changes", every function the same):** a navy menu on the left
  (a ☰ button on a phone), a top bar (search, Activity, his name → Open modules / My account / Sign out), Users & Access with
  its counts and filters (Site, Module, Status, search) and a ⋯ menu on each row; a row's **Save** shows once something in it is
  changed. One user's page: **Module Access** (the pages below), **User Details**, **Login Activity** (his lines of the Activity).
  My Account: his details, Change Password (the same check as before), Sign-in Recovery (how the recovery code is used).
* **Pages (Users & Access → his name → Module Access, or ⋯ → Module access):** one **Save changes** saves both below.
  * Mechanical: Edit / View / No access per page, kept in Mechanical (as before).
  * **Diesel sources (with Mechanical's update-162, 26-10-2026):** for a Mechanical User, a tick for each diesel place of the
    site under **Diesel Issue – source** and **Diesel Transfer – From**: he gives diesel only FROM a ticked place (a transfer may
    go TO any place; Diesel Inward: anyone with that page). All ticked = every place, also one added later (as before – what
    every person has until something is unticked). Kept in Mechanical, in the site's own database; Mechanical checks every save.
    An Admin has every source.
  * **Store (14-10-2026):** for a Store User – Dashboard (View / No access) and Item Master (Edit = add / View = see and export /
    No access). Kept with his access line here (`access.pages`, **SQL step 3: `sql/portal_step3_pages.sql`**), carried in his
    ticket, applied by the Store at his next opening. A Store Admin has every page.
    **(28-10-2026, the Store's step 2)** the new pages – Material Requirements, Inward (GRN), Issue & Return (Edit / View / No access),
    Stock & Reports, Purchase Orders (View / No access) – not given = No access; and two that a **Store Admin too** gets only when given:
    **Approves requirements** (No / Level 1 … 5: Level 1 approves first, then 2 …; any one person of a level; never his own) and **Store
    Purchase – every site (HO)** (the purchase orders of every site; the Super Admin has it always). Whenever a user's Store pages or
    role are saved, the Store of that site is told who approves (a 60-second signed ticket, `aud` "store-admin", act "approvers" →
    the Store's `api/portal`); when it could not be told, the save says so ("save again in a moment"). No SQL step.
    **(28-10-2026, the Store's step 5)** one more that a Store Admin too gets only when given: **Approves purchase orders** (None /
    Yes) – a PO made at that site then waits for one of them (never his own); nobody ticked = a PO is approved when made. Told to the
    Store in the same approvers ticket (`po`, the emails). No SQL step.
* **Opening a module:** the Portal hands the module a one-minute signed ticket (`/api/go` → `<module>/#sso=…`). The module checks the signature with the Portal's public key (`/api/jwks`). No password travels to the module.
* **My start:** on his dashboard a person marks one module ("☆ Open this at sign-in"); from then on that module opens straight after he signs in. One module on one site opens straight away anyway.
* **A new site (Super Admin → Sites → + New site):** he makes the site's Supabase project himself, then gives its link here.
  "Check & set up" works through a checklist and says what to do at each step. The site's secret key goes only into Vercel
  (Mechanical's project) as `SITE_<CODE>_KEY`, never here. The SQL is copied from the form into that project's SQL Editor.
  Mechanical's company settings come over with the new name; no data and no users. The site stays Closed until it is Ready, then Active.
  No code change is needed for a new site.
* **Diesel places of a site (with Mechanical's update-117, 16-10-2026):** where diesel is kept – the pump, each dispenser, a
  store – each with its tank size (18B: Camp Pump 18,000 Ltr; MH12ZE1739 and MH12WJ1381 2,650 Ltr each). Given in "New site"
  (step 6) and changed under **Sites → Diesel places** (the stock now is shown). Mechanical keeps them in the site's own database
  and checks them: a place that has entries keeps its name and cannot be removed. A site without its own places has the first
  site's Dispenser + VTR Store.
  **Fuel of each place (with Mechanical's update-163, 26-10-2026):** Diesel, Petrol or CNG (a place of before is Diesel; HO: one
  place per fuel card – DIESEL CARD, PETROL CARD, CNG CARD). Mechanical gives a machinery fuel only from a place of its fuel
  (Asset Master → Fuel) and transfers only between places of one fuel; a place that has entries keeps its fuel. CNG is in kg.
  **How fuel is given (with Mechanical's update-164, 27-10-2026):** *From diesel places (stock)* – as above – or **Fuel cards – no
  stock** (HO): the site keeps no diesel stock, its places are not used, each fill is paid by a fuel card or in Cash with its ₹
  (the cards and their opening balance are made in Mechanical → Fuel Cards). Kept in the site's own settings (`mode` with
  `placesSave`); once a fill was paid by a card or in Cash the site stays on fuel cards (Mechanical refuses going back, the screen
  shows it). Only such a site lists the page **Fuel Cards** in Users & Access → Pages (and no Diesel Inward / Transfer).
* **Change, switch off, delete (Super Admin):**
  * **Sites:** Closed = switched off, nobody can open it. Only a Closed site can be deleted, and only with its code typed again.
    It leaves the lists here and in Mechanical, with the access given on it. Its own database (its data) is never touched:
    "New site" with the same link brings it back. The first site cannot be deleted.
  * **Companies:** can be changed, and deleted while no site belongs to them.
  * **Modules:** name, link and Live/Off can be changed. Only an Off module can be deleted, and only with its key typed again;
    the access given to it goes too. Mechanical cannot be deleted.
  * **Users & Access:** pick a Site and a Module ("All modules" or one) – only that module's column shows.
* **A new module** (e.g. Store) is its own GitHub repository and its own Vercel project. Its Vercel address goes under Modules
  → Link, and it is set Live.
* **From inside a module** the "Modules" button comes back to `/?menu=1` – the person's own dashboard – without signing in again.

## The papers' heading in the Store's ticket; a site's address and contact (29-10-2026; the Portal's step 5)
His words: "mala te kahi save karayla nko sangu … mi agodar sagle save keley" and "jewa site option ahe portal madhe tithech site address
and contact number name he option de … baki company details same". **The Store's ticket now brings the papers' heading** (`api/go.js`
`paperOf`, the claim `paper`): the site's company as given under Companies (name, address, GSTIN, PAN, logo) and the site's own
**address, contact name and contact number** – new under each site in **Sites** (saved with its Save; `api/admin.js` `siteSave`,
`overview`). Nothing is saved anywhere else: every opening of the Store, and its fresh ticket every 10 minutes, brings them as they are
here. The Store prints them (the PO's Shipping Address and Site Contact, the requirement's contact, the heading) – rcl-store's
`headingOf`. **Database: `sql/portal_step5_site_papers.sql`** – once, in the Portal's Supabase: it only adds the three empty columns; until
then a site saves as before and its address / contact say the step is needed. Tests: unit 17/17; the rig's `test/api.test.js`;
rcl-store's `test/reqindent.test.js`.

## The beta channel and "Give to everybody" (02-11-2026; the Portal's step 7)
His words: "ji erp apli chalu aahe ti live aahe ethun pudhe je kahi asel agodr testing hoil … mi kahi user la testing sathi deu shakel
nantr … other la pn app web stable deu shakel … je cuurent chalu aahe te bighdnar nahi"; "jewa stable war jaych asel tewa mala version
wise button de je dable ki auto app updet push hoil stable war web updet hoil mhanje prateklk weli code changes nko ani tula sarkhe nko
sangahla".
* **Testers** (Users & Access → the person → User Details → **Tester**; written in the Activity; a "Beta" mark in the users list): a
  tester opens the **beta copy** of a module (Modules → **Beta link**) – on the dashboard, through `/api/go` and in the app (the
  `me` answer gives his links and `user.tester`). Everybody else, and every module with no beta link, stays on the stable link.
  Unticked: stable again at his next opening. (`lib/beta.js`)
* **Versions** (a new tab): the app's releases (GitHub Releases of `rcl-mobile`) – **Beta – testers** (a pre-release made by the app's
  workflow `beta`, with the exact commits of the web modules' branches `beta`) and **Stable – everybody** (the newest that is not
  beta). **New beta version** asks that workflow to run (`betaNew`, in the Activity): it takes what is in the branches `beta` now,
  builds the app only when it changed (else a version of the **web only** – no app, no phone update) and tells the testers' phones;
  it shows in the list in about 10 – 15 minutes. A beta version newer than the stable one has **Give to everybody (Stable)** – the
  version typed to confirm. It (`lib/releases.js`, the Super Admin only, one press at a time – `portal_hit`):
  1. checks every repository first: its `main` must be able to move **forward** to the tested commit – else nothing is done and it says
     which and why (a change on `main` the version does not have must go through beta first);
  2. moves each web module's `main` to the very commit the testers used (Vercel deploys it as the live site by itself), the app's
     repository last;
  3. makes the release the stable one – with an app in it GitHub's "latest" (every phone's update takes it); a version of the web
     only is never "latest" (the phones' update must always find an app there); 4. with an app: tells every phone once (the app's
     workflow `tell`).
  Pressed again: nothing more. In the Activity ("Version made stable": who, what moved). No code change and no new build for it.
* **Settings (Vercel → the Portal, never in a file):** `GITHUB_RELEASE_TOKEN` – a fine-grained GitHub token: Contents read-write on
  the ERP's repositories, Actions read-write on `rcl-mobile`. (`GITHUB_OWNER`, `RCL_WEB_REPOS`, `RCL_APP_REPO` only if they ever
  change.) Without it the versions show and the button says the key is missing.
* **Database: `sql/portal_step7_beta.sql`** – once, in the Portal's Supabase: it only adds `users.tester` (false) and `modules.beta_url`
  (empty). Until then everybody is stable, as today, and the tester switch says the step is needed.
* Tests: unit 19/19; the rig's `test/beta.rig.test.js` (2/2, with `test/github-standin.js` – nothing reaches GitHub) and
  `test/beta.e2e.rig.test.js` (2/2: the beta copies of Mechanical and the Store next to the stable ones, on databases with no test mark).

## The Store's workflow: who verifies, who approves, what goes to Head Office (29-10-2026; the Portal's step 6, the Store's step 9)
His words: "pratek kamamadhe … entry krnarana to verification la pathawel … verification kel tr te auto jyanche kadhe approval aahe
tyanche kade jail … approval zal ki te direct head office la jail … he sagle kam super admin swatache portel madhun krel"; "pratek task
approval nantr HO la nahi janar – konte jail konte nahi jail te super admin tharau shakel".
* **Per person** (Users & Access → the person → Pages in the Store; a Store Admin too, only when given): **Verifies requirements**,
  **Verifies purchase orders**, **Verifies GRN (Inward)**, **Approves GRN (Inward)**, **Verifies issues & returns**, **Approves issues
  & returns** (None / Yes) – with Approves requirements (Level 1 … 5) and Approves purchase orders as before. No SQL step.
* **Workflow** (a new tab): for each work of a site who verifies it and who approves it (from the pages above), and **once approved →
  Head Office: Yes / No** – requirements (Yes: HO Purchase makes the PO; No: the site buys it itself – its Store Admin), GRNs (the
  suppliers' bills, checked with their PO), issues & returns. Saved per site in `sites.rules` (`rulesSave`, written in the activity).
  Not set: requirements to HO, nothing else – as before.
* **The Store is told** with the approvers' ticket it already gets (`storeTell`: `wf` = who verifies / approves each work and the Head
  Office choices) after a person's pages, his access or the Workflow is saved. A site whose Store has not run its step 9 yet: saved and
  told, and the Super Admin is told what to run there (`NOTE9`).
* **Database: `sql/portal_step6_rules.sql`** – once, in the Portal's Supabase: it only adds the empty column `rules` to the sites. Until
  then the Head Office choices say the step is needed; who verifies and approves works without it.
* Tests: unit 18/18; the rig's `test/api.test.js` (130/130); rcl-store's `test/workflow.test.js`, `test/workflow.browser.test.js`.

## The papers' company: told to Mechanical (29-10-2026, with Mechanical update-193; no database step)
His requirement printed with an empty heading – no logo, no company name, no address. The papers of the modules (the Store's PO and
Purchase Requisition Form) read a site's company from **Mechanical's list of sites** (its first site's `rcl_sites` / `rcl_companies`),
which only "New site" wrote, with the company's name alone – the first site had none, and a company or a site's company saved here never
reached it. Now `api/admin.js` `papersTell` tells Mechanical (act `papers`, the same signed ticket as "New site") whenever **Companies →
Save** (name, address, GSTIN, PAN, logo) or **Sites → Save** (that site's company; none = none) is pressed, and after "New site" is
ready. Mechanical not reachable (or not updated yet): the Portal's save stands and the toast says "save again in a minute". A company
deleted here stays in Mechanical's list (nothing deleted there). Merge Mechanical's update-193 first. Tests: unit 16/16; Mechanical's
`test/papers193api.js` on the rig.

## 🎙 Speak into a box (29-10-2026; no database step)
Asked: "jithe jithe type krun entry hotat … tithe voice mick banaw user apla voice madhe bolel … text madhe add krel ok hindi english
marathi"; his answers: the app AND the website; words and numbers. The block "SPEAK INTO A BOX" inside `public/index.html` (the Portal
keeps every script in its page; the same code as the Store's and Engineering's `voice.js`, inline in Mechanical): a box where an entry is
typed, when it is in use, shows a 🎙 at its right end; the browser's own speech recognition listens in **मराठी / हिंदी / English**
(chips; the one chosen is kept in the browser); the words go in as typed – a number box gets the number ("साडे तीन हजार" → 3500), a phone
box the digits. Never in a password box. `vercel.json`: `microphone=(self)` (the camera and the place stay off). Tests: unit (the
number cases, the block in the page, the rule); `test/voice.browser.test.js` 21/21; the rig's `test/browser.test.js` 34/34.

## Parts
| Part | File |
|---|---|
| The page (sign-in, first start, Super Admin console, dashboard) | `public/index.html` |
| Sign-in, sign-out, own password, Super Admin recovery code | `api/auth.js` |
| Super Admin console (Super Admin only) | `api/admin.js` |
| Open a module (the ticket; `renew=1`: the Store's / Engineering's page keeping its 15-minute sign-in fresh – not written in the Activity record again) | `api/go.js` |
| Public keys for the modules | `api/jwks.js` |
| First start: bring users over from Mechanical, once | `api/setup.js` |
| Passwords (the same format as Mechanical), sessions, signing keys | `lib/pw.js`, `lib/session.js`, `lib/keys.js` |
| Database (run once each, in order, in the Portal's own Supabase project) | `sql/portal_step1.sql`, `sql/portal_step2_start.sql` ("My start"), `sql/portal_step4_usage.sql` (with Mechanical's update-158: how full the database is – Sites → Storage), `sql/portal_step5_site_papers.sql` (29-10-2026: a site's address and contact – the Store's papers), `sql/portal_step6_rules.sql` (29-10-2026: a site's workflow – what goes to Head Office), `sql/portal_step7_beta.sql` (02-11-2026: testers and the modules' beta links) |
| Security check (read only) | `sql/check_security.sql` |

## Settings (Vercel → Project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `SUPABASE_URL` | the Portal's Supabase project URL |
| `SUPABASE_SECRET_KEY` | that project's secret key |
| `PORTAL_SECRET` | 48 random bytes (base64); locks the signing key. Never change it after the first start. |
| `MECH_URL`, `MECH_KEY` | Mechanical's first-site Supabase – only for the first-start import; can be removed afterwards |
| `MECH_APP_URL` | Mechanical's web address (e.g. `https://rclerp.vercel.app`) |
| `BACKUP_EXPORT_SECRET` | (with Mechanical's update-157) a long secret word (at least 24 letters and digits) – the SAME value in rclerp and rcl-engineering. Mechanical's nightly backup asks `/api/backup-export` with it for the Portal's users (passwords hidden), access, sites, companies, modules and activity record. Not set = nothing is given. |

## Tests (local test rig only – never the live databases)
```
timeout 120 node --test test/unit.test.js     # no database
timeout 300 node test/api.test.js             # rig: Portal :3010 + its database, Mechanical :3000 / :3100
timeout 300 node test/browser.test.js         # rig + Chromium (Playwright); pictures in test/shots/
timeout 400 node test/keep18.js               # after browser.test.js: the sign-in stays until "Sign out" (the next morning: back in, nothing typed)
timeout 300 node test/safe155.test.js         # rig: lost answers, a new key in /api/jwks at once (starts its own Portal on :3011; SRC=<tree>)
```

## No second copy (24-10-2026, with Mechanical's update-155)
* **A new row** (a user, an access line, a company, a session …) **is not sent twice:** after no answer at all from the database it
  may have been saved – the person is told to look. A change, a delete, the sign-in counts and a new row that never left this
  server (no connection at all) are asked again as before.
* **`/api/jwks` is not kept in this server's memory** (looked at and left as it is): Vercel runs several Portal servers, and a key
  one of them makes must be in every server's answer at once – the modules ask again for a key they do not know yet.

## One address (13-10-2026)
The Portal is also served under the main address, `https://oneclicksolution-erp.vercel.app/portal/`. Mechanical's
`vercel.json` rewrites `/portal/:path*` here.
* **The page:** every address it uses is relative (`api/…`, `oc-logo.webp`, `favicon.png`).
* **The server:** its redirects are relative too (`../?next=api/go…`), so they are right at either address.
* **`PUBLIC_URL`** (an address, not a secret): `https://oneclicksolution-erp.vercel.app/portal`.
  * It is the ticket's issuer (`iss`); the modules' `PORTAL_URL` must be the same.
  * The page at that address passes the origin check.
* **`/api/go?…&page=KEY`:** the page travels on after the ticket (`#sso=…&page=KEY`).
* **The ticket's `mods`** carry each module's address (`url`), so a module can show the others' pages in its menu.
* **The ticket's `super`** (14-10-2026): `true` only for the Super Admin. Mechanical then lets him change entries of a submitted
  bill and approve the changes others send (its Approvals page); every other module ignores it.

## A Preview = the staging (TEST) copy (20-10-2026)
* On a Vercel **Preview** (`VERCEL_ENV=preview`), `lib/preview.js` asks the database first: it must have the row
  `app_settings.THIS_IS_A_TEST_DATABASE = 'yes'`. Only the staging database `rcl-staging` has it.
* A database without it (any live one) is refused with 503, "This is a Preview …". Nothing is read or written.
* The page shows an orange TEST band on a Preview.
* Live (`production`) asks nothing.
* The staging copy is the Preview of the branch `staging`. Its set-up (one SQL for Mechanical + Portal + Store, the Vercel
  Preview settings): `rclerp/staging/STAGING_SETUP.md`.

## The mobile app's versions (14-10-2026)
`POST /api/app { action: 'latest', platform }` (signed-in people only) answers with the newest app from the private
Supabase bucket **app-releases**:
* **Android:** `android/latest.json`
  * `{ build, version, file, sha256, notes }`;
  * the APK link it gives works for 10 minutes.
* **iPhone:** `ios/latest.json`
  * `{ build, version, store }`;
  * the store link must be the App Store or TestFlight.

The rcl-mobile release workflow puts the files there; the Portal only reads them. Anything wrong in `latest.json` (a file
outside `android/`, a missing fingerprint, a link to another site) is never given to the phones.

The Portal's home page shows **Download the Android app** when a version is there (for the first install).

## The Advertise Corner (11-11-2026 – the Portal's step 8)
Asked: "Rachana Media & Celebration Hub … he aple advertise corner asel"; "super admin tharau shakel vedio app web kuthe show
kraych aahe size swata tharau shakel … period wise day wise timing wise".
* `sql/portal_step8_ads.sql` – the table `ads` and the PRIVATE bucket `ads` (run by the owner on 11-11-2026).
* `lib/ads.js` – the rules: what a post may be; whether it shows now (its period, days, hours – India's clock – its place, site, company).
* `api/ads.js` – `live` for a person signed in with access to the site; `list`, `uploadUrl`, `save`, `order` for the Super Admin only.
  A file goes from the browser straight to the bucket with a link made for that one file; a post is never deleted (Inactive).
* The console: **Advertise** – "Add images / videos" (several at once, each kept Inactive), then each is set and saved Active.
* `vercel.json` – the page may send a file to, and play a video from, the Portal's Supabase (`connect-src`, `media-src`).
* Shown on the web's Dashboard and the app's Home by their own updates (Mechanical, rcl-mobile).
* (11-11-2026, asked: "mala eth size pn de … ek tool pn de jyatun mi size kami jast perfect banau shakel") **The sizes in pixels** under
  Size – App and Web for the size chosen, this file's own size, "✓ fits" or "its edges will be cut" – and **"✂ Fit the picture"**
  (App / Web): the picture under a frame of the place's shape, moved and made bigger or smaller, cut to exactly that size and kept
  as a new file (a video cannot be cut here: it is made in the size). The App and the Web have different shapes: one post each.
* (12-11-2026, asked: "ek vedio mi set kela aahe … porter madhun play pn hot nahiye") **A video is tried in the browser before it is
  added** (`adPlays`): a file named .mp4 in a form no browser plays ("mp4v" / MPEG-4, HEVC …) is not added – he is told to make it
  as MP4 with H.264 video (AAC sound). A post whose video does not play says so in its preview.
* (12-11-2026 – **step 9**, asked: "jast mothe size thewaychich nahi fkt strip madhe thewaychi … fit to strip as ek option de te mi
  dable ki vedio image web and app nusar set hoil") **One size: the strip** – on the web 1920 × 150 (12.8 : 1), in the app 1080 × 316
  (3.42 : 1); its shape is fixed in each place. **"✂ Fit to strip – Web and App"**: the post's image or video under two frames, moved
  and made bigger; only how it sits is kept (`ads.fit`, `sql/portal_step9_ads_fit.sql`; `lib/ads.js` `fitOf`, `RATIO`) – the file is
  not changed, so a video is fitted too. The sizes Banner / Card / Full screen and the tool that cut a picture's file are gone.
* (12-11-2026, asked: "tya patticha size wadhwata yeil as banw … web sathi ha option nko fkt android and ios app sathi") **In the app
  only a post can be made higher** than the strip – "Fit to strip" → "Height in the app" (strip … tall, up to 9 : 16). Kept with
  the fit (`fit.app.r` = its shape there, 3.42 … 0.56; no new SQL). The web's strip stays as it is.

