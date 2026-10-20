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
  **(14-10-2026)** He also opens every module of every site, as its Admin: "Open modules" in his console shows them all (and
  "Super Admin console" goes back). A module creates him as its Admin on that site the first time he opens it.
* **Pages (Users & Access → Pages):**
  * Mechanical: Edit / View / No access per page, kept in Mechanical (as before).
  * **Store (14-10-2026):** for a Store User – Dashboard (View / No access) and Item Master (Edit = add / View = see and export /
    No access). Kept with his access line here (`access.pages`, **SQL step 3: `sql/portal_step3_pages.sql`**), carried in his
    ticket, applied by the Store at his next opening. A Store Admin has every page.
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

## Parts
| Part | File |
|---|---|
| The page (sign-in, first start, Super Admin console, dashboard) | `public/index.html` |
| Sign-in, sign-out, own password, Super Admin recovery code | `api/auth.js` |
| Super Admin console (Super Admin only) | `api/admin.js` |
| Open a module (the ticket) | `api/go.js` |
| Public keys for the modules | `api/jwks.js` |
| First start: bring users over from Mechanical, once | `api/setup.js` |
| Passwords (the same format as Mechanical), sessions, signing keys | `lib/pw.js`, `lib/session.js`, `lib/keys.js` |
| Database (run once each, in order, in the Portal's own Supabase project) | `sql/portal_step1.sql`, `sql/portal_step2_start.sql` ("My start") |
| Security check (read only) | `sql/check_security.sql` |

## Settings (Vercel → Project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `SUPABASE_URL` | the Portal's Supabase project URL |
| `SUPABASE_SECRET_KEY` | that project's secret key |
| `PORTAL_SECRET` | 48 random bytes (base64); locks the signing key. Never change it after the first start. |
| `MECH_URL`, `MECH_KEY` | Mechanical's first-site Supabase – only for the first-start import; can be removed afterwards |
| `MECH_APP_URL` | Mechanical's web address (e.g. `https://rclerp.vercel.app`) |

## Tests (local test rig only – never the live databases)
```
timeout 120 node --test test/unit.test.js     # no database
timeout 300 node test/api.test.js             # rig: Portal :3010 + its database, Mechanical :3000 / :3100
timeout 300 node test/browser.test.js         # rig + Chromium (Playwright); pictures in test/shots/
timeout 400 node test/keep18.js               # after browser.test.js: the sign-in stays until "Sign out" (the next morning: back in, nothing typed)
```

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
