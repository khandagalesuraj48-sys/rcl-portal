/* THE BETA CHANNEL END TO END on the LOCAL TEST RIG (02-11-2026). Next to the stable copies (Mechanical :3000, the Store :3020) it
 * starts, from the same working trees:
 *   the BETA copies   – Mechanical :3002, the Store :3021: VERCEL_ENV=preview, VERCEL_GIT_COMMIT_REF=beta, RCL_CHANNEL=beta;
 *   a plain Preview   – Mechanical :3003, the Store :3022: VERCEL_ENV=preview of another branch (no RCL_CHANNEL).
 * The rig's databases carry NO test mark – like the live ones. Checked: a TESTER (the Super Admin ticked) is sent by the Portal to
 * the beta copies and works there (sign-in with the Portal's ticket, a read); the beta pages show the BETA band; a label printed
 * there carries the live address; the plain Preview is refused on the same databases (as before); everybody else is sent to the
 * stable copies. Nothing reaches GitHub, Vercel, Google or a phone.
 *   needs the rig (PORTAL=1 all.sh – the Portal :3010, Mechanical :3000, the Store :3020);  timeout 300 node --test test/beta.e2e.rig.test.js */
'use strict';
const test = require('node:test'), assert = require('node:assert'), { execSync, spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const P = 'http://127.0.0.1:3010', MECH = '/home/claude/rclerp', STORE = '/home/claude/rcl-store';
const sql = q => execSync('timeout 60 su postgres -c "psql -d rcl_portal -tA -q"', { input: q }).toString().trim();
const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
const SAPW = ['Super#Admin2040', 'Super#Admin2041'], PW = 'Beta#Rig2026!xYz';
const SITES_KEY = 'rig-sites-key-0123456789-abcdefghij';
function client(base) {
  let cookie = '';
  const req = async (p, body, hdr) => {
    const h = Object.assign({ 'Content-Type': 'application/json', 'X-RCL': '1' }, hdr || {}); if (cookie) h.Cookie = cookie;
    const r = await fetch((base || P) + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { j = {}; }
    return { status: r.status, j, text, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function signIn(email, pws) { const c = client(); for (const pw of pws) { const l = await c.req('/api/auth', { action: 'login', email, password: pw }); if (l.status === 200) return c; } throw new Error('sign-in ' + email); }
const procs = [];
function start(cwd, port, env) {
  const p = spawn('node', ['dev.js'], { cwd, env: Object.assign({}, process.env, env, { PORT: String(port) }), stdio: 'ignore', detached: true });
  procs.push(p); return p;
}
async function up(port) { for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(2000) }); if (r.status < 500) return; } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 250)); } throw new Error('not up: ' + port); }
const BETA = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'beta', RCL_CHANNEL: 'beta' }, OTHER = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature-x', RCL_CHANNEL: '' };
let SA, N, mods, mechDir;
test.before(async () => {
  // Mechanical's working tree as the rig runs it (its own folder: the beta copies must not touch /home/claude/vercel)
  mechDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcl-beta-mech-'));
  execSync('tar --exclude=./.git --exclude=./public --exclude=./node_modules -cf - . | (cd ' + mechDir + ' && tar -xf -)', { cwd: MECH, timeout: 60000 });
  fs.copyFileSync('/home/claude/vercel/.env.local', path.join(mechDir, '.env.local'));
  execSync('node build.js', { cwd: mechDir, timeout: 120000, stdio: 'ignore' });
  const mechEnv = { RCL_SITES_KEY: SITES_KEY, PORTAL_URL: P };
  start(mechDir, 3002, Object.assign({}, mechEnv, BETA)); start(mechDir, 3003, Object.assign({}, mechEnv, OTHER));
  const storeEnv = { SUPABASE_URL: 'http://127.0.0.1:3100', SUPABASE_SECRET_KEY: 'sb_secret_rigkey', RCL_SITES_KEY: SITES_KEY, PORTAL_URL: P, STORE_TODAY_RULE: 'off' };
  start(STORE, 3021, Object.assign({}, storeEnv, BETA)); start(STORE, 3022, Object.assign({}, storeEnv, OTHER));
  await Promise.all([3002, 3003, 3021, 3022].map(up));
  const h = await require('../lib/pw').make(PW);
  sql('insert into users (email, name, password_hash, active) values (' + lit('beta-n@beta.test') + ", 'Beta Normal', " + lit(h) + ", true) on conflict (email) do update set password_hash = excluded.password_hash, active = true, tester = false;" +
    "insert into access (email, site, module, role, granted_by) values ('beta-n@beta.test', 'S1', 'store', 'user', 'beta-rig') on conflict (email, site, module) do nothing;");
  SA = await signIn('sa@rcl.test', SAPW); N = await signIn('beta-n@beta.test', [PW]);
  mods = (await SA.req('/api/admin', { action: 'overview' })).j.modules;
  const m = k => mods.find(x => x.key === k);
  // the beta links: the Store and Mechanical
  for (const [k, b] of [['store', 'http://127.0.0.1:3021'], ['mechanical', 'http://127.0.0.1:3002']]) {
    const r = await SA.req('/api/admin', { action: 'moduleSave', key: k, url: m(k).url, status: m(k).status, betaUrl: b });
    assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  }
  assert.strictEqual((await SA.req('/api/admin', { action: 'testerSet', email: 'sa@rcl.test', tester: true })).status, 200);
});
test.after(async () => {
  try { sql("update users set tester = false where email in ('sa@rcl.test', 'beta-n@beta.test'); update modules set beta_url = null;"); } catch (e) { /* (the database) */ }
  procs.forEach(p => { try { process.kill(-p.pid); } catch (e) { /* gone */ } });
  try { fs.rmSync(mechDir, { recursive: true, force: true }); } catch (e) { /* (left in the temporary folder) */ }
});

test('the Store: the tester works in the beta copy on the unmarked database; a Preview of another branch is refused there; the others stay stable', async () => {
  const g = await SA.req('/api/go?module=store&site=S1');
  assert.ok(g.loc.indexOf('http://127.0.0.1:3021/#sso=') === 0, g.loc.slice(0, 50));
  const st = client('http://127.0.0.1:3021'), s = await st.req('/api/sso', { ticket: g.loc.split('#sso=')[1] });
  assert.strictEqual(s.status, 200, JSON.stringify(s.j)); assert.strictEqual(s.j.beta, true); assert.strictEqual(s.j.preview, undefined);
  const me = await st.req('/api/me'); assert.strictEqual(me.j.signedIn, true); assert.strictEqual(me.j.beta, true);
  const li = await st.req('/api/items', { action: 'list' }); assert.strictEqual(li.status, 200, JSON.stringify(li.j).slice(0, 200)); assert.ok(Array.isArray(li.j.items));
  // the same database from a Preview of another branch: refused, nothing read (as before the beta channel)
  const g2 = await SA.req('/api/go?module=store&site=S1'), pv = await client('http://127.0.0.1:3022').req('/api/sso', { ticket: g2.loc.split('#sso=')[1] });
  assert.strictEqual(pv.status, 503, JSON.stringify(pv.j)); assert.match(pv.j.error, /^This is a Preview/);
  // not a tester: the stable Store
  const gn = await N.req('/api/go?module=store&site=S1'); assert.ok(gn.loc.indexOf('http://127.0.0.1:3020/#sso=') === 0, gn.loc.slice(0, 50));
  // the beta page: its band text is in it (the page shows it when the server says beta)
  const page = (await client('http://127.0.0.1:3021').req('/')).text; assert.ok(page.indexOf("'BETA – the new version for testers · the data is LIVE'") > -1);
});

test('Mechanical: the tester signs in on the beta copy (the Portal\'s ticket) and reads; its page has the BETA band and the live address for labels; another Preview refused', async () => {
  const go = await SA.req('/api/go?module=mechanical&site=S1');
  assert.ok(go.loc.indexOf('http://127.0.0.1:3002/#sso=') === 0, go.loc.slice(0, 50));
  const rpc = (port, body) => client('http://127.0.0.1:' + port).req('/api/rpc', body);
  const t = (await SA.req('/api/go?module=mechanical&site=S1&json=1')).j.ticket; assert.ok(t);
  const li = await rpc(3002, { fn: 'ssoLogin', args: [t], site: 'S1' });
  assert.strictEqual(li.status, 200, li.text.slice(0, 300)); assert.ok(li.j.result && li.j.result.token, li.text.slice(0, 300));
  const gi = await rpc(3002, { fn: 'api', args: [li.j.result.token, 'getInit', []], site: 'S1' });
  assert.strictEqual(gi.status, 200, gi.text.slice(0, 300)); assert.ok(gi.j.result && !gi.j.error, gi.text.slice(0, 300));
  const page = (await client('http://127.0.0.1:3002').req('/')).text;
  assert.ok(page.indexOf('BETA – the new version for testers · the data is LIVE') > -1 && page.indexOf('TEST copy (Preview)') === -1, 'the beta band');
  assert.ok(page.indexOf('<script>window.rclLive = "https://oneclicksolution-erp.vercel.app";</script>') > -1, 'labels: the live address');
  // another branch's Preview on the same databases: refused (as before)
  const t2 = (await SA.req('/api/go?module=mechanical&site=S1&json=1')).j.ticket;
  const pv = await rpc(3003, { fn: 'ssoLogin', args: [t2], site: 'S1' });
  assert.ok(/This is a Preview/.test(pv.text), pv.text.slice(0, 300));
  const pp = (await client('http://127.0.0.1:3003').req('/')).text; assert.ok(pp.indexOf('TEST copy (Preview)') > -1 && pp.indexOf('window.rclLive = ') === -1);
  // the stable copy: no band, no live-address line (as before)
  const sp = (await client('http://127.0.0.1:3000').req('/')).text; assert.ok(sp.indexOf('rcl_preview_band') === -1 && sp.indexOf('window.rclLive = ') === -1);
  // untick: the Super Admin is sent to the stable copy again
  await SA.req('/api/admin', { action: 'testerSet', email: 'sa@rcl.test', tester: false });
  const back = await SA.req('/api/go?module=mechanical&site=S1'); assert.ok(back.loc.indexOf('http://127.0.0.1:3000/#sso=') === 0, back.loc.slice(0, 50));
});
