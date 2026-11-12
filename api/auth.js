/* POST /api/auth { action, … } – signing in and out, who am I, my password, and the Super Admin's recovery code. */
'use strict';
const BETA = require('../lib/beta');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, rpc, enc } = require('../lib/db');
const pw = require('../lib/pw');
const { isPreview } = require('../lib/preview');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, recoveryCode, codeClean } = require('../lib/util');
const crypto = require('crypto');
const W = require('../lib/who');        // (step 11) who is signing in: the verified e-mail, else the user ID
const otp = require('../lib/otp');      // (step 10) a code sent by e-mail
const mail = require('../lib/mail');

// what the dashboard shows: the sites and modules this person may open (only active sites, only modules that are live).
// (14-10-2026, asked: "super admin la pages … disle pahijet") the Super Admin (all = true) opens EVERY module of every site, as its Admin.
async function myItems(email, all) {
  const [acc, sites, mods, comps, tester] = await Promise.all([
    accessRows('email=eq.' + enc(email)),
    db('GET', 'sites?select=code,name,company_id,status,sort&order=sort.asc,code.asc'),
    BETA.modules(),      // (02-11-2026) with each module's beta link (step 7)
    db('GET', 'companies?select=id,name'),
    BETA.isTester(email)]);
  const items = [];
  (sites || []).filter(s => s.status === 'active').forEach(s => (mods || []).filter(m => m.status === 'live' && m.url).forEach(m => {
    const a = all ? { role: 'admin' } : (acc || []).find(x => x.site === s.code && x.module === m.key);
    // (02-11-2026) a TESTER opens the module's beta copy (when it has one) – here for the app's links and for /api/go alike
    if (a) items.push(Object.assign({ site: s.code, siteName: s.name, company: ((comps || []).find(c => c.id === s.company_id) || {}).name || '', module: m.key, moduleName: m.name, url: BETA.urlFor(m, tester), role: a.role, pages: a.pages || null },
      tester && m.beta_url ? { beta: true } : {}));
  }));
  /* (12-11-2026, his picture: "ata he 2 disat ahet hr") ONE HR A SITE: "My HR" (hrme – an employee for himself) is the SAME module
   * as "RCL HR" (hr – the HR office) seen with less. Whoever has the office's on a site (also the Super Admin, who has every
   * module) has his own attendance in it already – his list, the modules' rail and the app show HR once, not twice. */
  return items.filter(x => !(x.module === 'hrme' && items.some(y => y.site === x.site && y.module === 'hr')));
}

// access rows with their pages (step 3); without the step-3 SQL: the same rows without pages (every page, as before)
async function accessRows(where) {
  try { return await db('GET', 'access?select=email,site,module,role,pages' + (where ? '&' + where : '')); }
  catch (e) { if (/42703|pages/.test(String(e && e.message))) return db('GET', 'access?select=email,site,module,role' + (where ? '&' + where : '')); throw e; }
}
// his start ('module|SITE' or ''), or null where the step-2 SQL is not run yet (the column is not there)
async function startOf(email) {
  try { const r = ((await db('GET', 'users?select=start_item&email=eq.' + enc(email))) || [])[0]; return (r && r.start_item) || ''; }
  catch (e) { if (/42703|start_item/.test(String(e && e.message))) return null; throw e; }
}

/* (12-11-2026, the Portal's step 10) HIS E-MAIL: proved his own (he typed the code sent to it) or not yet; how often he was told.
 * null where the step-10 SQL is not run yet – everything of the codes is then simply not there (password sign-in as before). */
// (step 11) + login: the e-mail he verified and signs in with ('' = his user ID); step11: that SQL is run
async function emailOf(email) {
  const shape = (r, s11) => r ? { verified: !!r.email_verified_at, alerts: Number(r.email_alerts) || 0, at: r.email_alert_at, login: String(r.login_email || '').toLowerCase(), step11: s11 } : null;
  try {
    try { return shape(((await db('GET', 'users?select=email_verified_at,email_alerts,email_alert_at,login_email&email=eq.' + enc(email))) || [])[0], true); }
    catch (e) { if (!W.noStep11(e) || !/login_email/.test(String(e.message))) throw e; return shape(((await db('GET', 'users?select=email_verified_at,email_alerts,email_alert_at&email=eq.' + enc(email))) || [])[0], false); }
  } catch (e) { if (otp.noStep(e)) return null; throw e; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WRONG_CODE = 'The code is wrong or has expired.';

const ACTIONS = {
  // what the sign-in page offers (asked before anybody is signed in): the second way in – a code by e-mail – when it is switched on
  async options() { return { body: { otp: otp.on('OTP_LOGIN') } }; },
  /* SIGN-IN WITH A CODE, step 1: "send me a code". A code goes ONLY to a user of the Portal who is active, not the Super Admin,
   * and whose e-mail is verified – never to an address the Portal does not know. The answer is the same whoever asks and takes
   * about the same time, so nobody learns from it whether an e-mail is a user's. */
  async otpSend(req, x) {
    if (!otp.on('OTP_LOGIN')) throw fail(403, 'Sign-in with a code is not switched on.', 'off');
    const t0 = Date.now(), email = lc(x.email).slice(0, 120);
    if (!EMAIL.test(email)) throw fail(400, 'Enter your email.');
    let why = '';
    try {
      const u = await W.who(email, 'email,active,is_super'), e = u ? await emailOf(u.email) : null;      // (step 11) by the e-mail he signs in with
      why = !u ? 'unknown email' : !u.active ? 'not active' : u.is_super ? 'the Super Admin signs in with his password' : !e ? 'step 10 not run' : !e.verified ? 'e-mail not verified' : '';
      if (!why) { const r = await otp.send(req, u.email, 'login', e.login || u.email); why = r.sent ? '' : r.why; if (r.sent) await audit(u.email, 'Sign-in code sent', '', null); }
      if (why && why !== 'cooldown' && why !== 'unknown email') await audit(email, 'Sign-in code not sent', '', { why: why });
    } catch (e) { console.error('[otpSend] ' + String((e && e.message) || e)); }
    const left = 900 + crypto.randomInt(0, 300) - (Date.now() - t0); if (left > 0) await sleep(left);
    return { body: { ok: true, wait: otp.COOL_S, minutes: otp.MINUTES } };
  },
  // step 2: the code. Right → the same sign-in as with the password (the same access, the same rules); it works once.
  async otpLogin(req, x) {
    if (!otp.on('OTP_LOGIN')) throw fail(403, 'Sign-in with a code is not switched on.', 'off');
    const email = lc(x.email).slice(0, 120);
    if (!EMAIL.test(email) || !String(x.code || '').trim()) throw fail(400, 'Enter your email and the code.');
    const lim = await ses.limit(email);
    const u = await W.who(email, 'email,name,password_hash,active,is_super'), e = u && u.active && !u.is_super ? await emailOf(u.email) : null;
    const good = !!e && e.verified && await otp.check(u.email, 'login', x.code);
    if (!good) { await audit(email, 'Login failed', '', { why: 'code' }); throw fail(401, WRONG_CODE, 'code'); }
    await lim.right();
    const cookie = await ses.create(req, u.email);
    await db('PATCH', 'users?email=eq.' + enc(u.email), { last_login_at: new Date().toISOString() }, 'return=minimal');
    await audit(u.email, 'Login', '', { how: 'e-mail code' });
    return { body: { user: { email: u.email, name: u.name, super: false }, mustChange: pw.mustChange(u.password_hash) }, headers: { 'Set-Cookie': cookie } };
  },
  /* "VERIFY MY E-MAIL" (signed in with his password): a code goes to HIS e-mail; typed right, the e-mail is his – only then can he
   * sign in with a code. Nobody – not the Super Admin either – can mark an e-mail verified without the code. */
  async verifySend(req, x) {
    const u = (await ses.need(req, { ownPassword: true })).user;
    if (!otp.on('OTP_LOGIN')) throw fail(403, 'Verifying the e-mail is not switched on yet.', 'off');
    if (u.is_super) throw fail(400, 'The Super Admin signs in with his password and his recovery code – he needs no code.', 'super');
    const e = await emailOf(u.email); if (!e) throw fail(500, otp.NOSTEP, 'nostep');
    if (e.verified) return { body: { ok: true, verified: true } };
    if (mail.missing()) throw fail(500, 'The e-mail service is not set up yet – tell the Super Admin.', 'nomail');
    /* (step 11; "user tyacha email change kru shakel … verify dabel otp yel") the address he types – his own, real one; his user
     * ID stays as it is. Never an address that is another user's (his user ID or his verified e-mail). */
    const to = lc(x && x.email).slice(0, 120) || u.email;
    if (!EMAIL.test(to)) throw fail(400, 'Type your own e-mail address.', 'email');
    if (to !== u.email) {
      if (!e.step11) throw fail(500, 'Another e-mail than your user ID needs the Portal\'s database step 11 first: sql/portal_step11_login_email.sql – tell the Super Admin.', 'nostep');
      if (await W.taken(to, u.email)) throw fail(409, 'This e-mail is already another user\'s. Type your own.', 'taken');
    }
    const r = await otp.send(req, u.email, 'verify', to);
    if (!r.sent) {
      if (r.why === 'cooldown') throw fail(429, 'A code was just sent. Wait ' + r.wait + ' seconds before asking for another.', 'wait');
      if (r.wait) throw fail(429, 'Too many codes were asked for. Try again later.', 'busy');
      await audit(u.email, 'Verification code not sent', '', { why: r.why });
      throw fail(502, 'The code could not be sent to ' + to + '. Check the address; else try again in a while.', 'mail');
    }
    await audit(u.email, 'Verification code sent', '', to !== u.email ? { to: to } : null);
    return { body: { ok: true, email: to, wait: r.wait, minutes: otp.MINUTES } };
  },
  async verifyCheck(req, x) {
    const u = (await ses.need(req, { ownPassword: true })).user;
    const e = await emailOf(u.email); if (!e) throw fail(500, otp.NOSTEP, 'nostep');
    if (e.verified) return { body: { ok: true, verified: true } };
    const id = await otp.check(u.email, 'verify', x.code); if (!id) throw fail(400, WRONG_CODE, 'code');
    // exactly the address THIS code went to becomes his sign-in e-mail (step 11); his user ID is not touched
    const to = (await otp.sentTo(id)) || u.email;
    if (to !== u.email && await W.taken(to, u.email)) throw fail(409, 'This e-mail is already another user\'s. Type your own.', 'taken');
    try { await db('PATCH', 'users?email=eq.' + enc(u.email), Object.assign({ email_verified_at: new Date().toISOString() }, e.step11 ? { login_email: to } : {}), 'return=minimal'); }
    catch (er) { if (er && er.code === 'duplicate') throw fail(409, 'This e-mail is already another user\'s. Type your own.', 'taken'); throw er; }
    await audit(u.email, 'Email verified', '', to !== u.email ? { signIn: to } : null);
    return { body: { ok: true, verified: true, login: to } };
  },
  /* THE REMINDER (his decision of 12-11-2026: "5 alert nantr access band nahi karaycha … alert det rahayche every 1 hour"): while
   * his e-mail is not verified the page and the app show "verify your e-mail" – nothing is ever closed for him. Asked by the open
   * page / app; the count is moved on at most once an hour, in the database (two phones in the same hour count once). */
  async emailAlert(req) {
    const s = await ses.read(req);
    if (!s || s.user.is_super || !otp.on('EMAIL_ALERTS') || pw.mustChange(s.user.password_hash)) return { body: { show: false } };
    const e = await emailOf(s.user.email); if (!e || e.verified) return { body: { show: false, verified: e ? true : undefined } };
    const now = Date.now(), hour = new Date(now - 3600000).toISOString();
    let n = e.alerts;
    if (!e.at || Date.parse(e.at) <= now - 3600000) {
      // counted only while the hour is over in the DATABASE (his two phones at the same moment: once); read again – ours when it carries this request's time
      await db('PATCH', 'users?email=eq.' + enc(s.user.email) + '&email_verified_at=is.null&or=(email_alert_at.is.null,email_alert_at.lte.' + enc(hour) + ')', { email_alerts: e.alerts + 1, email_alert_at: new Date(now).toISOString() }, 'return=minimal');
      const z = await emailOf(s.user.email); if (z) n = z.alerts;
      if (z && z.at && Date.parse(z.at) === now) await audit(s.user.email, 'Reminder shown: verify e-mail', '', { n: n });
    }
    return { body: { show: true, verified: false, alerts: n, canVerify: otp.on('OTP_LOGIN') } };
  },
  async login(req, x) {
    const email = lc(x.email).slice(0, 120), password = String(x.password || '');
    if (!EMAIL.test(email) || !password) throw fail(400, 'Enter your email and password.');
    const lim = await ses.limit(email);
    // (step 11) the e-mail he signs in with: the one he verified – else, while nothing is verified, his user ID
    const u = await W.who(email, 'email,name,password_hash,active,is_super'), id = u ? u.email : email;
    const good = !!u && u.active && !!u.password_hash && await pw.check(password, u.password_hash);
    if (!good) {
      if (!u) await pw.dummy(password);
      await audit(email, 'Login failed', '', { why: !u ? 'unknown email' : !u.active ? 'not active' : 'wrong password' });
      throw fail(401, 'Wrong email or password.', 'wrong');
    }
    await lim.right();
    // kept afresh with today's settings (the person notices nothing; a plain password written by hand becomes a one-time one)
    let stored = u.password_hash;
    if (!pw.current(stored)) {
      const temp = !pw.isHashed(stored), m = String(stored).replace(/^tmp\$/, '').match(pw.RE);
      stored = (temp ? 'tmp$' : '') + await pw.make(password, m ? m[5] : '');
      await db('PATCH', 'users?email=eq.' + enc(id), { password_hash: stored }, 'return=minimal');
    }
    const cookie = await ses.create(req, id);
    await db('PATCH', 'users?email=eq.' + enc(id), { last_login_at: new Date().toISOString() }, 'return=minimal');
    await audit(id, 'Login', '', null);
    return { body: { user: { email: u.email, name: u.name, super: !!u.is_super }, mustChange: pw.mustChange(stored) }, headers: { 'Set-Cookie': cookie } };
  },
  /* A MODULE ASKS "IS THIS HIS PASSWORD?" (step 11 – Mechanical's screen lock, server/portal.js): asked by his USER ID, which a
   * module always knows him by – also when he signs in with another, verified e-mail. The same check and the same limits as a
   * sign-in (5 wrong in 15 minutes → refused); NO sign-in is made, so nothing opens with it. */
  async checkPassword(req, x) {
    const email = lc(x.email).slice(0, 120), password = String(x.password || '');
    if (!EMAIL.test(email) || !password) throw fail(400, 'Enter your email and password.');
    const lim = await ses.limit(email);
    const u = ((await db('GET', 'users?select=email,password_hash,active&email=eq.' + enc(email))) || [])[0];
    const good = !!u && u.active && !!u.password_hash && await pw.check(password, u.password_hash);
    if (!good) { if (!u) await pw.dummy(password); await audit(email, 'Password check failed', '', null); throw fail(401, 'Wrong email or password.', 'wrong'); }
    await lim.right();
    return { body: { ok: true, checked: true } };
  },
  async logout(req) {
    const s = await ses.read(req);
    await ses.end(req);
    if (s) await audit(s.user.email, 'Logout', '', null);
    return { body: { ok: true }, headers: { 'Set-Cookie': ses.clearCookie(req) } };
  },
  async me(req) {
    const s = await ses.read(req);
    if (!s) return { body: { signedIn: false, preview: isPreview() || undefined } };
    const u = s.user, must = pw.mustChange(u.password_hash), items = must ? [] : await myItems(u.email, !!u.is_super);
    // his start (the module that opens straight after sign-in) – only while he still has it
    const st = items.length ? await startOf(u.email) : null, start = st === null ? '' : st;
    const em = u.is_super ? null : await emailOf(u.email);      // (step 10) his e-mail: verified or not; null = not asked of him / step 10 not run
    return { body: { signedIn: true, preview: isPreview() || undefined, user: { email: u.email, name: u.name, super: !!u.is_super, tester: (await BETA.isTester(u.email)) || undefined }, mustChange: must, items: items,
      email: em ? { verified: em.verified, canVerify: otp.on('OTP_LOGIN'), remind: otp.on('EMAIL_ALERTS'), login: em.verified ? em.login || u.email : undefined } : undefined,
      start: items.some(i => i.module + '|' + i.site === start) ? start : '', startReady: st !== null } };
  },
  // "My start": the module (on a site) that opens straight after his sign-in – one of his own; empty = the dashboard
  async setStart(req, x) {
    const s = await ses.need(req), u = s.user;
    const want = x.module ? String(x.module) + '|' + String(x.site || '').toUpperCase() : '';
    if (want && !(await myItems(u.email, !!u.is_super)).some(i => i.module + '|' + i.site === want)) throw fail(403, 'You do not have that module on that site.', 'noaccess');
    if (await startOf(u.email) === null) throw fail(500, 'This needs one database step first: run sql/portal_step2_start.sql once in the Portal\'s Supabase → SQL Editor.', 'nostep');
    await db('PATCH', 'users?email=eq.' + enc(u.email), { start_item: want || null }, 'return=minimal');
    await audit(u.email, 'Start module', want || '(dashboard)', null);
    return { body: { ok: true, start: want } };
  },
  async changePassword(req, x) {
    const s = await ses.need(req), u = s.user;
    const t = await rpc('portal_hit', { p_key: 'CP_' + u.email, p_ttl: 900 });
    if (Number(t) > 5) throw fail(429, 'Too many wrong attempts. Try again after 15 minutes.', 'locked');
    if (!await pw.check(String(x.old || ''), u.password_hash)) throw fail(400, 'Current password is wrong.', 'oldpw');
    await rpc('portal_unhit', { p_key: 'CP_' + u.email });
    const bad = pw.policy(x.password); if (bad) throw fail(400, bad, 'policy');
    if (String(x.password) === String(x.old)) throw fail(400, 'Choose a password different from the current one.', 'policy');
    await db('PATCH', 'users?email=eq.' + enc(u.email), { password_hash: await pw.make(String(x.password)) }, 'return=minimal');
    await ses.endAll(u.email);                       // every sign-in of his ends …
    const cookie = await ses.create(req, u.email);   // … and this one starts afresh
    await audit(u.email, 'Password changed', '', { note: 'other sign-ins ended' });
    return { body: { ok: true }, headers: { 'Set-Cookie': cookie } };
  },
  // the Super Admin forgot his password: the recovery code written down → a new password and a NEW recovery code
  async recover(req, x) {
    const email = lc(x.email).slice(0, 120);
    const t = await rpc('portal_hit', { p_key: 'SAR_' + email, p_ttl: 900 });
    if (Number(t) > 5) throw fail(429, 'Too many wrong attempts. Try again after 15 minutes.', 'locked');
    const u = ((await db('GET', 'users?select=email,is_super,recovery_hash&email=eq.' + enc(email))) || [])[0];
    const good = !!u && u.is_super && !!u.recovery_hash && await pw.check(codeClean(x.code), u.recovery_hash);
    if (!good) { if (!u) await pw.dummy(x.code); throw fail(400, 'The email or the recovery code is wrong.', 'recovery'); }
    const bad = pw.policy(x.password); if (bad) throw fail(400, bad, 'policy');
    await rpc('portal_unhit', { p_key: 'SAR_' + email });
    const fresh = recoveryCode();
    await db('PATCH', 'users?email=eq.' + enc(email), { password_hash: await pw.make(String(x.password)), recovery_hash: await pw.make(codeClean(fresh)) }, 'return=minimal');
    await ses.endAll(email);
    await audit(email, 'Password changed', '', { note: 'with the recovery code; a new recovery code was given' });
    return { body: { ok: true, recovery: fresh } };
  },
};

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), a = String(x.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, a)) return send(res, 404, { error: 'Unknown action.' });
  const out = await ACTIONS[a](req, x);
  send(res, 200, out.body, out.headers);
});
module.exports.myItems = myItems;
module.exports.accessRows = accessRows;
