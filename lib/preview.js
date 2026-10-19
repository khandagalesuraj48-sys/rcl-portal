/* (20-10-2026, asked: "Staging database … KR PERFECT") A PREVIEW NEVER TOUCHES THE LIVE DATA. A Preview (a test deployment of a branch –
 * VERCEL_ENV = 'preview') works ONLY with a database that says of itself "I am a test database": the row app_settings
 * THIS_IS_A_TEST_DATABASE = 'yes' (Mechanical's STAGING_SETUP.md – only the staging database has it). Before a Preview's first call to a
 * database the row is asked (once in 5 minutes); a database without it – the live one, if a Vercel setting of the Preview was left
 * pointing there – is refused: nothing is read or saved. Production asks nothing. (The same in Mechanical and the Store.) */
'use strict';
const { fail } = require('./http');

const isPreview = () => String(process.env.VERCEL_ENV || '') === 'preview';
const NO = 'This is a Preview (a test copy of the app): it works only with the TEST database, and this database is not marked as one – nothing was read or saved. (STAGING_SETUP.md: the Preview\'s settings in Vercel must point to the staging database.)';
const seen = new Map();      // the database's address → { ok, at }

async function guard(c) {
  if (!isPreview() || !c || !c.url) return;
  const was = seen.get(c.url);
  if (was && Date.now() - was.at < (was.ok ? 300000 : 10000)) { if (!was.ok) throw fail(503, NO, 'preview'); return; }
  let ok = false;
  try {
    const r = await fetch(c.url + '/rest/v1/app_settings?id=eq.THIS_IS_A_TEST_DATABASE&select=value', { headers: { apikey: c.key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 500) throw new Error('database ' + r.status);
    if (r.ok) { const j = await r.json(); ok = Array.isArray(j) && !!j[0] && j[0].value === 'yes'; }
  } catch (e) { throw fail(503, 'Could not reach the database – please try again in a moment.'); }
  seen.set(c.url, { ok: ok, at: Date.now() });
  if (!ok) throw fail(503, NO, 'preview');
}
module.exports = { isPreview, guard, NO };
