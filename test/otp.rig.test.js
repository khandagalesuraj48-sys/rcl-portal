/* SIGN-IN WITH A CODE BY E-MAIL, "verify my e-mail" and the reminder – through the Portal's own door on the local test rig (never
 * the live database, never a real e-mail):  node --test test/otp.rig.test.js
 * The test starts its own Portal servers (one with the switches on, one with them off) against the rig's Portal database (door
 * :3106, step 10 run) and a stand-in for the mail service that keeps what it is sent. Its own rows carry a tag of this run and
 * are taken away at the end. Made-up people. */
'use strict';
const test = require('node:test'), assert = require('node:assert');
const http = require('http'), path = require('path');
const { execSync, spawn } = require('child_process');
const pw = require('../lib/pw');
const sql = q => execSync('timeout 60 su postgres -c "psql -d rcl_portal -v ON_ERROR_STOP=1 -tA -q"', { input: q }).toString().trim();
const tag = 'o' + Date.now().toString(36), m = n => n + '.' + tag + '@rig.test', OWN = 'Rig#Own' + tag + '9';
const ON = 'http://127.0.0.1:3011', OFF = 'http://127.0.0.1:3012', MAILPORT = 3013;
const mails = []; let mailFails = false, mailSrv; const kids = [];
function browser(base, ip) {
  let cookie = '';
  const req = async (pth, body, opt) => {
    const h = { 'Content-Type': 'application/json', 'x-real-ip': ip || '10.9.0.7' }; if (!(opt && opt.noHeader)) h['X-RCL'] = '1'; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + pth, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    const t = await r.text(); let j = {}; try { j = JSON.parse(t) || {}; } catch (e) { j = {}; }
    return { status: r.status, j: j };
  };
  return { req };
}
const auth = (b, action, body) => b.req('/api/auth', Object.assign({ action: action }, body || {}));
const signIn = async (base, email, ip) => { const b = browser(base, ip), r = await auth(b, 'login', { email: email, password: OWN }); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return b; };
const codeTo = email => { const l = mails.filter(x => x.to[0] === email).pop(); return l ? (/\b(\d{6})\b/.exec(l.text) || [])[1] : ''; };
const up = async base => { for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/')).status === 200) return; } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 150)); } throw new Error('the Portal did not start: ' + base); };
const ago = (email, s) => sql(`update otps set created_at = created_at - interval '${s} seconds' where email = '${email}'`);      // (the rig's clock moved on: the 60 seconds are over)

test.before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    if (mailFails) { res.statusCode = 422; return res.end('{"message":"invalid"}'); }
    const j = JSON.parse(b); mails.push(Object.assign({ auth: req.headers.authorization, path: req.url }, j)); res.setHeader('Content-Type', 'application/json'); res.end('{"id":"rig"}'); }); });
  await new Promise(r => mailSrv.listen(MAILPORT, '127.0.0.1', r));
  const base = { SUPABASE_URL: 'http://127.0.0.1:3106', SUPABASE_SECRET_KEY: 'sb_secret_rigkey', PORTAL_SECRET: 'rig-portal-secret-0123456789abcdefghijklmnop', PATH: process.env.PATH };
  kids.push(spawn('node', ['dev.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({ PORT: '3011', OTP_LOGIN: 'on', EMAIL_ALERTS: 'on', RESEND_URL: 'http://127.0.0.1:' + MAILPORT, RESEND_API_KEY: 're_rig_test_value', OTP_FROM: 'no-reply@rig.test' }, base), stdio: 'ignore' }));
  kids.push(spawn('node', ['dev.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({ PORT: '3012' }, base), stdio: 'ignore' }));
  await up(ON); await up(OFF);
  const h = await pw.make(OWN), t = 'tmp$' + await pw.make(OWN);
  sql(`delete from counters where key like 'OI_10.9.%' or key like 'OA_%';
       insert into users (email, name, password_hash, active) values ('${m('ravi')}', 'Rig Ravi', '${h}', true), ('${m('asha')}', 'Rig Asha', '${h}', true), ('${m('off')}', 'Rig Off', '${h}', false), ('${m('new')}', 'Rig New', '${t}', true);
       update users set email_verified_at = now() where email = '${m('off')}';`);
});
test.after(() => {
  kids.forEach(k => { try { k.kill(); } catch (e) { /* gone */ } }); if (mailSrv) mailSrv.close();
  sql(`delete from otps where email like '%.${tag}@rig.test'; delete from sessions where email like '%.${tag}@rig.test'; delete from audit where actor like '%.${tag}@rig.test'; delete from counters where key like '%.${tag}@rig.test' or key like 'OI_10.9.%'; delete from users where email like '%.${tag}@rig.test';`);
});

test('the switches off: no second way in, no reminder – the password sign-in exactly as before', async () => {
  const b = browser(OFF); let r = await auth(b, 'options'); assert.deepStrictEqual(r.j, { otp: false });
  r = await auth(b, 'otpSend', { email: m('ravi') }); assert.deepStrictEqual([r.status, r.j.code], [403, 'off']); r = await auth(b, 'otpLogin', { email: m('ravi'), code: '123456' }); assert.strictEqual(r.status, 403);
  const A = await signIn(OFF, m('ravi')); r = await auth(A, 'me'); assert.deepStrictEqual([r.j.signedIn, r.j.email], [true, { verified: false, canVerify: false, remind: false }]);
  r = await auth(A, 'emailAlert'); assert.deepStrictEqual(r.j, { show: false }); r = await auth(A, 'verifySend'); assert.deepStrictEqual([r.status, r.j.code], [403, 'off']);
  assert.strictEqual(mails.length, 0);
});

test('"verify my e-mail": a code to HIS address only; wrong 5 times ends it; right once – then verified', async () => {
  const A = await signIn(ON, m('ravi')); let r = await auth(browser(ON), 'verifySend'); assert.strictEqual(r.status, 401, 'not signed in');
  r = await auth(A, 'verifySend'); assert.deepStrictEqual([r.status, r.j.ok, r.j.email, r.j.wait, r.j.minutes], [200, true, m('ravi'), 60, 10]);
  const l = mails[mails.length - 1], c1 = codeTo(m('ravi'));
  assert.deepStrictEqual([l.to, l.from, l.auth, l.path], [[m('ravi')], 'RCL ERP <no-reply@rig.test>', 'Bearer re_rig_test_value', '/emails']); assert.match(c1, /^\d{6}$/); assert.match(l.text, /valid for 10 minutes and works once\. Never tell this code to anybody/); assert.match(l.html, /Verify your e-mail/);
  assert.ok(!sql(`select code_hash from otps where email = '${m('ravi')}'`).includes(c1) && /^[0-9a-f]{64}$/.test(sql(`select code_hash from otps where email = '${m('ravi')}' order by id desc limit 1`)), 'kept as a hash only');
  assert.ok(!sql(`select coalesce(string_agg(coalesce(detail::text, '') || action || coalesce(target, ''), ' '), '') from audit where actor = '${m('ravi')}'`).includes(c1), 'never in the activity record');
  r = await auth(A, 'verifySend'); assert.deepStrictEqual([r.status, r.j.code], [429, 'wait'], '60 seconds between two codes'); assert.strictEqual(mails.filter(x => x.to[0] === m('ravi')).length, 1);
  // five wrong tries: the code is dead, the right one too
  for (let i = 0; i < 5; i++) { r = await auth(A, 'verifyCheck', { code: c1 === '000000' ? '111111' : '000000' }); assert.deepStrictEqual([r.status, r.j.code], [400, 'code']); }
  r = await auth(A, 'verifyCheck', { code: c1 }); assert.strictEqual(r.status, 400, 'after 5 wrong tries the code is ended'); assert.strictEqual((await auth(A, 'me')).j.email.verified, false);
  // a new code ends the one before; the new one works once
  ago(m('ravi'), 61); r = await auth(A, 'verifySend'); assert.strictEqual(r.status, 200); const c2 = codeTo(m('ravi')); ago(m('ravi'), 61); r = await auth(A, 'verifySend'); const c3 = codeTo(m('ravi')); assert.strictEqual(r.status, 200);
  if (c2 !== c3) { r = await auth(A, 'verifyCheck', { code: c2 }); assert.strictEqual(r.status, 400, 'the code before the newest is ended'); }
  r = await auth(A, 'verifyCheck', { code: ' ' + c3.slice(0, 3) + ' ' + c3.slice(3) }); assert.deepStrictEqual([r.status, r.j.verified], [200, true]);
  assert.deepStrictEqual((await auth(A, 'me')).j.email, { verified: true, canVerify: true, remind: true, login: m('ravi') }); assert.strictEqual(sql(`select count(*) from audit where actor = '${m('ravi')}' and action = 'Email verified'`), '1');
  r = await auth(A, 'verifyCheck', { code: c3 }); assert.deepStrictEqual(r.j, { ok: true, verified: true }, 'already verified: nothing more');
  // the mail service refuses: said, nothing verified
  const B = await signIn(ON, m('asha')); mailFails = true; r = await auth(B, 'verifySend'); mailFails = false; assert.deepStrictEqual([r.status, r.j.code], [502, 'mail']); assert.strictEqual((await auth(B, 'me')).j.email.verified, false);
  // a person with a one-time password sets his own first
  const N = browser(ON); r = await auth(N, 'login', { email: m('new'), password: OWN }); assert.strictEqual(r.j.mustChange, true); r = await auth(N, 'verifySend'); assert.deepStrictEqual([r.status, r.j.code], [403, 'mustchange']);
});

test('sign-in with a code: only a known, active, verified user gets one – the answer is the same for everybody; once; wrong tries', async () => {
  const b = browser(ON), before = mails.length; let r = await auth(b, 'options'); assert.deepStrictEqual(r.j, { otp: true });
  const same = { ok: true, wait: 60, minutes: 10 }, sa = sql('select email from users where is_super limit 1');
  for (const e of [m('nobody'), m('asha'), m('off')].concat(sa ? [sa] : [])) { r = await auth(b, 'otpSend', { email: e }); assert.deepStrictEqual([r.status, r.j], [200, same], e); }
  assert.strictEqual(mails.length, before, 'no code to an unknown address, an unverified one, a switched-off user or the Super Admin');
  assert.strictEqual(sql(`select count(*) from otps where purpose = 'login' and email in ('${m('nobody')}', '${m('asha')}', '${m('off')}')`), '0');
  const t0 = Date.now(); r = await auth(b, 'otpSend', { email: m('ravi') }); const dt = Date.now() - t0; assert.deepStrictEqual([r.status, r.j], [200, same]); assert.ok(dt >= 850, 'the answer is not quicker for a real user (' + dt + ' ms)');
  assert.strictEqual(mails.length, before + 1); const c = codeTo(m('ravi')); assert.match(mails[mails.length - 1].html, /Your sign-in code/);
  r = await auth(b, 'otpSend', { email: m('ravi') }); assert.deepStrictEqual(r.j, same); assert.strictEqual(mails.length, before + 1, 'asked again within 60 seconds: no second code');
  r = await auth(b, 'otpLogin', { email: m('asha'), code: c }); assert.deepStrictEqual([r.status, r.j.code], [401, 'code'], 'another person\'s code');
  r = await auth(b, 'otpLogin', { email: m('ravi'), code: c === '999999' ? '111111' : '999999' }); assert.deepStrictEqual([r.status, r.j.error], [401, 'The code is wrong or has expired.']);
  r = await auth(b, 'otpLogin', { email: m('ravi'), code: c }); assert.deepStrictEqual([r.status, r.j.user.email, r.j.mustChange], [200, m('ravi'), false]);
  r = await auth(b, 'me'); assert.strictEqual(r.j.signedIn, true); assert.strictEqual(sql(`select detail->>'how' from audit where actor = '${m('ravi')}' and action = 'Login' order by id desc limit 1`), 'e-mail code');
  r = await auth(browser(ON), 'otpLogin', { email: m('ravi'), code: c }); assert.strictEqual(r.status, 401, 'a code works once');
  // an expired code
  ago(m('ravi'), 61); await auth(b, 'otpSend', { email: m('ravi') }); const c2 = codeTo(m('ravi')); sql(`update otps set expires_at = now() - interval '1 second' where email = '${m('ravi')}' and purpose = 'login' and used_at is null`);
  r = await auth(browser(ON), 'otpLogin', { email: m('ravi'), code: c2 }); assert.strictEqual(r.status, 401, 'after 10 minutes');
  // the password sign-in is untouched
  r = await auth(browser(ON), 'login', { email: m('ravi'), password: OWN }); assert.strictEqual(r.status, 200);
});

test('the limits: 5 codes an hour for one e-mail; one network address cannot ask without end', async () => {
  sql(`delete from counters where key = 'OE_${m('ravi')}'`); const b = browser(ON, '10.9.77.1'), n0 = mails.length;
  for (let i = 0; i < 7; i++) { ago(m('ravi'), 61); await auth(b, 'otpSend', { email: m('ravi') }); }
  assert.strictEqual(mails.length - n0, 5, 'the sixth and seventh in an hour are not sent');
  const c = browser(ON, '10.9.77.2'), n1 = mails.length; sql(`update users set email_verified_at = now() where email = '${m('asha')}'`);
  for (let i = 0; i < 22; i++) await auth(c, 'otpSend', { email: m('asha') });
  ago(m('asha'), 61); await auth(c, 'otpSend', { email: m('asha') }); const got = mails.length - n1;
  assert.ok(got <= 2, 'after 20 asks from one address in an hour nothing more goes out from it (sent: ' + got + ')');
  ago(m('asha'), 61); await auth(browser(ON, '10.9.77.3'), 'otpSend', { email: m('asha') }); assert.strictEqual(mails.length, n1 + got + 1, 'another address is not held back by it');
});

test('the reminder: shown while the e-mail is not verified, counted at most once an hour, never for a verified user – nothing is closed', async () => {
  sql(`update users set email_verified_at = null, email_alerts = 0, email_alert_at = null where email = '${m('asha')}'`);
  const B = await signIn(ON, m('asha')), B2 = await signIn(ON, m('asha')); let r = await auth(browser(ON), 'emailAlert'); assert.deepStrictEqual(r.j, { show: false }, 'nobody signed in');
  r = await auth(B, 'emailAlert'); assert.deepStrictEqual(r.j, { show: true, verified: false, alerts: 1, canVerify: true });
  r = await auth(B2, 'emailAlert'); assert.deepStrictEqual(r.j.alerts, 1, 'his other phone in the same hour: shown, counted once'); r = await auth(B, 'emailAlert'); assert.strictEqual(r.j.alerts, 1);
  sql(`update users set email_alert_at = now() - interval '61 minutes' where email = '${m('asha')}'`); r = await auth(B, 'emailAlert'); assert.deepStrictEqual([r.j.show, r.j.alerts], [true, 2], 'an hour later: once more');
  for (let i = 0; i < 6; i++) { sql(`update users set email_alert_at = now() - interval '61 minutes' where email = '${m('asha')}'`); await auth(B, 'emailAlert'); }
  r = await auth(B, 'me'); assert.deepStrictEqual([r.j.signedIn, r.j.email.verified], [true, false]); assert.strictEqual(sql(`select email_alerts from users where email = '${m('asha')}'`), '8', 'well past five: still signed in, nothing closed');
  assert.strictEqual(sql(`select count(*) from audit where actor = '${m('asha')}' and action = 'Reminder shown: verify e-mail'`), '8');
  const A = await signIn(ON, m('ravi')); r = await auth(A, 'emailAlert'); assert.deepStrictEqual(r.j, { show: false, verified: true });
});

/* STEP 11 (his decision of 12-11-2026): the e-mail a user was made with is his USER ID for ever; the e-mail he types and verifies
 * is the one he signs in with – from then on ONLY that one (password or code). Needs sql/portal_step11_login_email.sql on the rig. */
test('his own e-mail beside his user ID: typed, verified with a code sent THERE – then only it signs in; the user ID stays everywhere', async () => {
  const has11 = sql("select count(*) from information_schema.columns where table_name = 'users' and column_name = 'login_email'") === '1';
  if (!has11) return;      // (the rig without step 11: the tests above have shown that everything works as before)
  const h = await pw.make(OWN), id = m('pk'), real = m('pk.real'), id2 = m('second');
  sql(`insert into users (email, name, password_hash, active) values ('${id}', 'Rig Pk', '${h}', true), ('${id2}', 'Rig Second', '${h}', true)`);
  const A = await signIn(ON, id, '10.9.80.1'); let r = await auth(A, 'verifySend', { email: 'not an address' }); assert.deepStrictEqual([r.status, r.j.code], [400, 'email']);
  // never another user's address – his user ID or his verified e-mail
  r = await auth(A, 'verifySend', { email: id2 }); assert.deepStrictEqual([r.status, r.j.code], [409, 'taken']); r = await auth(A, 'verifySend', { email: m('ravi') }); assert.deepStrictEqual([r.status, r.j.code], [409, 'taken']);
  const n0 = mails.length; r = await auth(A, 'verifySend', { email: ' ' + real.toUpperCase() + ' ' }); assert.deepStrictEqual([r.status, r.j.email], [200, real]);
  assert.strictEqual(mails.length, n0 + 1); assert.deepStrictEqual(mails[mails.length - 1].to, [real], 'the code goes to the address he typed – not to his user ID');
  assert.strictEqual(sql(`select send_to from otps where email = '${id}' order by id desc limit 1`), real);
  // before the code is typed nothing has changed: the user ID still signs in, the new address does not
  r = await auth(browser(ON, '10.9.80.2'), 'login', { email: real, password: OWN }); assert.strictEqual(r.status, 401); r = await auth(browser(ON, '10.9.80.2'), 'login', { email: id, password: OWN }); assert.strictEqual(r.status, 200);
  // he changes his mind: another address – only the address of the NEWEST code can become his
  const real2 = m('pk.own'); ago(id, 61); r = await auth(A, 'verifySend', { email: real2 }); assert.strictEqual(r.status, 200); const c = codeTo(real2);
  r = await auth(A, 'verifyCheck', { code: c }); assert.deepStrictEqual([r.status, r.j.verified, r.j.login], [200, true, real2]);
  assert.strictEqual(sql(`select email || '|' || login_email || '|' || (email_verified_at is not null) from users where email = '${id}'`), id + '|' + real2 + '|true', 'the user ID is not touched');
  r = await auth(A, 'me'); assert.deepStrictEqual([r.j.user.email, r.j.email.login, r.j.signedIn], [id, real2, true], 'he stays signed in; every module still knows him by his user ID');
  // from now on: only the verified e-mail signs in – with the password …
  r = await auth(browser(ON, '10.9.80.3'), 'login', { email: id, password: OWN }); assert.deepStrictEqual([r.status, r.j.error], [401, 'Wrong email or password.'], 'the user ID no longer signs in');
  const B = browser(ON, '10.9.80.3'); r = await auth(B, 'login', { email: real2.toUpperCase(), password: OWN }); assert.deepStrictEqual([r.status, r.j.user.email], [200, id], 'the sign-in is HIS account – the user ID');
  assert.strictEqual(sql(`select count(*) from sessions where email = '${real2}'`), '0', 'no sign-in is ever kept under the typed address');
  // … or with a code, which goes to the verified e-mail
  const C = browser(ON, '10.9.80.4'), n1 = mails.length; await auth(C, 'otpSend', { email: id }); assert.strictEqual(mails.length, n1, 'asked with the user ID: no code');
  await auth(C, 'otpSend', { email: real2 }); assert.strictEqual(mails.length, n1 + 1); assert.deepStrictEqual(mails[mails.length - 1].to, [real2]);
  r = await auth(C, 'otpLogin', { email: id, code: codeTo(real2) }); assert.strictEqual(r.status, 401); r = await auth(C, 'otpLogin', { email: real2, code: codeTo(real2) }); assert.deepStrictEqual([r.status, r.j.user.email], [200, id]);
  // a module's screen lock asks by the user ID: answered, and no sign-in is made
  const s0 = sql(`select count(*) from sessions where email = '${id}'`); r = await auth(browser(ON, '10.9.80.5'), 'checkPassword', { email: id, password: OWN }); assert.deepStrictEqual([r.status, r.j], [200, { ok: true, checked: true }]);
  r = await auth(browser(ON, '10.9.80.5'), 'checkPassword', { email: id, password: OWN + 'x' }); assert.strictEqual(r.status, 401); assert.strictEqual(sql(`select count(*) from sessions where email = '${id}'`), s0);
  // nobody else can take his verified e-mail, and no new user can be made with it
  const D = await signIn(ON, id2, '10.9.80.6'); r = await auth(D, 'verifySend', { email: real2 }); assert.deepStrictEqual([r.status, r.j.code], [409, 'taken']);
  // a user who verifies the address he already has: it is his sign-in e-mail, as before
  ago(id2, 61); r = await auth(D, 'verifySend', {}); assert.deepStrictEqual([r.status, r.j.email], [200, id2]); r = await auth(D, 'verifyCheck', { code: codeTo(id2) }); assert.strictEqual(r.j.login, id2);
  r = await auth(browser(ON, '10.9.80.7'), 'login', { email: id2, password: OWN }); assert.strictEqual(r.status, 200);
});
