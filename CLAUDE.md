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
  * One exception, his decision of 12-11-2026 ("ADMIN OR SUPER ADMIN BANWEL FKT"): the **HR Admin of a site** gives an EMPLOYEE his
    sign-in from HR (`api/hrlogin.js`) – a one-time password and "My HR" (`hrme`) on that site, nothing else; and a new one-time
    password when he forgot his. It never touches a person who has any other module, the Super Admin, or a switched-off user.
* **Two ways to sign in (12-11-2026):** the password – unchanged – or a code by e-mail (Resend; `RESEND_API_KEY`, `OTP_FROM` and the
  switches `OTP_LOGIN`, `EMAIL_ALERTS` are set by him in Vercel – the key is never asked for). A code only to an active user with a
  verified e-mail; never for the Super Admin; nobody marks an e-mail verified without the code. An unverified e-mail gets a reminder
  every hour – **access is never closed for it**. Changing a user's e-mail is not built (it is his identity in every module).
* One module = one repository + one Vercel project + one Supabase project. The Portal has its own database.
* Passwords use Mechanical's exact format (`scrypt$…`, the older `sha256$…`), so people keep their passwords.
* A module trusts a Portal ticket only after checking its ES256 signature with `/api/jwks`, its `aud` (the module key), `exp`, and that its `jti` is used once.
