# RCL ERP – Portal

One sign-in for every RCL ERP module (Mechanical first; Store, Engineering … later).

* **Everyone signs in here.** The Portal shows each person his own modules, site by site. A person with exactly one module on one site goes straight into it.
* **The Super Admin** designs the system here and only here: users, which module each user may open on which site (Admin / User / No access), sites, companies, modules, the activity log. He opens no module himself.
* **Opening a module:** the Portal hands the module a one-minute signed ticket (`/api/go` → `<module>/#sso=…`). The module checks the signature with the Portal's public key (`/api/jwks`). No password travels to the module.
* **My start:** on his dashboard a person marks one module ("☆ Open this at sign-in"); from then on that module opens straight after he signs in. One module on one site opens straight away anyway.
* **A new site (Super Admin → Sites → + New site):** he makes the site's Supabase project himself, then gives its link here.
  "Check & set up" works through a checklist and says what to do at each step. The site's secret key goes only into Vercel
  (Mechanical's project) as `SITE_<CODE>_KEY`, never here. The SQL is copied from the form into that project's SQL Editor.
  Mechanical's company settings come over with the new name; no data and no users. The site stays Closed until it is Ready, then Active.
  No code change is needed for a new site.
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
```
