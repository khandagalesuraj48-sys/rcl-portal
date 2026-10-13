/* POST /api/auth { action, … } – signing in and out, who am I, my password, and the Super Admin's recovery code. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, rpc, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, recoveryCode, codeClean } = require('../lib/util');

// what the dashboard shows: the sites and modules this person may open (only active sites, only modules that are live)
async function myItems(email) {
  const [acc, sites, mods, comps] = await Promise.all([
    db('GET', 'access?select=site,module,role&email=eq.' + enc(email)),
    db('GET', 'sites?select=code,name,company_id,status,sort&order=sort.asc,code.asc'),
    db('GET', 'modules?select=key,name,url,status,sort&order=sort.asc,key.asc'),
    db('GET', 'companies?select=id,name')]);
  const items = [];
  (sites || []).filter(s => s.status === 'active').forEach(s => (mods || []).filter(m => m.status === 'live' && m.url).forEach(m => {
    const a = (acc || []).find(x => x.site === s.code && x.module === m.key);
    if (a) items.push({ site: s.code, siteName: s.name, company: ((comps || []).find(c => c.id === s.company_id) || {}).name || '', module: m.key, moduleName: m.name, url: m.url, role: a.role });
  }));
  return items;
}

// his start ('module|SITE' or ''), or null where the step-2 SQL is not run yet (the column is not there)
async function startOf(email) {
  try { const r = ((await db('GET', 'users?select=start_item&email=eq.' + enc(email))) || [])[0]; return (r && r.start_item) || ''; }
  catch (e) { if (/42703|start_item/.test(String(e && e.message))) return null; throw e; }
}

const ACTIONS = {
  async login(req, x) {
    const email = lc(x.email).slice(0, 120), password = String(x.password || '');
    if (!EMAIL.test(email) || !password) throw fail(400, 'Enter your email and password.');
    const lim = await ses.limit(email);
    const u = ((await db('GET', 'users?select=email,name,password_hash,active,is_super&email=eq.' + enc(email))) || [])[0];
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
      await db('PATCH', 'users?email=eq.' + enc(email), { password_hash: stored }, 'return=minimal');
    }
    const cookie = await ses.create(req, email);
    await db('PATCH', 'users?email=eq.' + enc(email), { last_login_at: new Date().toISOString() }, 'return=minimal');
    await audit(email, 'Login', '', null);
    return { body: { user: { email: u.email, name: u.name, super: !!u.is_super }, mustChange: pw.mustChange(stored) }, headers: { 'Set-Cookie': cookie } };
  },
  async logout(req) {
    const s = await ses.read(req);
    await ses.end(req);
    if (s) await audit(s.user.email, 'Logout', '', null);
    return { body: { ok: true }, headers: { 'Set-Cookie': ses.clearCookie(req) } };
  },
  async me(req) {
    const s = await ses.read(req);
    if (!s) return { body: { signedIn: false } };
    const u = s.user, must = pw.mustChange(u.password_hash), items = u.is_super || must ? [] : await myItems(u.email);
    // his start (the module that opens straight after sign-in) – only while he still has it
    const st = items.length ? await startOf(u.email) : null, start = st === null ? '' : st;
    return { body: { signedIn: true, user: { email: u.email, name: u.name, super: !!u.is_super }, mustChange: must, items: items,
      start: items.some(i => i.module + '|' + i.site === start) ? start : '', startReady: st !== null } };
  },
  // "My start": the module (on a site) that opens straight after his sign-in – one of his own; empty = the dashboard
  async setStart(req, x) {
    const s = await ses.need(req), u = s.user;
    if (u.is_super) throw fail(400, 'The Super Admin opens no module.', 'super');
    const want = x.module ? String(x.module) + '|' + String(x.site || '').toUpperCase() : '';
    if (want && !(await myItems(u.email)).some(i => i.module + '|' + i.site === want)) throw fail(403, 'You do not have that module on that site.', 'noaccess');
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
