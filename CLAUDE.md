# CLAUDE.md – RCL ERP Portal

Read this first, then `README.md`. The same owner and rules as the Mechanical module (`rclerp/CLAUDE.md`); the short version:

## The owner and how to talk to him
* Sujit Mule, MD of Rachana Construction Limited (RCL).
* **Reply in Marathi (Devanagari).** Answer first. Simple. One step at a time.
* "adhi charcha kar" = discuss first, no code. "fkt check kr" = only check, change nothing.

## Rules
1. **Exactly what he asks, nothing extra.** He decides each step.
2. **Simple screens**, clear at a glance.
3. **Live and business-critical:** never delete, reset or overwrite live data; no destructive SQL; no push to `main` / deploy without his yes; a database change is justified and approved separately and he runs the SQL himself; existing features and permissions keep working.
4. **Evidence, not claims:** read the code, run the tests, say plainly what was not run or not verified.
5. **Every shell / test / network command has a `timeout`.** A hang: run the one test alone, find the case, fix it. Never just re-run.
6. **Fix a thing everywhere it is used.**
7. **The repository is PUBLIC** for now: no secret, key, password or personal data in any file. Keys live only in Vercel → Environment Variables and are never pasted in chat.
8. Work arrives as a branch + pull request; he merges; Vercel deploys.

## Decisions that shape this repository (full list: `rclerp/architecture/RCL_ERP_Decisions.md`)
* The Portal is the one sign-in and the one place access is given. Only the Super Admin manages it.
* One module = one repository + one Vercel project + one Supabase project. The Portal has its own database.
* Passwords use Mechanical's exact format (`scrypt$…`, the older `sha256$…`), so people keep their passwords.
* A module trusts a Portal ticket only after checking its ES256 signature with `/api/jwks`, its `aud` (the module key), `exp`, and that its `jti` is used once.
