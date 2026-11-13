/* POST /api/hrlogin { site, email, name } – AN EMPLOYEE'S SIGN-IN, given from HR (asked 12-11-2026: "ADMIN … LA EK TEMP PASSWORD DEU
 * SHAKEL NANTR USER SWATACHA PASS SET KRU SHAKEL … USER PASS VISRLA TRI ADMIN … TEMP PASS DUSRA DEU SHAKEL"; "HR NAHI … ADMIN OR
 * SUPER ADMIN BANWEL FKT").
 *   WHO: the Super Admin, or the HR ADMIN of that site (access: module "hr", role admin). Not an HR User, nobody else.
 *   WHAT: the employee (his e-mail) becomes a user of the Portal with a ONE-TIME password – at his first sign-in he sets his own –
 *   and gets "My HR" (module "hrme") on that site: his own attendance, nothing else. Asked again (he forgot his password): a new
 *   one-time password; his sign-ins end at once. The one-time password is made here, answered ONCE and kept nowhere in plain text.
 *   THE LIMIT (so that HR can never take over another person's account): it works only for a person who has NOTHING but "My HR".
 *   A user with any other module on any site, the Super Admin, or a user the Super Admin switched off is refused – that stays the
 *   Super Admin's (Users & Access). Every use is written in the activity record.
 * (13-11-2026 – the Portal's step 12; "login email plus mobile number … first time same pass … employee name first letter capital
 *  baki name small @ 1234 … visrla tyala new temp pass … tewa wegla asel … super admin tharwel konala deyche")
 *   – { site, email, mobile, name }: an employee has an E-MAIL, a MOBILE NUMBER, or both – at least one. His mobile number is put on
 *     his user (he signs in with it and his password); with no e-mail his user ID is made of his number (<number>@mobile.id).
 *   – the FIRST password of a new user is his first name, its first letter a capital, then "@1234" (Ramesh@1234) – a one-time
 *     password: he sets his own at his first sign-in. A person who forgot his: a new one-time password of ANOTHER make (ten
 *     letters and digits by chance), as before. A name the first password cannot be made from: a password by chance too.
 *   – { site, people: [ { email, mobile, name } … ] } (at most 25 a call): the same for many – ONLY new users are made, nobody's
 *     password is changed; each person comes back as made / has it already / refused with why. No password is answered: a new
 *     user's follows the rule above. WHO may press it in HR is HR's own setting (a power the Super Admin gives a site's HR
 *     Admin); the Portal's own check is the same as for one person. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, clean } = require('../lib/util');
const W = require('../lib/who');      // (steps 11, 12) who a sign-in belongs to: the e-mail, the mobile number
const HR = 'hr', SELF = 'hrme';
// 10 characters, easy to read out and to type (no 0 O 1 l I), always a letter and a digit
function oneTime() {
  const L = 'abcdefghjkmnpqrstuvwxyz', U = 'ABCDEFGHJKMNPQRSTUVWXYZ', N = '23456789', all = L + U + N, pick = s => s[crypto.randomInt(s.length)];
  const c = [pick(U), pick(L), pick(N), pick(N)]; while (c.length < 10) c.push(pick(all));
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
// the first password of a new user: his first name – first letter a capital, the rest small – and "@1234"; null = cannot be made
function firstPassword(name) { const w = (String(name || '').trim().split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, ''); return w.length >= 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() + '@1234' : null; }

/* one employee → { added, id, password? (only when wanted), state }. bulk: only a NEW user is made – nobody's password is changed. */
async function give(me, site, p, s12, bulk) {
  const email = lc(p.email), mobile = W.mobileOf(p.mobile), name = clean(p.name, 80);
  if (email && (!EMAIL.test(email) || email.length > 120 || W.isMobileId(email))) throw fail(400, 'This employee\'s e-mail is not a proper e-mail – correct it in his record.', 'email');
  if (!blank(p.mobile) && !mobile) throw fail(400, 'This employee\'s mobile number is not a 10-digit mobile number – correct it in his record.', 'mobile');
  if (!email && !mobile) throw fail(400, 'This employee has no e-mail and no mobile number – put one of them in his record first.', 'email');
  if (!email && !s12) throw fail(500, 'A sign-in with a mobile number needs the Portal\'s database step 12 first: sql/portal_step12_mobile.sql – tell the Super Admin.', 'nostep');
  if (email && email === lc(me.email)) throw fail(400, 'Your own password is changed under "Change password".', 'self');
  const cols = 'email,name,active,is_super' + (s12 ? ',mobile' : '');
  const byMail = email ? ((await db('GET', 'users?select=' + cols + '&email=eq.' + enc(email))) || [])[0] || null : null;
  const byMob = mobile && s12 ? await W.byMobile(mobile, 'email,name,active,is_super') : null;
  // `known`: the user ID the Portal gave this employee before (HR keeps it) – a mobile number changed since then finds the same user
  const kid = W.isMobileId(lc(p.known)) ? lc(p.known) : '', byId = kid && !byMail && !byMob ? ((await db('GET', 'users?select=' + cols + '&email=eq.' + enc(kid))) || [])[0] || null : null;
  if (byMail && byMob && byMail.email !== byMob.email) throw fail(409, 'This e-mail and this mobile number belong to two different users – correct the employee\'s record, or ask the Super Admin.', 'two');
  const cur = byMail || byMob || byId;
  if (cur) {
    if (cur.email === lc(me.email)) throw fail(400, 'Your own password is changed under "Change password".', 'self');
    const other = ((await db('GET', 'access?select=module&email=eq.' + enc(cur.email) + '&module=neq.' + SELF + '&limit=1')) || []).length > 0;
    if (cur.is_super || other) throw fail(403, 'This person has other work in the ERP: his password is given only by the Super Admin (Portal → Users & Access).', 'other');
    if (!cur.active) throw fail(403, 'This user was switched off by the Super Admin – only he switches him on again.', 'off');
  } else if (name.length < 2) throw fail(400, 'This employee has no name.', 'name');
  else if (email && await W.taken(email, '')) throw fail(409, 'This e-mail is already the sign-in e-mail of another user – put the employee\'s own e-mail in his record.', 'taken');      // (step 11)
  const id = cur ? cur.email : email || W.idFor(mobile);
  let temp = '', first = false;
  if (!cur) {
    temp = firstPassword(name); first = !!temp;
    if (!temp) { if (bulk) throw fail(400, 'The first password cannot be made from this name (it needs a first name in English letters) – give him a one-time password from his own page.', 'name'); temp = oneTime(); }
    try { await db('POST', 'users', [Object.assign({ email: id, name: name, password_hash: 'tmp$' + await pw.make(temp), active: true }, s12 && mobile ? { mobile: mobile } : {})], 'return=minimal'); }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'This mobile number or e-mail was just given to another user – open the employee again.', 'taken'); throw e; }
  } else {
    if (!bulk) { temp = oneTime(); await db('PATCH', 'users?email=eq.' + enc(id), { password_hash: 'tmp$' + await pw.make(temp) }, 'return=minimal'); await ses.endAll(id); }      // a new password: his sign-ins end now
    // his mobile number of today is put on his user (a number is one user's – it is not taken from another)
    if (s12 && mobile && cur.mobile !== mobile && !byMob) { try { await db('PATCH', 'users?email=eq.' + enc(id), { mobile: mobile }, 'return=minimal'); } catch (e) { if (!(e && e.code === 'duplicate')) throw e; } }
  }
  const has = ((await db('GET', 'access?select=role&email=eq.' + enc(id) + '&site=eq.' + enc(site) + '&module=eq.' + SELF)) || []).length > 0;
  if (!has) await db('POST', 'access', [{ email: id, site: site, module: SELF, role: 'user', granted_by: me.email }], 'return=minimal');
  if (!cur || !bulk || !has) await audit(me.email, !cur ? 'Employee sign-in given' : bulk ? 'Employee sign-in: "My HR" on this site' : 'Employee sign-in: new one-time password', id, Object.assign({ site: site, module: SELF, access: has ? 'kept' : 'given' }, !cur ? { first: first ? 'by the rule' : 'by chance', mobile: !!(s12 && mobile) } : {}, bulk ? { many: true } : {}));
  return { added: !cur, id: id, password: temp, first: first, mobile: s12 && mobile ? mobile : '', state: !cur ? 'made' : 'has' };
}
const blank = v => v === undefined || v === null || String(v).trim() === '';

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'Method not allowed');
  sameSite(req);
  const me = (await ses.need(req, { ownPassword: true })).user, x = await readBody(req);
  const site = String(x.site || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(site) || !((await db('GET', 'sites?select=code&code=eq.' + enc(site) + '&status=eq.active')) || []).length) throw fail(400, 'This site was not found.', 'site');
  if (!me.is_super && !((await db('GET', 'access?select=role&email=eq.' + enc(me.email) + '&site=eq.' + enc(site) + '&module=eq.' + HR + '&role=eq.admin')) || []).length) throw fail(403, 'Only the HR Admin of this site or the Super Admin gives an employee his sign-in.', 'role');
  if (!((await db('GET', 'modules?select=key&key=eq.' + SELF + '&status=eq.live')) || []).length) throw fail(400, 'The module "My HR" (key hrme) is not in the Portal yet – the Super Admin adds it under Modules (Live).', 'nomodule');
  const s12 = await W.step12();
  /* (13-11-2026, the picture he approved: the column "Sign-in" in HR's list of employees) WHO HAS A SIGN-IN: it only READS – for each
   * person of the list (his e-mail, his mobile number, the user ID kept from before): "has" (an active user), "off" (switched off by
   * the Super Admin) or "none". Asked by the same people who may give a sign-in; nothing is made, changed or written down. */
  if (Array.isArray(x.check)) {
    if (!x.check.length || x.check.length > 500) throw fail(400, 'One to 500 people a call.', 'people');
    const ids = new Set(), mobs = new Set(), rows = x.check.map(p => {
      p = p || {}; const e = lc(p.email), email = e && EMAIL.test(e) && e.length <= 120 && !W.isMobileId(e) ? e : '', mobile = W.mobileOf(p.mobile), kid = W.isMobileId(lc(p.known)) ? lc(p.known) : '';
      if (email) ids.add(email); if (kid) ids.add(kid); if (mobile) { ids.add(W.idFor(mobile)); mobs.add(mobile); } return { email: email, mobile: mobile, kid: kid };
    });
    const byId = {}, byMob = {}, list = v => 'in.(' + enc(v.map(t => '"' + t + '"').join(',')) + ')', parts = (set, n) => { const a = [...set], o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
    for (const c of parts(ids, 40)) ((await db('GET', 'users?select=email,active&email=' + list(c))) || []).forEach(u => { byId[u.email] = u; });
    if (s12) for (const c of parts(mobs, 80)) ((await db('GET', 'users?select=email,active,mobile&mobile=' + list(c))) || []).forEach(u => { byMob[u.mobile] = u; });
    return send(res, 200, { ok: true, signins: rows.map(r => { const u = byId[r.email] || byMob[r.mobile] || byId[r.kid] || (r.mobile ? byId[W.idFor(r.mobile)] : null); return u ? (u.active ? 'has' : 'off') : 'none'; }) });
  }
  if (Array.isArray(x.people)) {      // many at once: only new users are made
    if (!x.people.length || x.people.length > 25) throw fail(400, 'One to 25 people a call.', 'people');
    const out = [];
    for (const p of x.people) {
      try { const r = await give(me, site, p || {}, s12, true); out.push({ state: r.state, id: r.id, first: r.first, mobile: r.mobile }); }
      catch (e) { if (!(e && e.status && e.status < 500) && !(e && e.code === 'nostep')) throw e; out.push({ state: 'refused', why: e.message, code: e.code || '' }); }
    }
    return send(res, 200, { ok: true, people: out, step12: s12 });
  }
  const r = await give(me, site, x, s12, false);
  send(res, 200, { ok: true, added: r.added, email: r.id, id: r.id, password: r.password, first: r.first, mobile: r.mobile, step12: s12 });
});
module.exports.oneTime = oneTime; module.exports.firstPassword = firstPassword;
