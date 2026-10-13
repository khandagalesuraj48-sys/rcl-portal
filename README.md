# RCL ERP – Portal

One sign-in for every RCL ERP module (Mechanical first; Store, Engineering … later).

* **Everyone signs in here.** The Portal shows each person his own modules, site by site. A person with exactly one module on one site goes straight into it.
* **The Super Admin** designs the system here and only here: users, which module each user may open on which site (Admin / User / No access), sites, companies, modules, the activity log. He opens no module himself.
* **Opening a module:** the Portal hands the module a one-minute signed ticket (`/api/go` → `<module>/#sso=…`). The module checks the signature with the Portal's public key (`/api/jwks`). No password travels to the module.
* **My start:** on his dashboard a person marks one module ("☆ Open this at sign-in"); from then on that module opens straight after he signs in. One module on one site opens straight away anyway.
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
