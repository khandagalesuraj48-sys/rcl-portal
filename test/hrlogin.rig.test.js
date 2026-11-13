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
  sql(`delete from sessions where email like '%@mobile.id' and email in (select email from users where name like '%${tag}'); delete from access where email in (select email from users where name like '%${tag}'); delete from audit where target in (select email from users where name like '%${tag}'); delete from users where name like '%${tag}';`);
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
  assert.deepStrictEqual([t1, r.j.first], ['Rig@1234', true], '(13-11-2026) the FIRST password: his first name, a capital first, then @1234'); assert.match(sql(`select password_hash from users where email = '${emp.email}'`), /^tmp\$scrypt\$/, 'kept hashed, marked one-time');
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
  r = await A.req('/api/hrlogin', emp); assert.deepStrictEqual([r.status, r.j.added], [200, false]); const t2 = r.j.password; assert.notStrictEqual(t2, t1); assert.match(t2, /^[a-zA-Z2-9]{10}$/, 'a forgotten password: a one-time one of another make');
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

test('(13-11-2026, step 12) a MOBILE NUMBER signs in with the password; an employee with no e-mail gets his sign-in by his number; a number is one user\'s; many at once only make new users', async () => {
  const hl = require('../api/hrlogin'), W = require('../lib/who');
  assert.deepStrictEqual(['ramesh suresh patil', 'RAMESH', 'Mc-Donald K', 'A B', 'रमेश पाटील', ''].map(hl.firstPassword), ['Ramesh@1234', 'Ramesh@1234', 'Mcdonald@1234', null, null, null]);
  assert.deepStrictEqual(['98765 43210', '+91-9876543210', '09876543210', '919876543210', '1234567890', 'a@b.co', '98765432'].map(W.mobileOf), ['9876543210', '9876543210', '9876543210', '9876543210', '', '', '']);
  const A = await signIn(m('hradmin'), OWN), n = String(Date.now()).slice(-8), m1 = '98' + n, m2 = '97' + n, m3 = '96' + n, m4 = '95' + n;
  // no e-mail: his user ID is made of his number; the first password by the rule; he signs in with the NUMBER and must set his own
  let r = await A.req('/api/hrlogin', { site: 'S1', email: '', mobile: '+91 ' + m1, name: 'Kiran ' + tag }); assert.deepStrictEqual([r.status, r.j.added, r.j.id, r.j.password, r.j.mobile], [200, true, m1 + '@mobile.id', 'Kiran@1234', m1], JSON.stringify(r.j));
  assert.strictEqual(sql(`select mobile || ':' || (password_hash like 'tmp$scrypt$%') from users where email = '${m1}@mobile.id'`), m1 + ':true');
  r = await A.req('/api/hrlogin', { site: 'S1', name: 'Nobody ' + tag }); assert.deepStrictEqual([r.status, r.j.code], [400, 'email'], 'neither an e-mail nor a number: no sign-in');
  r = await A.req('/api/hrlogin', { site: 'S1', mobile: '12345', name: 'Bad ' + tag }); assert.deepStrictEqual([r.status, r.j.code], [400, 'mobile']);
  let E = browser(); r = await E.req('/api/auth', { action: 'login', email: m1, password: 'Kiran@1234' }); assert.deepStrictEqual([r.status, r.j.mustChange, r.j.user.email], [200, true, m1 + '@mobile.id']);
  r = await E.req('/api/auth', { action: 'changePassword', old: 'Kiran@1234', password: 'Kir#Own' + tag + '7', password2: 'Kir#Own' + tag + '7' }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  r = await E.req('/api/auth', { action: 'me' }); assert.deepStrictEqual([r.j.mustChange, (r.j.items || []).map(i => i.site + ':' + i.module)], [false, ['S1:hrme']]);
  r = await E.req('/api/auth', { action: 'emailAlert' }); assert.strictEqual(r.j.show, false, 'he is not asked every hour for an e-mail');
  r = await browser().req('/api/auth', { action: 'login', email: '0' + m1, password: 'Kir#Own' + tag + '7' }); assert.strictEqual(r.status, 200, 'the number as people write it');
  // strict: a number or an e-mail the Portal does not know opens nothing – and the answer does not say which
  r = await browser().req('/api/auth', { action: 'login', email: m4, password: 'Kiran@1234' }); assert.deepStrictEqual([r.status, r.j.error], [401, 'Wrong mobile number or password.']);
  r = await browser().req('/api/auth', { action: 'login', email: m1, password: 'Kiran@1234' }); assert.deepStrictEqual([r.status, r.j.error], [401, 'Wrong mobile number or password.'], 'the first password works no more');
  r = await browser().req('/api/auth', { action: 'login', email: m1 + '@mobile.id', password: 'Kir#Own' + tag + '7' }); assert.strictEqual(r.status, 200, 'his user ID opens it too (it is his name for the modules)');
  r = await browser().req('/api/auth', { action: 'otpSend', email: m1 + '@mobile.id' }); assert.strictEqual(sql(`select count(*) from audit where actor = '${m1}@mobile.id' and action = 'Sign-in code sent'`), '0', 'no code is ever sent to a user ID made of a number');
  // an e-mail AND a number: both open the same account
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('both'), mobile: m2, name: 'Both ' + tag }); assert.deepStrictEqual([r.status, r.j.id, r.j.password, r.j.mobile], [200, m('both'), 'Both@1234', m2]);
  for (const id of [m('both'), m2]) { r = await browser().req('/api/auth', { action: 'login', email: id, password: 'Both@1234' }); assert.deepStrictEqual([r.status, r.j.user.email], [200, m('both')], id); }
  // a number is ONE user's: not given to a second; an e-mail and a number of two different users are refused
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('third'), mobile: m3, name: 'Third ' + tag }); assert.strictEqual(r.status, 200);
  r = await A.req('/api/hrlogin', { site: 'S1', email: m('both'), mobile: m3, name: 'Both ' + tag }); assert.deepStrictEqual([r.status, r.j.code], [409, 'two']);
  assert.strictEqual(sql(`select mobile from users where email = '${m('both')}'`), m2, 'nothing was changed');
  // he forgot: found by his number alone; a one-time password of another make; his user ID and number stay
  r = await A.req('/api/hrlogin', { site: 'S1', mobile: m1, name: 'Kiran ' + tag }); assert.deepStrictEqual([r.status, r.j.added, r.j.id], [200, false, m1 + '@mobile.id']); assert.match(r.j.password, /^[a-zA-Z2-9]{10}$/);
  r = await browser().req('/api/auth', { action: 'login', email: m1, password: r.j.password }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  // a person with other work in the ERP is never touched – also not through a mobile number
  sql(`update users set mobile = '${m4}' where email = '${m('store')}'`);
  r = await A.req('/api/hrlogin', { site: 'S1', mobile: m4, name: 'Rig Store Man' }); assert.deepStrictEqual([r.status, r.j.code], [403, 'other']);
  // MANY at once: only new users are made; nobody's password changes; each person answered; no password in the answer
  const before = sql(`select string_agg(email || password_hash, ',' order by email) from users where email in ('${m1}@mobile.id', '${m('both')}', '${m('store')}')`), m5 = '94' + n, m6 = '93' + n;
  r = await A.req('/api/hrlogin', { site: 'S1', people: [{ mobile: m5, name: 'Lata ' + tag }, { email: m('many2'), name: 'Mohan ' + tag }, { mobile: m1, name: 'Kiran ' + tag }, { name: 'Nobody ' + tag }, { mobile: m4, name: 'Rig Store Man' }, { mobile: m6, name: 'क ' + tag }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.deepStrictEqual(r.j.people.map(p => p.state + (p.code ? ':' + p.code : '')), ['made', 'made', 'has', 'refused:email', 'refused:other', 'refused:name']);
  assert.ok(!JSON.stringify(r.j).includes('@1234'), 'no password in the answer'); assert.strictEqual(sql(`select string_agg(email || password_hash, ',' order by email) from users where email in ('${m1}@mobile.id', '${m('both')}', '${m('store')}')`), before, 'nobody\'s password was changed');
  r = await browser().req('/api/auth', { action: 'login', email: m5, password: 'Lata@1234' }); assert.deepStrictEqual([r.status, r.j.mustChange], [200, true]);
  r = await A.req('/api/hrlogin', { site: 'S1', people: Array.from({ length: 26 }, (_, i) => ({ mobile: '9000000' + String(100 + i), name: 'X ' + tag })) }); assert.deepStrictEqual([r.status, r.j.code], [400, 'people']);
  const U = await signIn(m('hruser'), OWN); r = await U.req('/api/hrlogin', { site: 'S1', people: [{ mobile: m6, name: 'Zed ' + tag }] }); assert.deepStrictEqual([r.status, r.j.code], [403, 'role'], 'an HR User cannot – for many either');
  assert.ok(!sql(`select coalesce(string_agg(detail::text, ' '), '') from audit where action like 'Employee sign-in%' and target like '%${n}%'`).includes('@1234'), 'no password in the activity record');
  sql(`update users set mobile = null where email = '${m('store')}'`);
});

test('(13-11-2026) who has a sign-in: it only reads – "has", "off" or "none" for each person; only the HR Admin of the site or the Super Admin', async () => {
  const A = await signIn(m('hradmin'), OWN), n = String(Date.now()).slice(-8), mob = '94' + n, before = sql('select count(*) from users') + '/' + sql('select count(*) from access') + '/' + sql('select count(*) from audit');
  let r = await A.req('/api/hrlogin', { site: 'S1', email: '', mobile: mob, name: 'Chek ' + tag }); assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  const made = sql('select count(*) from users') + '/' + sql('select count(*) from access') + '/' + sql('select count(*) from audit'); assert.notStrictEqual(made, before);
  r = await A.req('/api/hrlogin', { site: 'S1', check: [{ email: m('store') }, { mobile: '+91 ' + mob }, { email: m('off') }, { email: m('nobody'), mobile: '93' + n }, { known: mob + '@mobile.id', mobile: '92' + n }, {}, { email: 'not an e-mail' }] });
  assert.deepStrictEqual([r.status, r.j.signins], [200, ['has', 'has', 'off', 'none', 'has', 'none', 'none']], JSON.stringify(r.j));
  assert.strictEqual(sql('select count(*) from users') + '/' + sql('select count(*) from access') + '/' + sql('select count(*) from audit'), made, 'nothing is made, changed or written down');
  r = await A.req('/api/hrlogin', { site: 'S1', check: [] }); assert.deepStrictEqual([r.status, r.j.code], [400, 'people']);
  r = await A.req('/api/hrlogin', { site: 'S1', check: new Array(501).fill({}) }); assert.deepStrictEqual([r.status, r.j.code], [400, 'people']);
  const U = await signIn(m('hruser'), OWN); r = await U.req('/api/hrlogin', { site: 'S1', check: [{ email: m('store') }] }); assert.deepStrictEqual([r.status, r.j.code], [403, 'role'], 'an HR User is not told');
});
