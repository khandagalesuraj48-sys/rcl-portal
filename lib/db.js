/* The Portal's database (its own Supabase project), reached only from the server with the secret key. */
'use strict';
const { fail } = require('./http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;

function conf(prefix) {
  const url = String(process.env[prefix + 'URL'] || '').replace(/\/+$/, ''), key = String(process.env[prefix + (prefix === 'SUPABASE_' ? 'SECRET_KEY' : 'KEY')] || '');
  return { url, key };
}
async function call(c, method, path, body, prefer, what) {
  if (!c.url || !c.key) throw fail(500, what === 'mech' ? 'The link to Mechanical is not set up: MECH_URL and MECH_KEY are missing in Vercel.' : 'The Portal server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel → Environment Variables.');
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) { last = String((e && e.message) || e); await sleep(300 * (i + 1)); continue; }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status >= 500 || r.status === 429) { await sleep(400 * (i + 1)); continue; }
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    throw fail(500, 'Database (' + (what || 'portal') + '): ' + last);
  }
  throw fail(503, 'Could not reach the database (' + (what || 'portal') + ') – please try again in a moment.');
}
const db = (method, path, body, prefer) => call(conf('SUPABASE_'), method, path, body, prefer, 'portal');
const mech = (method, path, body, prefer) => call(conf('MECH_'), method, path, body, prefer, 'mech');
const rpc = (name, args) => db('POST', 'rpc/' + name, args || {});
module.exports = { db, mech, rpc, enc };
