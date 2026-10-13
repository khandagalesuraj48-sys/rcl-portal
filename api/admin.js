/* POST /api/admin { action, … } – the Super Admin's console: users, who may open which module on which site, sites,
 * companies, modules, the activity record. Only the Super Admin; he himself opens no module (no entries, no reports). */
'use strict';
const { handler, readBody, send, sameSite, fail, origin } = require('../lib/http');
const crypto = require('crypto');
const keys = require('../lib/keys');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, clean, GSTIN, PAN, okUrl } = require('../lib/util');

const ROLES = ['admin', 'user'];
async function overview() {
  const [users, sites, mods, comps, acc] = await Promise.all([
    db('GET', 'users?select=email,name,active,is_super,password_hash,last_login_at&order=name.asc'),
    db('GET', 'sites?select=code,name,company_id,status,sort&order=sort.asc,code.asc'),
    db('GET', 'modules?select=key,name,url,status,sort&order=sort.asc,key.asc'),
    db('GET', 'companies?select=id,name,address,gstin,pan,logo&order=name.asc'),
    db('GET', 'access?select=email,site,module,role')]);
  return {
    users: (users || []).map(u => ({ email: u.email, name: u.name, active: !!u.active, super: !!u.is_super, mustChange: !u.is_super && pw.mustChange(u.password_hash), noPassword: !u.password_hash, lastLogin: u.last_login_at })),
    sites: sites || [], modules: mods || [], companies: comps || [], access: acc || [] };
}
const userOf = async email => ((await db('GET', 'users?select=email,name,active,is_super&email=eq.' + enc(email))) || [])[0] || null;

/* (update for Mechanical's update-94) the pages of Mechanical (Edit / View / No access per page) are given HERE, by the
 * Super Admin. The Portal's server asks Mechanical's server with a ticket it signs itself (for "mechanical-admin", 60 s, once);
 * what to set travels inside the signed ticket. Mechanical checks the signature with the Portal's public key. */
const PAGE_ACCESS = ['Edit', 'View', 'None'];
async function mechAsk(req, me, claims) {
  const m = ((await db('GET', 'modules?select=url,status&key=eq.mechanical')) || [])[0];
  if (!m || !m.url) throw fail(400, 'Mechanical has no link yet – set it under Modules.', 'nolink');
  const now = Math.floor(Date.now() / 1000);
  const t = await keys.sign(Object.assign({ iss: origin(req), aud: 'mechanical-admin', sub: me.email, iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') }, claims));
  let r, j = {};
  try { r = await fetch(String(m.url).replace(/\/+$/, '') + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'portalAdmin', args: [t] }), signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw fail(503, 'Mechanical could not be reached – try again in a moment.', 'mech'); }
  try { j = await r.json(); } catch (e) { j = { error: 'Mechanical did not answer properly (' + r.status + ').' }; }
  if (j.error) throw fail(r.status >= 500 ? 502 : 400, 'Mechanical: ' + j.error, 'mech');      // (never 401: that would sign the Super Admin out here)
  return j.result;
}
const siteOk = async code => ((await db('GET', 'sites?select=code&code=eq.' + enc(code))) || []).length > 0;

const ACTIONS = {
  // one site's users in Mechanical with their pages, and the list of Mechanical's pages
  async mechPages(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
    const r = await mechAsk(req, me, { act: 'users', site: site });
    return { site: site, pages: r.pages || [], users: r.users || [] };
  },
  // one person's pages in Mechanical on one site (he must have Mechanical on that site here)
  async mechPagesSave(me, x, req) {
    const site = String(x.site || '').toUpperCase(), email = lc(x.email);
    const acc = ((await db('GET', 'access?select=role&module=eq.mechanical&site=eq.' + enc(site) + '&email=eq.' + enc(email))) || [])[0];
    if (!acc) throw fail(400, 'First give him Mechanical on this site (Admin or User), then his pages.', 'noaccess');
    const u = await userOf(email);
    if (!u || u.is_super) throw fail(400, 'This user is not in the list.');
    const perms = {};
    Object.keys(x.perms && typeof x.perms === 'object' ? x.perms : {}).slice(0, 60).forEach(k => { if (PAGE_ACCESS.indexOf(x.perms[k]) > -1) perms[String(k).slice(0, 40)] = x.perms[k]; });
    if (!Object.keys(perms).length) throw fail(400, 'No page was given.');
    const r = await mechAsk(req, me, { act: 'pages', site: site, email: email, name: u.name, admin: acc.role === 'admin', perms: perms });
    await audit(me.email, 'Pages', email + ' · ' + site, { changes: String(r.changes || '').slice(0, 1500), added: !!r.added });
    return { ok: true, added: !!r.added, changes: r.changes || '', user: r.user };
  },
  overview: async () => overview(),
  async userSave(me, x) {
    const email = lc(x.email);
    if (!EMAIL.test(email) || email.length > 120) throw fail(400, 'Enter a proper email.');
    const name = clean(x.name, 80), cur = await userOf(email);
    if (cur && cur.is_super) throw fail(400, 'The Super Admin changes his own account under "My account".');
    const temp = String(x.newPassword || '');
    if (temp && temp.length < 6) throw fail(400, 'Give a one-time password of at least 6 characters – the user must change it at the first sign-in.');
    if (x.isNew) {
      if (cur) throw fail(409, email + ' is already a user.');
      if (!temp) throw fail(400, 'Give a one-time password of at least 6 characters – the user must change it at the first sign-in.');
      if (name.length < 2) throw fail(400, 'Enter the name of the user (2 to 80 letters).');
      await db('POST', 'users', [{ email: email, name: name, password_hash: 'tmp$' + await pw.make(temp), active: x.active !== false }], 'return=minimal');
      await audit(me.email, 'User added', email, { name: name });
      return { ok: true, added: true };
    }
    if (!cur) throw fail(404, 'User ' + email + ' was not found.');
    const patch = {}, changes = [];
    if (name && name !== cur.name) { patch.name = name; changes.push('name'); }
    if (typeof x.active === 'boolean' && x.active !== cur.active) { patch.active = x.active; changes.push(x.active ? 'switched on' : 'switched off'); }
    if (temp) { patch.password_hash = 'tmp$' + await pw.make(temp); changes.push('one-time password set'); }
    if (!changes.length) return { ok: true, changed: false };
    await db('PATCH', 'users?email=eq.' + enc(email), patch, 'return=minimal');
    if (patch.active === false || temp) await ses.endAll(email);       // switched off or a new password: his sign-ins end now
    await audit(me.email, 'User changed', email, { changes: changes });
    return { ok: true, changed: true };
  },
  // who may open which module on which site: '' = no access, 'user', 'admin'
  async accessSet(me, x) {
    const email = lc(x.email), site = String(x.site || '').toUpperCase(), mod = String(x.module || ''), role = String(x.role || '');
    const u = await userOf(email); if (!u) throw fail(404, 'User ' + email + ' was not found.');
    if (u.is_super) throw fail(400, 'The Super Admin opens no module – he only designs the system.');
    if (!((await db('GET', 'sites?select=code&code=eq.' + enc(site))) || []).length) throw fail(404, 'This site is not in the list.');
    if (!((await db('GET', 'modules?select=key&key=eq.' + enc(mod))) || []).length) throw fail(404, 'This module is not in the list.');
    if (role && ROLES.indexOf(role) === -1) throw fail(400, 'Choose Admin, User or No access.');
    if (!role) await db('DELETE', 'access?email=eq.' + enc(email) + '&site=eq.' + enc(site) + '&module=eq.' + enc(mod), undefined, 'return=minimal');
    else await db('POST', 'access?on_conflict=email,site,module', [{ email: email, site: site, module: mod, role: role, granted_by: me.email }], 'resolution=merge-duplicates,return=minimal');
    await audit(me.email, 'Access', email, { site: site, module: mod, role: role || 'none' });
    return { ok: true };
  },
  async siteSave(me, x) {
    const code = String(x.code || '').trim().toUpperCase(), name = clean(x.name, 80), comp = clean(x.company, 40), status = String(x.status || 'active');
    if (!/^[A-Z0-9]{1,12}$/.test(code)) throw fail(400, 'The site code: 1 to 12 capital letters or digits (e.g. VTR, 18B).');
    if (name.length < 2) throw fail(400, 'Give the site a name (2 to 80 letters).');
    if (['active', 'closed'].indexOf(status) === -1) throw fail(400, 'A site is Active or Closed.');
    if (comp && !((await db('GET', 'companies?select=id&id=eq.' + enc(comp))) || []).length) throw fail(404, 'This company is not in the list.');
    const exists = ((await db('GET', 'sites?select=code&code=eq.' + enc(code))) || []).length > 0;
    if (x.isNew && exists) throw fail(409, 'A site with the code ' + code + ' is already there.');
    if (!x.isNew && !exists) throw fail(404, 'This site is not in the list.');
    if (x.isNew) {
      const last = ((await db('GET', 'sites?select=sort&order=sort.desc&limit=1')) || [])[0];
      await db('POST', 'sites', [{ code: code, name: name, company_id: comp || null, status: status, sort: (last ? last.sort : 0) + 1 }], 'return=minimal');
    } else await db('PATCH', 'sites?code=eq.' + enc(code), { name: name, company_id: comp || null, status: status }, 'return=minimal');
    await audit(me.email, x.isNew ? 'Site added' : 'Site changed', code, { name: name, company: comp, status: status });
    return { ok: true };
  },
  async companySave(me, x) {
    const name = clean(x.name, 80), gstin = clean(x.gstin, 15).toUpperCase(), pan = clean(x.pan, 10).toUpperCase(), logo = clean(x.logo, 300), address = clean(x.address, 300);
    if (name.length < 2) throw fail(400, 'Enter the name of the company (2 to 80 letters).');
    if (gstin && !GSTIN.test(gstin)) throw fail(400, 'GST Number "' + gstin + '" is not in the right format (15 characters, e.g. 27ABCDE1234F1Z5).');
    if (pan && !PAN.test(pan)) throw fail(400, 'PAN "' + pan + '" is not in the right format (10 characters, e.g. ABCDE1234F).');
    if (logo && !/^https:\/\/[^\s"'<>]{4,300}$/.test(logo)) throw fail(400, 'The logo must be a link that starts with https:// (or be left empty).');
    const all = (await db('GET', 'companies?select=id,name')) || [];
    if (all.some(c => c.name.toUpperCase() === name.toUpperCase() && c.id !== x.id)) throw fail(409, 'There is already a company with this name.');
    if (x.id) {
      if (!all.some(c => c.id === x.id)) throw fail(404, 'This company is not in the list.');
      await db('PATCH', 'companies?id=eq.' + enc(x.id), { name, address, gstin, pan, logo }, 'return=minimal');
      await audit(me.email, 'Company changed', x.id, { name: name }); return { ok: true, id: x.id };
    }
    let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || 'CO'; const base = id; let n = 2;
    while (all.some(c => c.id === id)) id = base.slice(0, 18) + (n++);
    await db('POST', 'companies', [{ id, name, address, gstin, pan, logo }], 'return=minimal');
    await audit(me.email, 'Company added', id, { name: name }); return { ok: true, id: id };
  },
  async moduleSave(me, x) {
    const key = String(x.key || ''), url = clean(x.url, 300).replace(/\/+$/, ''), status = String(x.status || 'off'), name = clean(x.name, 40);
    if (!/^[a-z]{2,20}$/.test(key)) throw fail(400, 'The module key: 2 to 20 small letters (e.g. store).');
    if (url && !okUrl(url)) throw fail(400, 'The module link must start with https://');
    if (['live', 'off'].indexOf(status) === -1) throw fail(400, 'A module is Live or Off.');
    if (status === 'live' && !url) throw fail(400, 'A module can be Live only with its link.');
    const cur = ((await db('GET', 'modules?select=key,name&key=eq.' + enc(key))) || [])[0];
    if (x.isNew) {
      if (cur) throw fail(409, 'This module is already there.');
      if (name.length < 2) throw fail(400, 'Give the module a name.');
      const last = ((await db('GET', 'modules?select=sort&order=sort.desc&limit=1')) || [])[0];
      await db('POST', 'modules', [{ key, name, url: url || null, status, sort: (last ? last.sort : 0) + 1 }], 'return=minimal');
    } else {
      if (!cur) throw fail(404, 'This module is not in the list.');
      await db('PATCH', 'modules?key=eq.' + enc(key), Object.assign({ url: url || null, status: status }, name ? { name: name } : {}), 'return=minimal');
    }
    await audit(me.email, x.isNew ? 'Module added' : 'Module changed', key, { url: url, status: status });
    return { ok: true };
  },
  async endSessions(me, x) {
    const email = lc(x.email); if (!(await userOf(email))) throw fail(404, 'User ' + email + ' was not found.');
    await ses.endAll(email); await audit(me.email, 'Signed out everywhere', email, null); return { ok: true };
  },
  async audit(me, x) {
    const n = Math.max(1, Math.min(500, Number(x.limit) || 200));
    return { rows: (await db('GET', 'audit?select=at,actor,action,target,detail&order=at.desc&limit=' + n)) || [] };
  },
};

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const s = await ses.need(req, { super: true, ownPassword: true });
  const x = await readBody(req), a = String(x.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, a)) return send(res, 404, { error: 'Unknown action.' });
  send(res, 200, await ACTIONS[a](s.user, x, req));
});
