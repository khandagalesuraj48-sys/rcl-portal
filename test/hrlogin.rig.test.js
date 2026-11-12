/* POST /api/hrlogin – an employee's sign-in given from HR – through the Portal's own door on the local test rig (never the live
 * database):  the Portal :3010 with its test database (door :3106).   node --test test/hrlogin.rig.test.js
 * It adds its OWN rows (a tag of this run in every e-mail) to the rig's database and takes them away at the end. Made-up people. */
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { execSync } = require('child_process');
const pw = require('../lib/pw');
const P = process.env.PORTAL_RIG_URL || 'http://127.0.0.1:3010';
const sql = q => execSync('timeout 60 su postgres -c "psql -d rcl_portal -v ON_ERROR_STOP=1 -tA -q"', { input: q }).toString().trim();
const tag = 't' + Date.now().toString(36), m = n => n + '.' + tag + '@rig.test', OWN = 'Rig#Own' + tag + '9';
function browser() {
  let cookie = '';
  const req = async (path, body, opt) => {
    const h = { 'Content-Type': 'application/json' }; if (!(opt && opt.noHeader)) h['X-RCL'] = '1'; if (opt && opt.origin) h.Origin = opt.origin; if (cookie) h.Cookie = cookie;
    const r = await fetch(P + path, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    const t = await r.text(); let j = {}; try { j = JSON.parse(t) || {}; } catch (e) { j = {}; }
    return { status: r.status, j: j };
  };
  return { req };
}
const signIn = async (email, password) => { const b = browser(), r = await b.req('/api/auth', { action: 'login', email: email, password: password }); assert.strictEqual(r.status, 200, 'sign-in of ' + email + ': ' + JSON.stringify(r.j)); return b; };
let hadHr, hadMe;

test.before(async () => {
  const h = await pw.make(OWN);
  hadHr = sql("select count(*) from modules where key = 'hr'") === '1'; hadMe = sql("select count(*) from modules where key = 'hrme'") === '1';
  sql(`insert into modules (key, name, url, status, sort) values ('hr', 'RCL HR', 'http://127.0.0.1:3060', 'live', 90) on conflict (key) do nothing;
       insert into users (email, name, password_hash, active) values ('${m('hradmin')}', 'Rig HR Admin', '${h}', true), ('${m('hruser')}', 'Rig HR User', '${h}', true), ('${m('store')}', 'Rig Store Man', '${h}', true), ('${m('off')}', 'Rig Off', '${h}', false);
       insert into access (email, site, module, role) values ('${m('hradmin')}', 'S1', 'hr', 'admin'), ('${m('hruser')}', 'S1', 'hr', 'user'), ('${m('store')}', 'S1', 'store', 'user');`);
});
test.after(() => {
  sql(`delete from sessions where email like '%.${tag}@rig.test'; delete from access where email like '%.${tag}@rig.test'; delete from audit where actor like '%.${tag}@rig.test' or target like '%.${tag}@rig.test'; delete from users where email like '%.${tag}@rig.test';
       ${hadMe ? '' : "delete from access where module = 'hrme'; delete from modules where key = 'hrme';"} ${hadHr ? '' : "delete from access where module = 'hr'; delete from modules where key = 'hr';"}`);
});

test('an employee\'s sign-in: only the HR Admin of the site or the Super Admin; a one-time password, his own at the first sign-in, only "My HR"', async () => {
  const A = await signIn(m('hradmin'), OWN), U = await signIn(m('hruser'), OWN), nobody = browser(), emp = { site: 'S1', email: m('emp'), name: 'Rig Employee' };
  let r = await nobody.req('/api/hrlogin', emp); assert.strictEqual(r.status, 401, 'not signed in');
  r = await A.req('/api/hrlogin', emp, { noHeader: true }); assert.strictEqual(r.status, 403, 'without the page\'s own header');
  r = await A.req('/api/hrlogin', emp, { origin: 'https://another.example' }); assert.strictEqual(r.status, 403, 'from another web page');
  r = await U.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.code], [403, 'role'], 'an HR User cannot');
  r = await A.req('/api/hrlogin', Object.assign({}, emp, { site: 'T2' })); assert.deepStrictEqual([r.status, r.j.code], [403, 'role'], 'the HR Admin of another site cannot');
  // "My HR" is not in the Portal yet: said, nothing made
  sql("delete from access where module = 'hrme'; delete from modules where key = 'hrme';");
  r = await A.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.code], [400, 'nomodule']); assert.strictEqual(sql(`select count(*) from users where email = '${emp.email}'`), '0');
  sql("insert into modules (key, name, url, status, sort) values ('hrme', 'My HR', 'http://127.0.0.1:3060', 'live', 91)");
  r = await A.req('/api/hrlogin', Object.assign({}, emp, { email: 'not-an-email' })); assert.deepStrictEqual([r.status, r.j.code], [400, 'email']);
  r = await A.req('/api/hrlogin', Object.assign({}, emp, { email: m('hradmin') })); assert.deepStrictEqual([r.status, r.j.code], [400, 'self']);
  // given: a user with a one-time password and "My HR" on that site – nothing else
  r = await A.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.ok, r.j.added, r.j.email], [200, true, true, emp.email]); const t1 = r.j.password;
  assert.match(t1, /^[a-zA-Z2-9]{10}$/); assert.match(sql(`select password_hash from users where email = '${emp.email}'`), /^tmp\$scrypt\$/, 'kept hashed, marked one-time');
  assert.strictEqual(sql(`select string_agg(site || ':' || module || ':' || role, ',') from access where email = '${emp.email}'`), 'S1:hrme:user');
  assert.ok(!sql(`select detail::text from audit where target = '${emp.email}'`).includes(t1), 'the password is not in the activity record');
  // the employee: signs in with it, must set his own, then has "My HR" only
  let E = browser(); r = await E.req('/api/auth', { action: 'login', email: emp.email, password: t1 }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  r = await E.req('/api/go?module=hrme&site=S1&json=1'); assert.strictEqual(r.status, 401, 'no module before his own password');
  r = await E.req('/api/hrlogin', { site: 'S1', email: m('emp2'), name: 'X Y' }); assert.strictEqual(r.status, 403, 'and he gives nobody a sign-in');
  r = await E.req('/api/auth', { action: 'changePassword', old: t1, password: 'Emp#Own' + tag + '7', password2: 'Emp#Own' + tag + '7' }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  r = await E.req('/api/auth', { action: 'me' }); assert.deepStrictEqual([r.j.mustChange, (r.j.items || []).map(i => i.site + ':' + i.module)], [false, ['S1:hrme']]);
  r = await E.req('/api/go?module=hrme&site=S1&json=1'); assert.ok(r.status === 200 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(r.j.ticket), 'a ticket for My HR');
  r = await E.req('/api/go?module=hr&site=S1&json=1'); assert.strictEqual(r.status, 403, 'not the HR office\'s module');
  // he forgot it: a new one-time password – the old one and his sign-ins end
  r = await A.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.added], [200, false]); const t2 = r.j.password; assert.notStrictEqual(t2, t1);
  r = await E.req('/api/auth', { action: 'me' }); assert.strictEqual(r.j.signedIn, false, 'his open sign-in ended');
  r = await browser().req('/api/auth', { action: 'login', email: emp.email, password: 'Emp#Own' + tag + '7' }); assert.strictEqual(r.status, 401, 'the forgotten password does not work any more');
  r = await browser().req('/api/auth', { action: 'login', email: emp.email, password: t2 }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  assert.strictEqual(sql(`select count(*) from access where email = '${emp.email}'`), '1', 'his access is not given twice');
  assert.strictEqual(sql(`select string_agg(action, ' | ' order by id) from audit where target = '${emp.email}' and action like 'Employee sign-in%'`), 'Employee sign-in given | Employee sign-in: new one-time password');
});

test('the limit: a person with other work in the ERP, the Super Admin and a switched-off user are never touched from HR', async () => {
  const A = await signIn(m('hradmin'), OWN), before = sql(`select string_agg(email || password_hash, ',' order by email) from users where email in ('${m('store')}', '${m('hruser')}', '${m('off')}') or is_super`);
  let r = await A.req('/api/hrlogin', { site: 'S1', email: m('store'), name: 'Rig Store Man' }); assert.deepStrictEqual([r.status, r.j.code], [403, 'other'], 'a Store user');
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('hruser'), name: 'Rig HR User' }); assert.deepStrictEqual([r.status, r.j.code], [403, 'other'], 'an HR User of the office');
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('off'), name: 'Rig Off' }); assert.deepStrictEqual([r.status, r.j.code], [403, 'off']);
  const sa = sql('select email from users where is_super limit 1'); if (sa) { r = await A.req('/api/hrlogin', { site: 'S1', email: sa, name: 'Owner' }); assert.deepStrictEqual([r.status, r.j.code], [403, 'other'], 'the Super Admin'); }
  assert.strictEqual(sql(`select string_agg(email || password_hash, ',' order by email) from users where email in ('${m('store')}', '${m('hruser')}', '${m('off')}') or is_super`), before, 'no password was touched');
  assert.strictEqual(sql(`select count(*) from access where module = 'hrme' and email in ('${m('store')}', '${m('hruser')}', '${m('off')}')`), '0');
});
