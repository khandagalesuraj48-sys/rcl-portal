/* THE BETA CHANNEL on the LOCAL TEST RIG (asked 02-11-2026) – the Portal (:3010) with its test database and a stand-in for GitHub
 * (test/github-standin.js on :3063) – nothing reaches GitHub, Vercel or a phone:
 *   • a TESTER (ticked by the Super Admin) opens the module's BETA copy – in the app's list and through /api/go; everybody else the
 *     stable one; untick → back to stable at the next opening;
 *   • VERSIONS: the app's releases – Beta (testers) / Stable (everybody);
 *   • MAKE STABLE: nothing is done when a repository's main cannot move forward to the tested commit; else each main moves to the very
 *     commit the testers used (the web first, the app's repository last), the version becomes the stable one, the phones are told once;
 *     pressed again: nothing more; only the Super Admin; in the Activity.
 *   needs the rig (Portal :3010, its database);   timeout 300 node --test test/beta.rig.test.js */
'use strict';
const test = require('node:test'), assert = require('node:assert'), { execSync, spawn } = require('child_process'), path = require('path'), crypto = require('crypto');
const P = 'http://127.0.0.1:3010', G = 'http://127.0.0.1:3063', TOKEN = 'rig-github-token';
const sql = q => execSync('timeout 60 su postgres -c "psql -d rcl_portal -tA -q"', { input: q }).toString().trim();
const lit = v => "'" + String(v).replace(/'/g, "''") + "'";
const PW = 'Beta#Rig2026!xYz', SAPW = ['Super#Admin2040', 'Super#Admin2041'];
const sha = (r, i) => crypto.createHash('sha1').update(r + ':' + i).digest('hex');
function client() {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(P + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function signIn(email, pws) { const c = client(); for (const pw of pws) { const l = await c.req('/api/auth', { action: 'login', email, password: pw }); if (l.status === 200) return c; } throw new Error('sign-in ' + email); }
const portal = env => execSync('bash /home/claude/rig/portal_srv.sh', { env: Object.assign({}, process.env, env || {}), timeout: 30000 });
const gh = (p, body) => fetch(G + p, body === undefined ? { signal: AbortSignal.timeout(10000) } : { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }).then(r => r.json());
let stand, SA, T, N;
const BETA_STORE = 'http://127.0.0.1:3021';
test.before(async () => {
  stand = spawn('node', [path.join(__dirname, 'github-standin.js')], { env: Object.assign({}, process.env, { GH_TOKEN: TOKEN }), stdio: 'ignore', detached: true });
  portal({ GITHUB_API: G, GITHUB_RELEASE_TOKEN: TOKEN, GITHUB_OWNER: 'rig' });
  await new Promise(r => setTimeout(r, 1500));
  const h = await require('../lib/pw').make(PW);
  for (const [email, name] of [['beta-t@beta.test', 'Beta Tester'], ['beta-n@beta.test', 'Beta Normal']]) {
    sql('insert into users (email, name, password_hash, active) values (' + lit(email) + ',' + lit(name) + ',' + lit(h) + ", true) on conflict (email) do update set password_hash = excluded.password_hash, active = true, tester = false;" +
      'insert into access (email, site, module, role, granted_by) values (' + lit(email) + ", 'S1', 'store', 'user', 'beta-rig') on conflict (email, site, module) do nothing;");
  }
  sql("update modules set beta_url = null where key in ('store', 'purchase', 'mechanical', 'engineering');");
  [SA, T, N] = await Promise.all([signIn('sa@rcl.test', SAPW), signIn('beta-t@beta.test', [PW]), signIn('beta-n@beta.test', [PW])]);
});
test.after(() => {
  sql("update users set tester = false where email like '%@beta.test'; update modules set beta_url = null;");
  try { process.kill(-stand.pid); } catch (e) { /* gone */ }
  portal({ GITHUB_API: '', GITHUB_RELEASE_TOKEN: '', GITHUB_OWNER: '' });
});

test('a tester opens the beta copy (the app\'s list and /api/go); everybody else the stable one; untick → stable again', async () => {
  const bad = await SA.req('/api/admin', { action: 'moduleSave', key: 'store', url: 'http://127.0.0.1:3020', status: 'live', betaUrl: 'http://127.0.0.1:3020' });
  assert.strictEqual(bad.status, 400, 'the beta link is not the stable one'); assert.match(bad.j.error, /beta copy/);
  const ok = await SA.req('/api/admin', { action: 'moduleSave', key: 'store', url: 'http://127.0.0.1:3020', status: 'live', betaUrl: BETA_STORE });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
  assert.strictEqual(sql("select beta_url from modules where key = 'store'"), BETA_STORE);
  const on = await SA.req('/api/admin', { action: 'testerSet', email: 'beta-t@beta.test', tester: true });
  assert.strictEqual(on.status, 200, JSON.stringify(on.j));
  const ov = (await SA.req('/api/admin', { action: 'overview' })).j;
  assert.strictEqual(ov.step7, true); assert.strictEqual(ov.users.find(u => u.email === 'beta-t@beta.test').tester, true);
  assert.strictEqual(ov.modules.find(m => m.key === 'store').beta_url, BETA_STORE);
  const mt = (await T.req('/api/auth', { action: 'me' })).j, mn = (await N.req('/api/auth', { action: 'me' })).j;
  assert.strictEqual(mt.user.tester, true); assert.strictEqual(mn.user.tester, undefined);
  const it = mt.items.find(x => x.module === 'store'), in2 = mn.items.find(x => x.module === 'store');
  assert.strictEqual(it.url, BETA_STORE); assert.strictEqual(it.beta, true, 'the app\'s link: the beta copy');
  assert.strictEqual(in2.url, 'http://127.0.0.1:3020'); assert.strictEqual(in2.beta, undefined, 'everybody else: stable');
  const gt = await T.req('/api/go?module=store&site=S1'), gn = await N.req('/api/go?module=store&site=S1');
  assert.ok(gt.loc.indexOf(BETA_STORE + '/#sso=') === 0, gt.loc.slice(0, 60)); assert.ok(gn.loc.indexOf('http://127.0.0.1:3020/#sso=') === 0, gn.loc.slice(0, 60));
  await SA.req('/api/admin', { action: 'testerSet', email: 'beta-t@beta.test', tester: false });
  const back = await T.req('/api/go?module=store&site=S1'); assert.ok(back.loc.indexOf('http://127.0.0.1:3020/#sso=') === 0, 'unticked: stable again');
  assert.strictEqual((await T.req('/api/admin', { action: 'testerSet', email: 'beta-t@beta.test', tester: true })).status, 403, 'only the Super Admin');
  assert.ok(Number(sql("select count(*) from audit where action like 'Tester (beta)%' and target = 'beta-t@beta.test'")) >= 2, 'in the Activity');
});

test('Versions and MAKE STABLE: refused as a whole when a main cannot move; else the tested commits go live, the app stable, phones told once', async () => {
  const repos = {}; ['rclerp', 'rcl-portal', 'rcl-store', 'rcl-purchase', 'rcl-engineering', 'rcl-mobile'].forEach(r => { repos[r] = { commits: [0, 1, 2].map(i => sha(r, i)), main: 0 }; });
  repos.rclerp.diverged = true;      // (first: Mechanical's main has a change the version does not have)
  const meta = v => JSON.stringify({ build: v.b, version: v.v, sha256: 'x', web: v.web });
  const rel = (id, tag, v, pre, web, appIdx, apk) => ({ id, tag_name: tag, name: 'RCL ERP ' + v.v, prerelease: pre, draft: false, created_at: '2026-11-0' + id + 'T10:00:00Z', published_at: '2026-11-0' + id + 'T10:00:00Z',
    target_commitish: sha('rcl-mobile', appIdx), assets: apk ? [{ name: 'rcl-erp-' + v.v + '-' + v.b + '.apk' }] : [],
    body: '<!-- rcl-new -->\nNew: the Store formats · नवीन: स्टोअर फॉर्म · नया: स्टोर फ़ॉर्म\n<!-- /rcl-new -->\n\n<!-- rcl:' + meta(Object.assign({ web }, v)) + ' -->' });
  await gh('/__setup', { repos, latest: 1, releases: [
    rel(1, 'v3.79.0-200', { v: '3.79.0', b: 200 }, false, {}, 0, true),
    rel(2, 'v3.80.0-201', { v: '3.80.0', b: 201 }, true, { rclerp: sha('rclerp', 1), 'rcl-store': sha('rcl-store', 2), 'rcl-purchase': sha('rcl-purchase', 0) }, 2, true)] });
  const v = (await SA.req('/api/admin', { action: 'versions' })).j;
  assert.ok(v.versions, JSON.stringify(v)); assert.strictEqual(v.token, true);
  const b = v.versions.find(x => x.tag === 'v3.80.0-201'), s = v.versions.find(x => x.tag === 'v3.79.0-200');
  assert.strictEqual(b.beta, true); assert.strictEqual(b.canMakeStable, true); assert.match(b.new, /नवीन/); assert.deepStrictEqual(b.web.sort(), ['Mechanical', 'Purchase', 'Store']);
  assert.strictEqual(s.stable, true); assert.strictEqual(s.canMakeStable, false);
  assert.strictEqual((await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201' })).status, 400, 'the version typed to confirm');
  const no = await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201', confirm: 'v3.80.0-201' });
  assert.strictEqual(no.status, 409, JSON.stringify(no.j)); assert.match(no.j.error, /Nothing was changed.*rclerp/);
  let st = await gh('/__state');
  assert.ok(Object.keys(st.repos).every(r => st.repos[r].main === 0), 'not one main moved'); assert.strictEqual(st.releases.find(x => x.id === 2).prerelease, true); assert.deepStrictEqual(st.dispatches, []);
  // Mechanical's extra change has gone through beta: main can move forward now
  repos.rclerp.diverged = false; await gh('/__setup', Object.assign({}, st, { repos }));
  // a press while another one is running: told to wait, nothing moved (the hold is the database's own count)
  sql("insert into counters (key, n, expires_at) values ('REL_make-stable', 1, now() + interval '5 minutes') on conflict (key) do update set n = 1, expires_at = excluded.expires_at");
  const busy = await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201', confirm: 'v3.80.0-201' });
  assert.strictEqual(busy.status, 409, JSON.stringify(busy.j)); assert.strictEqual(busy.j.code, 'busy');
  const sb = await gh('/__state'); assert.ok(Object.keys(sb.repos).every(r => sb.repos[r].main === 0), 'busy: not one main moved');
  sql("delete from counters where key = 'REL_make-stable'");
  const go =await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201', confirm: 'v3.80.0-201' });
  assert.strictEqual(go.status, 200, JSON.stringify(go.j));
  assert.deepStrictEqual(go.j.moved, ['Mechanical', 'Store', 'App']); assert.deepStrictEqual(go.j.already, ['Purchase']); assert.strictEqual(go.j.told, true); assert.strictEqual(go.j.made, true);
  st = await gh('/__state');
  assert.strictEqual(st.repos.rclerp.main, 1); assert.strictEqual(st.repos['rcl-store'].main, 2); assert.strictEqual(st.repos['rcl-mobile'].main, 2);
  assert.strictEqual(st.repos['rcl-purchase'].main, 0, 'the tested commit was main already'); assert.strictEqual(st.repos['rcl-portal'].main, 0, 'not in the version: untouched');
  assert.strictEqual(st.releases.find(x => x.id === 2).prerelease, false); assert.strictEqual(st.latest, 2, 'the stable version every phone takes');
  assert.strictEqual(st.dispatches.length, 1); assert.deepStrictEqual(st.dispatches[0], { repo: 'rcl-mobile', workflow: 'tell.yml', body: { ref: 'main', inputs: { version: '3.80.0', build: '201', topic: 'rcl-app-update' } } });
  const order = st.calls.filter(c => /^PATCH .*refs\/heads\/main$/.test(c)).map(c => c.split('/')[3]);
  assert.deepStrictEqual(order, ['rclerp', 'rcl-store', 'rcl-mobile'], 'the web first, the app\'s repository last');
  const again = await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201', confirm: 'v3.80.0-201' });
  assert.strictEqual(again.status, 200); assert.deepStrictEqual(again.j.moved, []); assert.strictEqual(again.j.told, false);
  assert.strictEqual((await gh('/__state')).dispatches.length, 1, 'the phones are not told twice');
  assert.strictEqual((await T.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-201', confirm: 'v3.80.0-201' })).status, 403, 'only the Super Admin');
  assert.ok(Number(sql("select count(*) from audit where action = 'Version made stable' and target = 'v3.80.0-201'")) >= 2, 'in the Activity');
  const v2 = (await SA.req('/api/admin', { action: 'versions' })).j;
  assert.strictEqual(v2.versions.find(x => x.tag === 'v3.80.0-201').stable, true); assert.strictEqual(v2.versions.find(x => x.tag === 'v3.80.0-201').canMakeStable, false);
  // a version of the WEB ONLY (no app in it – the app did not change): stable for everybody, but never GitHub's "latest" (the phones'
  // update must always find an app there); no phone is told
  st = await gh('/__state');
  st.releases.push(rel(3, 'v3.80.0-202', { v: '3.80.0', b: 202 }, true, { 'rcl-store': sha('rcl-store', 2), 'rcl-purchase': sha('rcl-purchase', 1) }, 2, false));
  await gh('/__setup', Object.assign({}, st, { repos: st.repos }));
  const v3 = (await SA.req('/api/admin', { action: 'versions' })).j, w = v3.versions.find(x => x.tag === 'v3.80.0-202');
  assert.strictEqual(w.app, false); assert.strictEqual(w.canMakeStable, true);
  const wo = await SA.req('/api/admin', { action: 'makeStable', tag: 'v3.80.0-202', confirm: 'v3.80.0-202' });
  assert.strictEqual(wo.status, 200, JSON.stringify(wo.j)); assert.deepStrictEqual(wo.j.moved, ['Purchase']); assert.deepStrictEqual(wo.j.already, ['Store', 'App']);
  assert.strictEqual(wo.j.told, false, 'no app: no phone told');
  st = await gh('/__state');
  assert.strictEqual(st.releases.find(x => x.id === 3).prerelease, false); assert.strictEqual(st.latest, 2, 'GitHub\'s latest stays the app version');
  assert.deepStrictEqual(st.patches.slice(-1)[0].body, { prerelease: false, make_latest: 'false' }); assert.strictEqual(st.dispatches.length, 0, 'no workflow asked (the list was set again just before)');
  const v4 = (await SA.req('/api/admin', { action: 'versions' })).j;
  assert.strictEqual(v4.versions.find(x => x.tag === 'v3.80.0-202').stable, true, 'the stable one in use: the newest that is not beta'); assert.strictEqual(v4.versions.find(x => x.tag === 'v3.80.0-201').stable, false);
  assert.strictEqual(v4.stableBuild, 202);
  // NEW BETA VERSION: the app's workflow "beta" on its branch beta; only the Super Admin; in the Activity
  const nb = await SA.req('/api/admin', { action: 'betaNew' });
  assert.strictEqual(nb.status, 200, JSON.stringify(nb.j));
  assert.deepStrictEqual((await gh('/__state')).dispatches.slice(-1)[0], { repo: 'rcl-mobile', workflow: 'beta.yml', body: { ref: 'beta' } });
  assert.strictEqual((await T.req('/api/admin', { action: 'betaNew' })).status, 403);
  assert.ok(Number(sql("select count(*) from audit where action = 'New beta version asked'")) >= 1);
});
