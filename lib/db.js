/* The Portal's database (its own Supabase project), reached only from the server with the secret key. */
'use strict';
const { fail } = require('./http');
const { guard } = require('./preview');      // (20-10-2026) a Preview works only with the test database
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;

function conf(prefix) {
  const url = String(process.env[prefix + 'URL'] || '').replace(/\/+$/, ''), key = String(process.env[prefix + (prefix === 'SUPABASE_' ? 'SECRET_KEY' : 'KEY')] || '');
  return { url, key };
}
// (update-155) the request never left this server (no connection, the name not found): sent again, as before – nothing can have been done
const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/;
const notSent = e => { const c = (e && e.cause) || e || {}, list = Array.isArray(c.errors) && c.errors.length ? c.errors : [c]; return list.every(x => NOT_SENT.test(String((x && x.code) || ''))); };
async function call(c, method, path, body, prefer, what) {
  if (!c.url || !c.key) throw fail(500, what === 'mech' ? 'The link to Mechanical is not set up: MECH_URL and MECH_KEY are missing in Vercel.' : 'The Portal server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel → Environment Variables.');
  await guard(c);
  /* (24-10-2026, Mechanical's update-155 – the audit's R3) a read, a change (PATCH – it sets values) and a delete are asked again
   * as before: done twice, they leave the same. A NEW ROW (POST – a user, an access line, a session …) is sent again only when the
   * database said it did not do it (503 – not reachable, 429 – too busy) or when it never left this server (no connection): after
   * no answer at all it may have been done, so it is not sent a second time. (The sign-in counts – portal_hit / portal_unhit – are asked again as before: twice is one count more.) */
  const write = method === 'POST' && !/merge-duplicates/.test(String(prefer || '')) && !/^rpc\/portal_(un)?hit$/.test(path);
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) {
      last = String((e && e.message) || e);
      if (write && !notSent(e)) throw fail(503, 'No answer from the database (' + (what || 'portal') + ') – it may or may not have been saved: open the page again and look before you try again.');
      await sleep(300 * (i + 1)); continue;
    }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status === 503 || r.status === 429 || (!write && r.status >= 500)) { await sleep(400 * (i + 1)); continue; }
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    throw fail(500, 'Database (' + (what || 'portal') + '): ' + last);
  }
  throw fail(503, 'Could not reach the database (' + (what || 'portal') + ') – please try again in a moment.');
}
const db = (method, path, body, prefer) => call(conf('SUPABASE_'), method, path, body, prefer, 'portal');
const mech = (method, path, body, prefer) => call(conf('MECH_'), method, path, body, prefer, 'mech');
const rpc = (name, args) => db('POST', 'rpc/' + name, args || {});
module.exports = { db, mech, rpc, enc };
