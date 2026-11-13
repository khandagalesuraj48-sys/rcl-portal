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
 * (13-11-2026, the Portal's step 12 – "login email plus mobile number … mobile number gela tr password ni login"; "employee name first
 *  letter capital baki small @ 1234 … first time sathi"; "visrla tyala new temp pass … tewa wegla asel"; "super admin tharwel konala
 *  deyche … button"):
 *   – an employee is given his sign-in with his E-MAIL, his MOBILE NUMBER, or both. With an e-mail his user ID is that e-mail (as
 *     before); with a mobile number only, his user ID is made of the number (…@mobile.invalid – never a real address). The mobile
 *     number is kept on his sign-in (users.mobile – one number, one user) and opens it with the password.
 *   – his FIRST password is his first name, first letter capital, and "@1234" (Ramesh@1234) – one-time: at his first sign-in he
 *     sets his own. Asked again for the same person (he forgot it): a one-time password made by chance, as before.
 *   – MANY AT ONCE { site, rows: [...] } (after an import): each person who has no sign-in yet gets one; a person who has one is
 *     NOT given a new password – only his mobile number is brought up to date. At most 25 people in one request.
 *   Body: { site, email, mobile, name, id } – id = the user ID HR keeps for him (so that a changed e-mail / number finds him). */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, clean } = require('../lib/util');
const W = require('../lib/who');
const HR = 'hr', SELF = 'hrme';
// 10 characters, easy to read out and to type (no 0 O 1 l I), always a letter and a digit
function oneTime() {
  const L = 'abcdefghjkmnpqrstuvwxyz', U = 'ABCDEFGHJKMNPQRSTUVWXYZ', N = '23456789', all = L + U + N, pick = s => s[crypto.randomInt(s.length)];
  const c = [pick(U), pick(L), pick(N), pick(N)]; while (c.length < 10) c.push(pick(all));
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
// (13-11-2026) the first password: his first name – first letter capital, the rest small – and "@1234". '' = the name gives none
function firstPass(name) { const w = String(name || '').trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, ''); return w.length >= 2 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() + '@1234' : ''; }

/* one employee → { ok, id, added, password?, why?, code? }. many = asked with many at once (nobody's password is made anew). */
async function give(me, site, r, many) {
  const email = lc(r.email), name = clean(r.name, 80), id0 = lc(r.id), typedMob = String(r.mobile === undefined || r.mobile === null ? '' : r.mobile).trim(), mob = W.mobile(typedMob);
  if (typedMob && !mob) throw fail(400, 'This employee\'s mobile number is not a proper one (10 digits) – correct it in his record first.', 'mobile');
  if (email && (!EMAIL.test(email) || email.length > 120 || W.noMail(email))) throw fail(400, 'This employee has no proper e-mail – put it in his record first.', 'email');
  if (!email && !mob) throw fail(400, 'This employee has neither an e-mail nor a mobile number – put one of them in his record first.', 'email');
  if (email && email === lc(me.email)) throw fail(400, 'Your own password is changed under "Change password".', 'self');
  const cols = 'email,name,active,is_super', one = async q => ((await db('GET', 'users?select=' + cols + '&email=eq.' + enc(q))) || [])[0] || null;
  // who he is in the Portal: the user ID HR keeps for him; else his e-mail; without an e-mail, his mobile number
  // (a person with an e-mail is never taken for the user of a mobile number alone – another person may have typed that number)
  const cur = (id0 && await one(id0)) || (email ? await one(email) : await W.byMobile(mob, cols)) || null;
  if (cur && cur.email === lc(me.email)) throw fail(400, 'Your own password is changed under "Change password".', 'self');
  if (cur) {
    const other = ((await db('GET', 'access?select=module&email=eq.' + enc(cur.email) + '&module=neq.' + SELF + '&limit=1')) || []).length > 0;
    if (cur.is_super || other) throw fail(403, 'This person has other work in the ERP: his password is given only by the Super Admin (Portal → Users & Access).', 'other');
    if (!cur.active) throw fail(403, 'This user was switched off by the Super Admin – only he switches him on again.', 'off');
  } else if (name.length < 2) throw fail(400, 'This employee has no name.', 'name');
  else if (email && await W.taken(email, '')) throw fail(409, 'This e-mail is already the sign-in e-mail of another user – put the employee\'s own e-mail in his record.', 'taken');      // (step 11)
  const id = cur ? cur.email : email || W.mobileId(mob);
  // his mobile number belongs to ONE user
  if (mob) { const o = await W.byMobile(mob, 'email'); if (o && o.email !== id) throw fail(409, 'This mobile number is already on the sign-in of another user – put the employee\'s own number in his record.', 'mobiletaken'); }
  const fresh = !cur || (!many && !!cur), temp = !fresh ? '' : cur ? oneTime() : firstPass(name) || oneTime(), hash = temp ? 'tmp$' + await pw.make(temp) : '';
  let kept = !mob;      // (the mobile number is kept only where the step-12 SQL is run)
  const withMobile = async (row, write) => { try { await write(mob ? Object.assign({ mobile: mob }, row) : row); kept = true; } catch (e) { if (!mob || !W.noStep12(e) || e.code === 'duplicate') throw e;
    if (!email && !cur) throw fail(500, 'Signing in with a mobile number needs one database step of the Portal first: sql/portal_step12_mobile.sql – tell the Super Admin.', 'nostep');
    if (Object.keys(row).length) await write(row); } };
  if (cur) { await withMobile(hash ? { password_hash: hash } : {}, row => Object.keys(row).length ? db('PATCH', 'users?email=eq.' + enc(id), row, 'return=minimal') : null); if (hash) await ses.endAll(id); }      // a new password: his sign-ins end now
  else await withMobile({ email: id, name: name, password_hash: hash, active: true }, row => db('POST', 'users', [row], 'return=minimal'));
  const has = ((await db('GET', 'access?select=role&email=eq.' + enc(id) + '&site=eq.' + enc(site) + '&module=eq.' + SELF)) || []).length > 0;
  if (!has) await db('POST', 'access', [{ email: id, site: site, module: SELF, role: 'user', granted_by: me.email }], 'return=minimal');
  if (!cur || hash || !has) await audit(me.email, !cur ? 'Employee sign-in given' : hash ? 'Employee sign-in: new one-time password' : 'Employee sign-in: "My HR" given', id, Object.assign({ site: site, module: SELF, access: has ? 'kept' : 'given' }, mob ? { mobile: kept ? 'kept' : 'not kept (step 12)' } : {}, many ? { many: true } : {}));
  return Object.assign({ ok: true, added: !cur, id: id, email: id, mobile: mob && kept ? mob : '' }, temp ? { password: temp } : {});
}

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'Method not allowed');
  sameSite(req);
  const me = (await ses.need(req, { ownPassword: true })).user, x = await readBody(req);
  const site = String(x.site || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(site) || !((await db('GET', 'sites?select=code&code=eq.' + enc(site) + '&status=eq.active')) || []).length) throw fail(400, 'This site was not found.', 'site');
  if (!me.is_super && !((await db('GET', 'access?select=role&email=eq.' + enc(me.email) + '&site=eq.' + enc(site) + '&module=eq.' + HR + '&role=eq.admin')) || []).length) throw fail(403, 'Only the HR Admin of this site or the Super Admin gives an employee his sign-in.', 'role');
  if (!((await db('GET', 'modules?select=key&key=eq.' + SELF + '&status=eq.live')) || []).length) throw fail(400, 'The module "My HR" (key hrme) is not in the Portal yet – the Super Admin adds it under Modules (Live).', 'nomodule');
  if (Array.isArray(x.rows)) {      // many at once: each person on his own – one refused does not stop the others; no password comes back
    if (!x.rows.length || x.rows.length > 25) throw fail(400, 'One to 25 people in one request.', 'rows');
    const out = [];
    for (const r of x.rows) { try { const g = await give(me, site, r || {}, true); out.push({ ok: true, id: g.id, added: g.added, mobile: g.mobile, first: !!g.password }); } catch (e) { if (!e || !e.status || e.status >= 500) throw e; out.push({ ok: false, why: e.message, code: e.code || '' }); } }
    return send(res, 200, { ok: true, rows: out });
  }
  send(res, 200, await give(me, site, x, false));
});
module.exports.oneTime = oneTime; module.exports.firstPass = firstPass;
