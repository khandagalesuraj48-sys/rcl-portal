/* POST /api/app { action: 'latest', platform: 'android' | 'ios' } – the mobile app's newest version (update from inside the
 * app, asked 13-10-2026), for a person signed in on the Portal only.
 * The app files are kept in a PRIVATE bucket of the Portal's Supabase ("app-releases") – never public, never in git:
 *   android/latest.json  { "build": 7, "version": "1.0.3", "file": "android/rcl-erp-1.0.3-7.apk", "sha256": "<64 hex>", "notes": "…" }
 *   ios/latest.json      { "build": 7, "version": "1.0.3", "store": "https://apps.apple.com/…" (or testflight.apple.com) }
 * The answer: the version, its fingerprint and a link to the APK that works for 10 minutes. The app checks the fingerprint,
 * and Android installs it only when it is signed with the same key as the app on the phone. Nothing there → { none: true }.
 * The build (rcl-mobile release workflow) puts the files there; the Portal only reads them. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const ses = require('../lib/session');
const { guard } = require('../lib/preview');      // (20-10-2026) a Preview works only with the test database

const BUCKET = 'app-releases';
// the store is the Portal's own Supabase (APP_STORE_URL / APP_STORE_KEY only for a test copy)
const store = () => ({ url: String(process.env.APP_STORE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: String(process.env.APP_STORE_KEY || process.env.SUPABASE_SECRET_KEY || '') });

// links that work for a short time (Supabase Storage: POST /object/sign/<bucket> { expiresIn, paths })
async function signed(paths, seconds) {
  const c = store();
  if (!c.url || !c.key) throw fail(500, 'The Portal server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel → Environment Variables.');
  await guard(c);
  let r;
  try {
    r = await fetch(c.url + '/storage/v1/object/sign/' + BUCKET, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: seconds, paths: paths }), signal: AbortSignal.timeout(15000) });
  } catch (e) { throw fail(503, 'Could not reach the app store of the Portal – please try again in a moment.'); }
  const t = await r.text();
  if (!r.ok) { if (/not.?found/i.test(t)) return null; throw fail(500, 'App store of the Portal: ' + r.status + ' ' + t.slice(0, 200)); }
  let j; try { j = JSON.parse(t); } catch (e) { j = null; }
  const out = {};
  (Array.isArray(j) ? j : []).forEach(x => { if (x && x.path && x.signedURL && !x.error) out[x.path] = c.url + '/storage/v1' + x.signedURL; });
  return out;
}

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'POST only.');
  sameSite(req);
  const s = await ses.read(req);
  if (!s) throw fail(401, 'Please sign in on the Portal first.', 'signin');
  const x = await readBody(req);
  if (x.action !== 'latest') throw fail(400, 'Unknown action.');
  const platform = x.platform === 'ios' ? 'ios' : 'android';
  const meta = await signed([platform + '/latest.json'], 60);
  const metaUrl = meta && meta[platform + '/latest.json'];
  if (!metaUrl) return send(res, 200, { none: true });
  let j;
  try { const r = await fetch(metaUrl, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return send(res, 200, { none: true }); j = await r.json(); } catch (e) { return send(res, 200, { none: true }); }
  // only what is right passes – a wrong file name, fingerprint or link is not given to the phones
  const build = Number(j && j.build), version = String((j && j.version) || '');
  if (!(Number.isInteger(build) && build > 0) || !/^[0-9A-Za-z.+-]{1,20}$/.test(version)) return send(res, 200, { none: true });
  const notes = String(j.notes || '').slice(0, 500);
  if (platform === 'ios') {
    const st = String(j.store || '');
    return send(res, 200, /^https:\/\/(apps\.apple\.com|testflight\.apple\.com)\//.test(st) ? { build, version, notes, store: st } : { none: true });
  }
  const file = String(j.file || ''), sha = String(j.sha256 || '').toLowerCase();
  if (!/^android\/[A-Za-z0-9._-]{1,80}\.apk$/.test(file) || !/^[0-9a-f]{64}$/.test(sha)) return send(res, 200, { none: true });
  const apk = await signed([file], 600);
  if (!apk || !apk[file]) return send(res, 200, { none: true });
  send(res, 200, { build, version, notes, sha256: sha, url: apk[file] });
});
