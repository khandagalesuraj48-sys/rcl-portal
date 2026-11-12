/* POST /api/hrlogin { site, email, name } – AN EMPLOYEE'S SIGN-IN, given from HR (asked 12-11-2026: "ADMIN … LA EK TEMP PASSWORD DEU
 * SHAKEL NANTR USER SWATACHA PASS SET KRU SHAKEL … USER PASS VISRLA TRI ADMIN … TEMP PASS DUSRA DEU SHAKEL"; "HR NAHI … ADMIN OR
 * SUPER ADMIN BANWEL FKT").
 *   WHO: the Super Admin, or the HR ADMIN of that site (access: module "hr", role admin). Not an HR User, nobody else.
 *   WHAT: the employee (his e-mail) becomes a user of the Portal with a ONE-TIME password – at his first sign-in he sets his own –
 *   and gets "My HR" (module "hrme") on that site: his own attendance, nothing else. Asked again (he forgot his password): a new
 *   one-time password; his sign-ins end at once. The one-time password is made here, answered ONCE and kept nowhere in plain text.
 *   THE LIMIT (so that HR can never take over another person's account): it works only for a person who has NOTHING but "My HR".
 *   A user with any other module on any site, the Super Admin, or a user the Super Admin switched off is refused – that stays the
 *   Super Admin's (Users & Access). Every use is written in the activity record. No change of the database. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, clean } = require('../lib/util');
const HR = 'hr', SELF = 'hrme';
// 10 characters, easy to read out and to type (no 0 O 1 l I), always a letter and a digit
function oneTime() {
  const L = 'abcdefghjkmnpqrstuvwxyz', U = 'ABCDEFGHJKMNPQRSTUVWXYZ', N = '23456789', all = L + U + N, pick = s => s[crypto.randomInt(s.length)];
  const c = [pick(U), pick(L), pick(N), pick(N)]; while (c.length < 10) c.push(pick(all));
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'Method not allowed');
  sameSite(req);
  const me = (await ses.need(req, { ownPassword: true })).user, x = await readBody(req);
  const site = String(x.site || '').toUpperCase(), email = lc(x.email), name = clean(x.name, 80);
  if (!/^[A-Z0-9]{1,12}$/.test(site) || !((await db('GET', 'sites?select=code&code=eq.' + enc(site) + '&status=eq.active')) || []).length) throw fail(400, 'This site was not found.', 'site');
  if (!me.is_super && !((await db('GET', 'access?select=role&email=eq.' + enc(me.email) + '&site=eq.' + enc(site) + '&module=eq.' + HR + '&role=eq.admin')) || []).length) throw fail(403, 'Only the HR Admin of this site or the Super Admin gives an employee his sign-in.', 'role');
  if (!((await db('GET', 'modules?select=key&key=eq.' + SELF + '&status=eq.live')) || []).length) throw fail(400, 'The module "My HR" (key hrme) is not in the Portal yet – the Super Admin adds it under Modules (Live).', 'nomodule');
  if (!EMAIL.test(email) || email.length > 120) throw fail(400, 'This employee has no proper e-mail – put it in his record first.', 'email');
  if (email === lc(me.email)) throw fail(400, 'Your own password is changed under "Change password".', 'self');
  const cur = ((await db('GET', 'users?select=email,name,active,is_super&email=eq.' + enc(email))) || [])[0] || null;
  if (cur) {
    const other = ((await db('GET', 'access?select=module&email=eq.' + enc(email) + '&module=neq.' + SELF + '&limit=1')) || []).length > 0;
    if (cur.is_super || other) throw fail(403, 'This person has other work in the ERP: his password is given only by the Super Admin (Portal → Users & Access).', 'other');
    if (!cur.active) throw fail(403, 'This user was switched off by the Super Admin – only he switches him on again.', 'off');
  } else if (name.length < 2) throw fail(400, 'This employee has no name.', 'name');
  const temp = oneTime(), hash = 'tmp$' + await pw.make(temp);
  if (cur) { await db('PATCH', 'users?email=eq.' + enc(email), { password_hash: hash }, 'return=minimal'); await ses.endAll(email); }      // a new password: his sign-ins end now
  else await db('POST', 'users', [{ email: email, name: name, password_hash: hash, active: true }], 'return=minimal');
  const has = ((await db('GET', 'access?select=role&email=eq.' + enc(email) + '&site=eq.' + enc(site) + '&module=eq.' + SELF)) || []).length > 0;
  if (!has) await db('POST', 'access', [{ email: email, site: site, module: SELF, role: 'user', granted_by: me.email }], 'return=minimal');
  await audit(me.email, cur ? 'Employee sign-in: new one-time password' : 'Employee sign-in given', email, { site: site, module: SELF, access: has ? 'kept' : 'given' });
  send(res, 200, { ok: true, added: !cur, email: email, password: temp });
});
module.exports.oneTime = oneTime;
