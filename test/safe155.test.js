/* (24-10-2026, Mechanical's update-155 – the audit's R3 and its /api/jwks note) on the local test rig only (never a live database):
 *   – /api/jwks: a public key another Portal server has just made is in the answer at once (the modules ask again for a key they
 *     do not know yet, so a new key works at once – nothing is kept here that could hide it);
 *   – a new row whose answer is lost (the database DID it): not sent a second time – one company, and no false "already exists";
 *   – a sign-in whose attempt count lost its answer: counted, asked again, signed in (counts are asked again as before).
 * It starts a Portal of its own (the tree in SRC, default this one) on :3011 against the rig's Portal database (:3106).
 *   SRC=<portal tree> node test/safe155.test.js */
'use strict';
const { execSync, spawn } = require('child_process'), path = require('path');
const SRC = process.env.SRC || path.join(__dirname, '..');
const P = 'http://127.0.0.1:3011', DOOR = 'http://127.0.0.1:3106';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j };
  };
  return { req };
}
const fault = b => fetch(DOOR + '/__fault', { method: 'POST', body: JSON.stringify(b) });
(async () => {
  const env = { SUPABASE_URL: DOOR, SUPABASE_SECRET_KEY: 'sb_secret_rigkey', PORTAL_SECRET: 'rig-portal-secret-0123456789abcdefghijklmnop', MECH_URL: 'http://127.0.0.1:3100', MECH_KEY: 'sb_secret_rigkey', MECH_APP_URL: 'http://127.0.0.1:3000', APP_STORE_URL: 'http://127.0.0.1:3100', APP_STORE_KEY: 'sb_secret_rigkey', PORT: '3011' };
  const srv = spawn('node', ['dev.js'], { cwd: SRC, env: Object.assign({}, process.env, env), stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(P + '/', { signal: AbortSignal.timeout(2000) })).status === 200) break; } catch (e) { /* starting */ } await wait(300); }
    sql('rcl_portal', "delete from companies where name like 'Lost Answer Co%'; delete from counters where key like '%sa@rcl.test%';");
    const k0 = await (await fetch(P + '/api/jwks')).json();
    // another Portal server (Vercel runs several) makes a key: its public half is written in the database – this server is asked next
    const pub = JSON.parse(JSON.stringify((k0.keys || [])[0] || {})); pub.kid = 'rig155other';
    sql('rcl_portal', "delete from signing_keys where kid = 'rig155other'; insert into signing_keys (kid, public_jwk, private_sealed, created_at) values ('rig155other', '" + JSON.stringify(pub) + "', 'rig-test-not-a-key', now() + interval '1 hour');");
    const k1 = await (await fetch(P + '/api/jwks')).json();
    sql('rcl_portal', "delete from signing_keys where kid = 'rig155other';");
    ok('/api/jwks: a public key another Portal server has just made is in the answer at once (nothing kept here hides it)', (k0.keys || []).length >= 1 && (k1.keys || []).some(k => k.kid === 'rig155other'), { before: (k0.keys || []).map(k => k.kid), after: (k1.keys || []).map(k => k.kid) });
    // a sign-in whose attempt count lost its answer (it WAS counted): asked again (a count), signed in
    await fault({ match: '^POST /rest/v1/rpc/portal_hit', after: true, drop: true, n: 1 });
    const A = client(P), l = await A.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: 'Super#Admin2040' });
    await fault({});
    ok('the Super Admin signs in although the answer of one attempt count was lost (counts are asked again)', l.status === 200, { status: l.status, j: l.j });
    // a new company whose answer is lost: the database DID it – not sent again
    await fault({ match: '^POST /rest/v1/companies', after: true, drop: true, n: 1 });
    const c = await A.req('/api/admin', { action: 'companySave', name: 'Lost Answer Co 155' });
    await fault({});
    const n = Number(sql('rcl_portal', "select count(*) from companies where name = 'Lost Answer Co 155'"));
    ok('a new company whose answer was lost on the way back (it WAS saved): saved once, he is told to look – no false "already exists"', n === 1 && c.status === 503 && /may or may not have been saved/.test(String(c.j.error || '')), { rows: n, status: c.status, said: c.j.error });
    const c2 = await A.req('/api/admin', { action: 'companySave', name: 'Lost Answer Co 155' });
    ok('   saving it again: "There is already a company with this name" (it is there, once)', c2.status === 409 && /already a company/.test(String(c2.j.error || '')), c2.j);
  } catch (e) { ok('no crash', false, String(e && e.stack || e)); }
  finally { try { srv.kill(); } catch (e) {} try { await fault({}); } catch (e) {} }
  try { sql('rcl_portal', "delete from companies where name like 'Lost Answer Co%';"); } catch (e) {}
  out.forEach(x => console.log(x)); console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
