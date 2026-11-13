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
       delete from sessions where email like '%@mobile.invalid'; delete from access where email like '%@mobile.invalid'; delete from audit where target like '%@mobile.invalid'; delete from users where email like '%@mobile.invalid';
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
  assert.strictEqual(t1, 'Rig@1234', '(13-11-2026) the FIRST password: his first name – first letter capital – and @1234'); assert.match(sql(`select password_hash from users where email = '${emp.email}'`), /^tmp\$scrypt\$/, 'kept hashed, marked one-time');
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
  r = await A.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.added], [200, false]); const t2 = r.j.password; assert.match(t2, /^[a-zA-Z2-9]{10}$/, 'a forgotten password: one made by chance, not the first one again');
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

test('HR is listed once a site: whoever has the HR office\'s module does not get "My HR" beside it', async () => {
  sql("insert into modules (key, name, url, status, sort) values ('hrme', 'My HR', 'http://127.0.0.1:3060', 'live', 91) on conflict (key) do nothing");
  sql(`insert into access (email, site, module, role) values ('${m('hradmin')}', 'S1', 'hrme', 'user'), ('${m('hradmin')}', 'T2', 'hrme', 'user') on conflict do nothing`);
  const A = await signIn(m('hradmin'), OWN); let r = await A.req('/api/auth', { action: 'me' });
  assert.deepStrictEqual((r.j.items || []).map(i => i.site + ':' + i.module).sort(), ['S1:hr', 'T2:hrme'], 'the office\'s on S1 – once; only his own on T2');
  r = await A.req('/api/go?module=hr&site=S1&json=1'); assert.strictEqual(r.status, 200); const t = JSON.parse(Buffer.from(r.j.ticket.split('.')[1], 'base64url').toString());
  assert.deepStrictEqual(t.mods.map(x => x.key), ['hr'], 'the rail of the modules: HR once');
  r = await A.req('/api/go?module=hrme&site=T2&json=1'); assert.strictEqual(r.status, 200, 'his own HR where he is not of the office');
});

/* (13-11-2026, the Portal's step 12) THE MOBILE NUMBER: an employee signs in with his e-mail or with his mobile number. */
const hasMobile = () => sql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'mobile'") === '1';
const num = k => '9' + String(Date.now()).slice(-7) + String(10 + k);

test('(step 12) a mobile number: kept on the sign-in, one number one user; it opens with the password only; a number the Portal does not know opens nothing; the first password by the name', { skip: !hasMobile() && 'the step-12 SQL is not run on the rig' }, async () => {
  const hr = require('../api/hrlogin'), W = require('../lib/who');
  assert.deepStrictEqual(['Ramesh Suresh Patil', 'RAMESH', 'sunita devi', 'A. Kumar', '', 'रमेश Patil', "D'souza Paul", 'Md. Arif'].map(hr.firstPass), ['Ramesh@1234', 'Ramesh@1234', 'Sunita@1234', '', '', '', 'Dsouza@1234', 'Md@1234']);
  assert.deepStrictEqual(['9876543210', '+91 98765 43210', '09876543210', '919876543210', '98765-43210', '1234567890', '98765', 'a@b.co', ''].map(W.mobile), ['9876543210', '9876543210', '9876543210', '9876543210', '9876543210', '', '', '', '']);
  const A = await signIn(m('hradmin'), OWN), n1 = num(1), n2 = num(2), n3 = num(3);
  // 1. an e-mail AND a mobile number: his user ID is the e-mail; both open his sign-in (the number with the password)
  let r = await A.req('/api/hrlogin', { site: 'S1', email: m('both'), mobile: '+91 ' + n1, name: 'both ways person' });
  assert.deepStrictEqual([r.status, r.j.added, r.j.id, r.j.mobile, r.j.password], [200, true, m('both'), n1, 'Both@1234'], JSON.stringify(r.j));
  assert.strictEqual(sql(`select mobile from users where email = '${m('both')}'`), n1);
  r = await browser().req('/api/auth', { action: 'login', email: n1, password: 'Both@1234' }); assert.deepStrictEqual([r.status, r.j.mustChange, r.j.user.email], [200, true, m('both')]);
  r = await browser().req('/api/auth', { action: 'login', email: m('both'), password: 'Both@1234' }); assert.strictEqual(r.status, 200, 'and his e-mail');
  r = await browser().req('/api/auth', { action: 'login', email: '0' + n1, password: 'wrong' }); assert.deepStrictEqual([r.status, r.j.error], [401, 'Wrong mobile number or password.']);
  // 2. a mobile number only: a user ID made of it; signs in, must set his own password, has "My HR" only – with the number
  r = await A.req('/api/hrlogin', { site: 'S1', email: '', mobile: n2, name: 'Mobile Only' });
  const id2 = n2 + '@mobile.invalid'; assert.deepStrictEqual([r.status, r.j.added, r.j.id, r.j.password], [200, true, id2, 'Mobile@1234']);
  const E = browser(); r = await E.req('/api/auth', { action: 'login', email: n2, password: 'Mobile@1234' }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  r = await E.req('/api/auth', { action: 'changePassword', old: 'Mobile@1234', password: 'Mob#Own' + tag + '7', password2: 'Mob#Own' + tag + '7' }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  r = await E.req('/api/auth', { action: 'me' }); assert.deepStrictEqual([(r.j.items || []).map(i => i.site + ':' + i.module), r.j.email.remind], [['S1:hrme'], false], 'no reminder to verify an e-mail he does not have');
  r = await E.req('/api/auth', { action: 'emailAlert' }); assert.strictEqual(r.j.show, false);
  r = await browser().req('/api/auth', { action: 'login', email: id2, password: 'Mob#Own' + tag + '7' }); assert.strictEqual(r.status, 200, 'his user ID opens too (it is his)');
  r = await browser().req('/api/auth', { action: 'otpSend', email: n2 }); assert.strictEqual(r.status, r.status === 403 ? 403 : 400, 'a code goes to an e-mail, never asked with a number');
  // 3. a number the Portal does not know: nothing opens ("system madhe nasel tr login nahi"); the same answer as a wrong password
  r = await browser().req('/api/auth', { action: 'login', email: n3, password: 'Mobile@1234' }); assert.deepStrictEqual([r.status, r.j.error], [401, 'Wrong mobile number or password.']);
  // 4. one number, one user; a number that is not one; neither an e-mail nor a number
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('other'), mobile: n2, name: 'Other Person' }); assert.deepStrictEqual([r.status, r.j.code], [409, 'mobiletaken']); assert.strictEqual(sql(`select count(*) from users where email = '${m('other')}'`), '0');
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('other'), mobile: '12345', name: 'Other Person' }); assert.deepStrictEqual([r.status, r.j.code], [400, 'mobile']);
  r = await A.req('/api/hrlogin', { site: 'S1', email: '', mobile: '', name: 'Nobody Here' }); assert.deepStrictEqual([r.status, r.j.code], [400, 'email']);
  // 5. asked again for him (he forgot): found by the user ID HR keeps, a password made by chance; his number changed in HR is brought over
  r = await A.req('/api/hrlogin', { site: 'S1', id: id2, email: '', mobile: n3, name: 'Mobile Only' });
  assert.deepStrictEqual([r.status, r.j.added, r.j.id, r.j.mobile], [200, false, id2, n3]); assert.match(r.j.password, /^[a-zA-Z2-9]{10}$/); const t = r.j.password;
  r = await browser().req('/api/auth', { action: 'login', email: n2, password: t }); assert.strictEqual(r.status, 401, 'the old number opens nothing any more');
  r = await browser().req('/api/auth', { action: 'login', email: n3, password: t }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  // 6. MANY AT ONCE: a person without a sign-in gets one (first password by his name); a person who has one keeps his password
  const n4 = num(4), before = sql(`select password_hash from users where email = '${m('both')}'`);
  r = await A.req('/api/hrlogin', { site: 'S1', rows: [{ email: m('both'), mobile: n1, name: 'Both Ways Person' }, { email: '', mobile: n4, name: 'Fresh Person' }, { email: m('store'), mobile: '', name: 'Rig Store Man' }, { email: '', mobile: '', name: 'No One' }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  assert.deepStrictEqual(r.j.rows.map(x => [x.ok, x.added || false, x.first || false, x.code || '']), [[true, false, false, ''], [true, true, true, ''], [false, false, false, 'other'], [false, false, false, 'email']]);
  assert.ok(!JSON.stringify(r.j).includes('@1234'), 'no password comes back with many at once');
  assert.strictEqual(sql(`select password_hash from users where email = '${m('both')}'`), before, 'the person who had a sign-in keeps his password');
  r = await browser().req('/api/auth', { action: 'login', email: n4, password: 'Fresh@1234' }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  r = await A.req('/api/hrlogin', { site: 'S1', rows: Array.from({ length: 26 }, () => ({ email: '', mobile: '', name: 'X' })) }); assert.deepStrictEqual([r.status, r.j.code], [400, 'rows']);
  assert.ok(!sql(`select coalesce(string_agg(detail::text, ' '), '') from audit where target in ('${id2}', '${m('both')}')`).includes('@1234'), 'no password in the activity record');
});
