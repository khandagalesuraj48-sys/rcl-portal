/* POST /api/setup – FIRST START ONLY: bring the people over from Mechanical, once.
 * While the Portal has no Super Admin, its page offers "Bring the users from Mechanical". The Mechanical Super Admin proves
 * himself with his own email and password (checked against Mechanical's first site – the database named by MECH_URL /
 * MECH_KEY in Vercel). Then, from that database, the Portal copies:
 *   the companies, the list of sites, every user of the first site WITH his kept password (nobody resets a password),
 *   who has which site (as Mechanical access: Admin or User) – and, LAST, the Super Admin himself (with his recovery code).
 * Mechanical is only READ – nothing there changes. Each part can be copied again safely until the Super Admin exists;
 * after that this door is shut for good. MECH_KEY can be taken out of Vercel afterwards. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { db, mech, rpc, enc } = require('../lib/db');
const pw = require('../lib/pw');
const { audit } = require('../lib/audit');
const { EMAIL, lc } = require('../lib/util');

const hasSuper = async () => ((await db('GET', 'users?select=email&is_super=is.true&limit=1')) || []).length > 0;

async function importAll(email, password) {
  const sa = ((await mech('GET', 'rcl_super_admin?select=email,name,password_hash,recovery_hash&email=eq.' + enc(email))) || [])[0];
  const good = !!sa && await pw.check(password, sa.password_hash);
  if (!good) { if (!sa) await pw.dummy(password); throw fail(401, 'Wrong email or password (the Super Admin of Mechanical).', 'wrong'); }
  const [comps, sites, users, mem] = await Promise.all([
    mech('GET', 'rcl_companies?select=id,name,address,gstin,pan,logo'),
    mech('GET', 'rcl_sites?select=code,name,company_id,home,status,sort&order=sort.asc'),
    mech('GET', 'app_users?select=email,name,password_hash,active,admin'),
    mech('GET', 'rcl_user_sites?select=email,site,is_admin')]);
  const home = (sites || []).find(s => s.home);
  // companies, then sites
  if ((comps || []).length) await db('POST', 'companies?on_conflict=id', comps.map(c => ({ id: c.id, name: c.name, address: c.address || '', gstin: c.gstin || '', pan: c.pan || '', logo: c.logo || '' })), 'resolution=merge-duplicates,return=minimal');
  if ((sites || []).length) await db('POST', 'sites?on_conflict=code', sites.map(s => ({ code: s.code, name: s.name || s.code, company_id: s.company_id || null, status: s.status === 'ready' ? 'active' : 'closed', sort: s.sort || 0 })), 'resolution=merge-duplicates,return=minimal');
  // the users of the first site, with their kept passwords
  const people = (users || []).map(u => ({ email: lc(u.email), name: String(u.name || u.email).slice(0, 80), password_hash: u.password_hash || null, active: String(u.active || 'Yes').toUpperCase() !== 'NO', admin: String(u.admin || '').toUpperCase() === 'YES' }))
    .filter(u => EMAIL.test(u.email) && u.email !== lc(sa.email));
  if (people.length) await db('POST', 'users?on_conflict=email', people.map(u => ({ email: u.email, name: u.name, password_hash: u.password_hash, active: u.active })), 'resolution=merge-duplicates,return=minimal');
  // who has which site → access to Mechanical there (a user of the first site not listed yet: the first site, as in Mechanical)
  const known = new Set(people.map(u => u.email)), siteCodes = new Set((sites || []).map(s => s.code));
  const acc = [], skipped = [];
  (mem || []).forEach(m => { const e = lc(m.email); if (known.has(e) && siteCodes.has(m.site)) acc.push({ email: e, site: m.site, module: 'mechanical', role: m.is_admin ? 'admin' : 'user', granted_by: 'import' }); else skipped.push(e + ' · ' + m.site); });
  if (home) people.filter(u => u.active && !(mem || []).some(m => lc(m.email) === u.email)).forEach(u => acc.push({ email: u.email, site: home.code, module: 'mechanical', role: u.admin ? 'admin' : 'user', granted_by: 'import' }));
  if (acc.length) await db('POST', 'access?on_conflict=email,site,module', acc, 'resolution=merge-duplicates,return=minimal');
  // the Mechanical module's link, when Vercel names it
  const appUrl = String(process.env.MECH_APP_URL || '').replace(/\/+$/, '');
  if (appUrl) await db('PATCH', 'modules?key=eq.mechanical', { url: appUrl, status: 'live' }, 'return=minimal');
  // LAST: the Super Admin (from now on this door is shut)
  await db('POST', 'users', [{ email: lc(sa.email), name: sa.name || 'Super Admin', password_hash: sa.password_hash, recovery_hash: sa.recovery_hash || null, active: true, is_super: true }], 'return=minimal');
  const counts = { companies: (comps || []).length, sites: (sites || []).length, users: people.length, access: acc.length, skipped: skipped.length };
  await audit(lc(sa.email), 'Import from Mechanical', '', counts);
  return Object.assign({ ok: true }, counts, { skippedList: skipped.slice(0, 50) });
}

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req);
  const open = !(await hasSuper());
  if (x.action === 'status') return send(res, 200, { needed: open, mech: !!(process.env.MECH_URL && process.env.MECH_KEY) });
  if (x.action !== 'import') return send(res, 404, { error: 'Unknown action.' });
  if (!open) throw fail(403, 'The Portal is already set up – this is done only once.', 'done');
  const email = lc(x.email).slice(0, 120);
  const n = await rpc('portal_hit', { p_key: 'SETUP_' + email, p_ttl: 900 });
  if (Number(n) > 5) throw fail(429, 'Too many wrong attempts. Try again after 15 minutes.', 'locked');
  send(res, 200, await importAll(email, String(x.password || '')));
});
