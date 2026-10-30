# RCL ERP – Portal

One sign-in for every RCL ERP module (Mechanical first; Store, Engineering … later).

* **Everyone signs in here.** The Portal shows each person his own modules, site by site. A person with exactly one module on one site goes straight into it.
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
| Database (run once each, in order, in the Portal's own Supabase project) | `sql/portal_step1.sql`, `sql/portal_step2_start.sql` ("My start"), `sql/portal_step4_usage.sql` (with Mechanical's update-158: how full the database is – Sites → Storage), `sql/portal_step5_site_papers.sql` (29-10-2026: a site's address and contact – the Store's papers), `sql/portal_step6_rules.sql` (29-10-2026: a site's workflow – what goes to Head Office) |
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
