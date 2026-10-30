/* POST /api/admin { action, … } – the Super Admin's console: users, who may open which module on which site, sites,
 * companies, modules, the activity record. Only the Super Admin; he himself opens no module (no entries, no reports). */
'use strict';
const { handler, readBody, send, sameSite, fail, origin, publicUrl } = require('../lib/http');
const crypto = require('crypto');
const keys = require('../lib/keys');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const { audit } = require('../lib/audit');
const { EMAIL, lc, clean, GSTIN, PAN, okUrl } = require('../lib/util');

const ROLES = ['admin', 'user'];
const { accessRows } = require('./auth');
/* (14-10-2026) THE STORE'S PAGES, given here (Users & Access → Pages, for a Store User): what each may be. Kept with his access
 * line (access.pages, step 3) and carried in the ticket; the Store applies it. Mechanical keeps its own pages (mechPages). */
const STORE_PAGES = [{ key: 'dashboard', label: 'Dashboard', opts: ['View', 'None'] }, { key: 'items', label: 'Item Master', opts: ['Edit', 'View', 'None'] },
  // (with the Store's step 2, 28-10-2026) the Store's work – not given = No access (the first choice)
  { key: 'req', label: 'Material Requirements', opts: ['None', 'Edit', 'View'] }, { key: 'grn', label: 'Inward (GRN)', opts: ['None', 'Edit', 'View'] },
  { key: 'issue', label: 'Issue & Return', opts: ['None', 'Edit', 'View'] }, { key: 'reports', label: 'Stock & Reports', opts: ['None', 'View'] },
  { key: 'po', label: 'Purchase Orders (this site)', opts: ['None', 'View'] },
  // and two that a Store Admin gets too only when they are given: who approves the requirements (level 1 – 5) and HO Purchase
  // (29-10-2026, the workflow: "entry krnarana to verification la pathawel … verification kel tr te auto jyanche kadhe approval aahe tyanche
  // kade jail") who VERIFIES each work before its approval, and who approves the GRN and the issues – given to a Store Admin too
  { key: 'vreq', label: 'Verifies requirements', opts: ['None', 'Yes'], admin: true },
  { key: 'approve', label: 'Approves requirements', opts: ['None', 'L1', 'L2', 'L3', 'L4', 'L5'], admin: true },
  { key: 'purchase', label: 'Store Purchase – every site (HO)', opts: ['None', 'Edit'], admin: true },
  { key: 'vpo', label: 'Verifies purchase orders', opts: ['None', 'Yes'], admin: true },
  // (28-10-2026, with the Store's step 5: "PO approve karaychi payri kara") who approves the site's purchase orders – his name goes on its "Approved By"
  { key: 'poapprove', label: 'Approves purchase orders', opts: ['None', 'Yes'], admin: true },
  { key: 'vgrn', label: 'Verifies GRN (Inward)', opts: ['None', 'Yes'], admin: true }, { key: 'agrn', label: 'Approves GRN (Inward)', opts: ['None', 'Yes'], admin: true },
  { key: 'viss', label: 'Verifies issues & returns', opts: ['None', 'Yes'], admin: true }, { key: 'aiss', label: 'Approves issues & returns', opts: ['None', 'Yes'], admin: true }];
/* (29-10-2026, "pratek task approval nantr HO la nahi janar – konte jail konte nahi jail te super admin tharau shakel") A SITE'S STORE
 * WORKFLOW – what goes to Head Office once approved (Portal → Workflow; the Portal's step 6: sites.rules): its requirements (to HO
 * Purchase, who makes their POs – else the site buys them itself: its Store Admin makes the POs), its GRNs (the suppliers' bills – HO
 * checks them), its issues & returns. Not set: requirements to HO, nothing else (as before). */
const HO_WORKS = ['req', 'grn', 'iss'];
const hoOf = rules => { const h = rules && rules.store && rules.store.ho && typeof rules.store.ho === 'object' ? rules.store.ho : {}; return { req: h.req !== false, grn: h.grn === true, iss: h.iss === true }; };
// the Store's workflow of a site as the Store is told it: who verifies each work, who approves the GRN / the issues, what goes to HO
function storeWf(acc, users, rules) {
  const who = k => acc.filter(a => a.pages && a.pages[k] === 'Yes').map(a => users.find(u => u.email === a.email)).filter(u => u && u.active !== false).map(u => ({ email: u.email, name: u.name }));
  return { verify: { req: who('vreq'), po: who('vpo'), grn: who('vgrn'), iss: who('viss') }, approve: { grn: who('agrn'), iss: who('aiss') }, ho: hoOf(rules) };
}
const STEP6 = 'The Head Office choices of the workflow need the Portal\'s database step 6 first: run sql/portal_step6_rules.sql once in the Portal\'s Supabase → SQL Editor, then save them again.';
/* (with the Store's step 2) THE STORE IS TOLD who approves the requirements of a site – every person of the site with "Approves
 * requirements" (level 1 – 5), with his name – and (28-10-2026) who approves its purchase orders – after a change of his pages or of his access. The Portal's server sends it with a
 * ticket it signs itself (aud "store-admin", 60 s, once), as it does for Mechanical; the Store keeps it in the site's database. */
async function storeTell(req, me, site) {
  const m = ((await db('GET', 'modules?select=url,status&key=eq.store')) || [])[0];
  if (!m || !m.url) return 'The Store has no link yet (Modules).';
  const acc = (await accessRows('module=eq.store&site=eq.' + enc(site))) || [], users = (await db('GET', 'users?select=email,name,active')) || [];
  const levels = [1, 2, 3, 4, 5].map(n => ({ level: n, people: acc.filter(a => a.pages && a.pages.approve === 'L' + n).map(a => users.find(u => u.email === a.email)).filter(u => u && u.active !== false).map(u => ({ email: u.email, name: u.name })) })).filter(l => l.people.length);
  // (28-10-2026) and who approves its purchase orders
  const po = acc.filter(a => a.pages && a.pages.poapprove === 'Yes').map(a => users.find(u => u.email === a.email)).filter(u => u && u.active !== false).map(u => ({ email: u.email, name: u.name }));
  // (29-10-2026) and its workflow: who verifies each work, who approves the GRN and the issues, what goes to Head Office (the site's rules)
  const st = ((await db('GET', 'sites?select=*&code=eq.' + enc(site))) || [])[0] || {}, wf = storeWf(acc, users, st.rules);
  const now = Math.floor(Date.now() / 1000);
  const t = await keys.sign({ iss: publicUrl() || origin(req), aud: 'store-admin', sub: me.email, site: site, act: 'approvers', levels: levels, po: po, wf: wf, iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') });
  try {
    const r = await fetch(String(m.url).replace(/\/+$/, '') + '/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: t }), signal: AbortSignal.timeout(20000) });
    let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
    if (!r.ok || j.error) return 'The Store said: ' + (j.error || r.status);
    // (29-10-2026) the verification of POs, GRNs and issues – and Head Office's check – need the Store's step 9 at that site: said
    const needs9 = wf.verify.po.length || wf.verify.grn.length || wf.verify.iss.length || wf.approve.grn.length || wf.approve.iss.length || wf.ho.grn || wf.ho.iss;
    if (j.step9 === false && needs9) return 'NOTE9';
    return '';
  } catch (e) { return 'The Store could not be reached.'; }
}
// the Store's step 9 missing at a site: what the Super Admin is told (the rest is saved and told)
const note9 = site => 'Saved and told to the Store. But the verification and approval of purchase orders, GRNs and issues (and Head Office\'s check) wait for the Store\'s database step 9 at ' + site + ': run sql/store_step9_workflow.sql (rcl-store) once in that site\'s Supabase → SQL Editor. The requirements\' verification works already.';
async function overview() {
  const [users, sites, mods, comps, acc] = await Promise.all([
    db('GET', 'users?select=email,name,active,is_super,password_hash,last_login_at&order=name.asc'),
    db('GET', 'sites?select=*&order=sort.asc,code.asc'),      // (29-10-2026) with its address and contact (step 5) when they are there
    db('GET', 'modules?select=key,name,url,status,sort&order=sort.asc,key.asc'),
    db('GET', 'companies?select=id,name,address,gstin,pan,logo&order=name.asc'),
    accessRows('')]);
  return {
    users: (users || []).map(u => ({ email: u.email, name: u.name, active: !!u.active, super: !!u.is_super, mustChange: !u.is_super && pw.mustChange(u.password_hash), noPassword: !u.password_hash, lastLogin: u.last_login_at })),
    sites: (sites || []).map(s => ({ code: s.code, name: s.name, company_id: s.company_id, status: s.status, sort: s.sort, address: s.address || '', contact_name: s.contact_name || '', contact_phone: s.contact_phone || '', step5: 'address' in s,
      ho: hoOf(s.rules), step6: 'rules' in s })), modules: mods || [], companies: comps || [], access: acc || [], storePages: STORE_PAGES };      // (29-10-2026) its workflow's Head Office choices (step 6)
}
const userOf = async email => ((await db('GET', 'users?select=email,name,active,is_super&email=eq.' + enc(email))) || [])[0] || null;

/* (update for Mechanical's update-94) the pages of Mechanical (Edit / View / No access per page) are given HERE, by the
 * Super Admin. The Portal's server asks Mechanical's server with a ticket it signs itself (for "mechanical-admin", 60 s, once);
 * what to set travels inside the signed ticket. Mechanical checks the signature with the Portal's public key. */
const PAGE_ACCESS = ['Admin', 'Edit', 'View', 'None'];      // (with Mechanical's update-189) Admin – a page with a date: Edit, and its entries of an earlier day (Mechanical takes it only there)
/* (29-10-2026, his requirement's print with no logo, no company name and no address – "mala ajun pn old format distey") THE PAPERS OF THE
 * MODULES (the Store's PO and Purchase Requisition Form) take a site's company – its name, address, GSTIN, PAN, logo – from Mechanical's
 * list of sites (its first site's rcl_sites / rcl_companies), which only "New site" wrote, with the company's name alone. So a company
 * saved here, and a site's company saved here, are told to Mechanical too (its update-193: act "papers", the same signed ticket as
 * "New site"). Not told (Mechanical not reachable, or not updated yet): said – the Portal's own save stands; saving again tells it. */
async function papersTell(req, me, code, compId) {
  try {
    const c = compId ? ((await db('GET', 'companies?select=id,name,address,gstin,pan,logo&id=eq.' + enc(compId))) || [])[0] : null;
    const r = await mechAsk(req, me, { act: 'papers', site: code || 'PORTAL', link: !!code, company: c ? { id: c.id, name: c.name, address: c.address || '', gstin: c.gstin || '', pan: c.pan || '', logo: c.logo || '' } : null });
    return r && r.ok ? '' : String((r && r.note) || 'Mechanical did not take it').slice(0, 200);
  } catch (e) { return String((e && e.message) || e).slice(0, 200); }
}
const STEP5 = 'The site is saved – but its address and contact need the Portal\'s database step 5 first: run sql/portal_step5_site_papers.sql once in the Portal\'s Supabase → SQL Editor, then save them again.';
const papersWarn = w => w ? { warn: 'Saved. But the papers of the modules (the Store\'s PO and requirement) could not be told (' + w + ') – save again in a minute.' } : {};
async function mechAsk(req, me, claims) {
  const m = ((await db('GET', 'modules?select=url,status&key=eq.mechanical')) || [])[0];
  if (!m || !m.url) throw fail(400, 'Mechanical has no link yet – set it under Modules.', 'nolink');
  const now = Math.floor(Date.now() / 1000);
  // (14-10-2026) the issuer is the Portal's public address when it has one (ONE ADDRESS: <main>/portal) – the same as /api/go and as
  // Mechanical's PORTAL_URL; before, it was the address this request came to, and Mechanical said "made by another Portal"
  const t = await keys.sign(Object.assign({ iss: publicUrl() || origin(req), aud: 'mechanical-admin', sub: me.email, iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') }, claims));
  let r, j = {};
  try { r = await fetch(String(m.url).replace(/\/+$/, '') + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: 'portalAdmin', args: [t] }), signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw fail(503, 'Mechanical could not be reached – try again in a moment.', 'mech'); }
  try { j = await r.json(); } catch (e) { j = { error: 'Mechanical did not answer properly (' + r.status + ').' }; }
  if (j.error) throw fail(r.status >= 500 ? 502 : 400, 'Mechanical: ' + j.error, 'mech');      // (never 401: that would sign the Super Admin out here)
  return j.result;
}
const siteOk = async code => ((await db('GET', 'sites?select=code&code=eq.' + enc(code))) || []).length > 0;
// (update-157) whose backup: the Portal's, or a site of the list; (with Mechanical's update-195) or Purchase's own
async function bkWho(x) {
  if (x.target === 'portal') return { target: 'portal', site: 'PORTAL' };      // (the ticket names a site; Mechanical keeps the Portal's Sheets at its first site)
  if (x.target === 'purchase') return { target: 'purchase', site: 'PORTAL' };      // (Purchase's Sheets too – kept at the first site)
  const site = String(x.site || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
  return { target: '', site: site };
}
/* (with Mechanical's update-117, asked 16-10-2026) a site's DIESEL PLACES – the pump, the dispensers, a store – each with its tank
 * size (18B: Camp Pump 18,000 Ltr; MH12ZE1739 and MH12WJ1381 2,650 Ltr each). Set in "New site" and under Sites → Diesel places;
 * Mechanical keeps them in the site's own database and checks them (a place that has entries keeps its name). */
/* (with Mechanical's update-162, asked 26-10-2026: "user wise konala konte source cha access deycha … jya user la jyacha access asel
 * to tyach madhun issue kru shakel same transfer la pn … inward la nko") a Mechanical User's DIESEL SOURCES: the places he may give
 * diesel FROM – Diesel Issue (its source) and Diesel Transfer (its From). Every place ticked = every source (also a place added
 * later – as before); Mechanical keeps them in the site's own database and checks every save. Inward: anyone (not here). */
const SOURCE_PAGES = ['Diesel Issue', 'Diesel Transfer'];
function sourcesIn(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = {};
  SOURCE_PAGES.forEach(pg => { if (!(pg in v)) return; const l = v[pg];
    o[pg] = l === null ? null : Array.isArray(l) ? [...new Set(l.slice(0, 20).map(n => clean(n, 60)).filter(Boolean))] : null; });
  return Object.keys(o).length ? o : null;
}
// (with Mechanical's update-163) and the fuel each place holds – Diesel / Petrol / CNG (none = Diesel); Mechanical checks it again
const PLACE_FUELS = ['Diesel', 'Petrol', 'CNG'];
const placesIn = v => (Array.isArray(v) ? v : []).slice(0, 20).map(p => Object.assign({ name: clean(p && p.name, 60), cap: Number(p && p.cap) || 0 },
  p && PLACE_FUELS.indexOf(String(p.fuel || '')) > 0 ? { fuel: String(p.fuel) } : {})).filter(p => p.name || p.cap);

const ACTIONS = {
  /* (29-10-2026, "pratek task approval nantr HO la nahi janar – konte jail konte nahi jail te super admin tharau shakel") Portal → Workflow:
   * a site's Head Office choices for the Store – its requirements, its GRNs, its issues & returns (Yes / No each) – kept with the site
   * (step 6) and told to the Store at once with who verifies and approves (storeTell). */
  async rulesSave(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    const cur = ((await db('GET', 'sites?select=*&code=eq.' + enc(site))) || [])[0];
    if (!cur) throw fail(404, 'This site is not in the list.');
    if (!('rules' in cur)) throw fail(400, STEP6, 'nostep');
    const g = x.ho && typeof x.ho === 'object' ? x.ho : {}, ho = {};
    HO_WORKS.forEach(k => { if (typeof g[k] !== 'boolean') throw fail(400, 'Choose Yes or No for each work.', 'field'); ho[k] = g[k]; });
    const rules = Object.assign({}, cur.rules && typeof cur.rules === 'object' ? cur.rules : {}, { store: Object.assign({}, (cur.rules && cur.rules.store) || {}, { ho: ho }) });
    await db('PATCH', 'sites?code=eq.' + enc(site), { rules: rules }, 'return=minimal');
    await audit(me.email, 'Workflow', site + ' · store', { headOffice: HO_WORKS.map(k => k + ': ' + (ho[k] ? 'Yes' : 'No')).join(', ') });
    const warn = req ? await storeTell(req, me, site) : '';
    return Object.assign({ ok: true, ho: ho }, warn === 'NOTE9' ? { warn: note9(site) } : warn ? { warn: 'Saved. But the Store was not told (' + warn + ') – save again in a moment.' } : {});
  },
  // a Store User's pages on one site (he must have the Store there; an Admin has every page)
  async storePagesSave(me, x, req) {
    const site = String(x.site || '').toUpperCase(), email = lc(x.email);
    const acc = (await accessRows('module=eq.store&site=eq.' + enc(site) + '&email=eq.' + enc(email)))[0];
    if (!acc) throw fail(400, 'First give him the Store on this site (Admin or User), then his pages.', 'noaccess');
    // (step 2) a Store Admin has every page – only "Approves requirements", "Store Purchase" and (28-10-2026) "Approves purchase orders" are given to him
    const admin = acc.role === 'admin', pages = admin ? Object.assign({}, acc.pages || {}) : {}, given = x.pages && typeof x.pages === 'object' ? x.pages : {};
    STORE_PAGES.filter(p => !admin || p.admin).forEach(p => { pages[p.key] = p.opts.indexOf(given[p.key]) > -1 ? given[p.key] : (p.admin && acc.pages && p.opts.indexOf(acc.pages[p.key]) > -1 && !(p.key in given) ? acc.pages[p.key] : p.opts[0]); });
    try { await db('PATCH', 'access?module=eq.store&site=eq.' + enc(site) + '&email=eq.' + enc(email), { pages: pages, granted_by: me.email }, 'return=minimal'); }
    catch (e) { if (/42703|pages/.test(String(e && e.message))) throw fail(500, 'This needs one database step first: run sql/portal_step3_pages.sql once in the Portal\'s Supabase → SQL Editor.', 'nostep'); throw e; }
    await audit(me.email, 'Pages', email + ' · ' + site + ' · store', { pages: pages });
    const warn = req ? await storeTell(req, me, site) : '';
    return Object.assign({ ok: true, pages: pages }, warn === 'NOTE9' ? { warn: note9(site) } : warn ? { warn: 'Saved. But the Store was not told who approves the requirements and purchase orders (' + warn + ') – save again in a moment.' } : {});
  },
  // one site's users in Mechanical with their pages, and the list of Mechanical's pages
  async mechPages(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
    const r = await mechAsk(req, me, { act: 'users', site: site });
    // (with Mechanical's update-162) the site's diesel places and each person's diesel sources (users[].dsrc; none = every source).
    // A Mechanical before update-162 sends no places: then no source is shown or sent.
    return Object.assign({ site: site, pages: r.pages || [], users: r.users || [] }, Array.isArray(r.places) ? { places: r.places } : {});
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
    const sources = sourcesIn(x.sources);
    const r = await mechAsk(req, me, Object.assign({ act: 'pages', site: site, email: email, name: u.name, admin: acc.role === 'admin', perms: perms }, sources ? { sources: sources } : {}));
    await audit(me.email, 'Pages', email + ' · ' + site, { changes: String(r.changes || '').slice(0, 1500), added: !!r.added });
    return { ok: true, added: !!r.added, changes: r.changes || '', user: r.user };
  },
  async placesGet(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
    const r = await mechAsk(req, me, { act: 'places', site: site });
    return { site: site, places: r.places || [], set: !!r.set, entries: !!r.entries, firstFixed: !!r.firstFixed, mode: r.mode === 'card' ? 'card' : 'stock', cardEntries: !!r.cardEntries };
  },
  async placesSave(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
    const places = placesIn(x.places);
    if (!places.length) throw fail(400, 'Add at least one diesel place (its name and tank size).');
    // (with Mechanical's update-164, asked 27-10-2026) the site on fuel cards (no diesel stock – HO) or on its diesel places
    const mode = x.mode === 'card' || x.mode === 'stock' ? x.mode : '';
    const r = await mechAsk(req, me, Object.assign({ act: 'placesSave', site: site, places: places }, mode ? { mode: mode } : {}));
    await audit(me.email, 'Diesel places', site, Object.assign({ places: (r.places || []).map(p => p.name + ' ' + p.cap + ' Ltr' + (p.fuel && p.fuel !== 'Diesel' ? ' ' + p.fuel : '')) }, mode ? { fuel: r.mode === 'card' ? 'fuel cards – no stock' : 'diesel places – stock' } : {}));
    return { ok: true, site: site, places: r.places || [], set: !!r.set, entries: !!r.entries, firstFixed: !!r.firstFixed, mode: r.mode === 'card' ? 'card' : 'stock', cardEntries: !!r.cardEntries };
  },
  /* (with Mechanical's update-157, asked 24-10-2026) Sites → Backup: a site's numbered Google Sheets (Sheet 1, 2 …) and the
   * Portal's own – Mechanical keeps them and makes the backup (it checks every link: the backup robot can open it, it is no other
   * site's). x.target 'portal' = the Portal's backup, else x.site. */
  async bkGet(me, x, req) { const t = await bkWho(x); return mechAsk(req, me, { act: 'bkGet', site: t.site, target: t.target }); },
  async bkSet(me, x, req) {
    const t = await bkWho(x), link = String(x.link || '').trim(), mode = x.mode === 'add' ? 'add' : 'change';
    if (!/\/spreadsheets\/(?:u\/\d+\/)?d\/[A-Za-z0-9_-]{20,}/.test(link) && !/^[A-Za-z0-9_-]{20,}$/.test(link)) throw fail(400, 'The Google Sheet link: open the Sheet and copy the address from the browser (…/spreadsheets/d/…).');
    const r = await mechAsk(req, me, { act: 'bkSet', site: t.site, target: t.target, mode: mode, link: link });
    const top = (r.sheets || []).slice(-1)[0] || {};
    await audit(me.email, mode === 'add' ? 'Backup Sheet added' : 'Backup Sheet changed', t.target === 'portal' ? 'Portal' : t.target === 'purchase' ? 'Purchase' : t.site, { sheet: top.n, link: top.url });
    return r;
  },
  async bkNow(me, x, req) { const t = await bkWho(x); return mechAsk(req, me, { act: 'bkNow', site: t.site, target: t.target }); },
  /* (with Mechanical's update-158, asked 24-10-2026) Sites → Storage: every site's database, files, backup Sheet and Google Drive
   * copy (Mechanical asks each site, and the Portal's and Engineering's databases through their backup export); "Connect Google
   * Drive" (the company's account allows the app ONLY its own folder there); "Copy files now" for one site. */
  async stoGet(me, x, req) { return mechAsk(req, me, { act: 'stoGet', site: 'PORTAL' }); },
  async drvStart(me, x, req) {
    const r = await mechAsk(req, me, { act: 'drvStart', site: 'PORTAL' });
    await audit(me.email, 'Google Drive connect started', 'Portal', {});
    return { url: r.url, redirect: r.redirect };
  },
  async drvNow(me, x, req) {
    const site = String(x.site || '').toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(site) || !await siteOk(site)) throw fail(400, 'Pick a site.');
    return mechAsk(req, me, { act: 'drvNow', site: site });
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
  async accessSet(me, x, req) {
    const email = lc(x.email), site = String(x.site || '').toUpperCase(), mod = String(x.module || ''), role = String(x.role || '');
    const u = await userOf(email); if (!u) throw fail(404, 'User ' + email + ' was not found.');
    if (u.is_super) throw fail(400, 'The Super Admin opens every module of every site already – he needs no access line.');
    if (!((await db('GET', 'sites?select=code&code=eq.' + enc(site))) || []).length) throw fail(404, 'This site is not in the list.');
    if (!((await db('GET', 'modules?select=key&key=eq.' + enc(mod))) || []).length) throw fail(404, 'This module is not in the list.');
    if (role && ROLES.indexOf(role) === -1) throw fail(400, 'Choose Admin, User or No access.');
    if (!role) await db('DELETE', 'access?email=eq.' + enc(email) + '&site=eq.' + enc(site) + '&module=eq.' + enc(mod), undefined, 'return=minimal');
    else await db('POST', 'access?on_conflict=email,site,module', [{ email: email, site: site, module: mod, role: role, granted_by: me.email }], 'resolution=merge-duplicates,return=minimal');
    await audit(me.email, 'Access', email, { site: site, module: mod, role: role || 'none' });
    // (step 2) the Store's approvers of the site, told again (a person taken off the Store is no approver any more)
    const warn = mod === 'store' && req ? await storeTell(req, me, site) : '';
    return Object.assign({ ok: true }, warn === 'NOTE9' ? { warn: note9(site) } : warn ? { warn: 'Saved. But the Store was not told who approves the requirements (' + warn + ').' } : {});
  },
  async siteSave(me, x, req) {
    const code = String(x.code || '').trim().toUpperCase(), name = clean(x.name, 80), comp = clean(x.company, 40), status = String(x.status || 'active');
    // (29-10-2026) the site's address and its contact – the Store's papers (the PO's Shipping Address and Site Contact, the requirement's
    // contact); an older page / app that does not send them keeps them as they are
    const more = ['address', 'contact_name', 'contact_phone'].some(k => k in x) ? { address: clean(x.address, 300), contact_name: clean(x.contact_name, 80), contact_phone: clean(x.contact_phone, 40) } : null;
    if (more && more.contact_phone && !/^[0-9+() ,/-]{6,40}$/.test(more.contact_phone)) throw fail(400, 'Contact number "' + more.contact_phone + '": digits only (e.g. 98765 43210; two numbers with a comma).');
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
    if (more) {      // (its own write: before the Portal's step 5 the site is saved as before, and the page says the step is needed for these)
      try { await db('PATCH', 'sites?code=eq.' + enc(code), more, 'return=minimal'); }
      catch (e) { if (!/PGRST204|42703|address|contact_/i.test(String(e && e.message))) throw e; if (more.address || more.contact_name || more.contact_phone) throw fail(400, STEP5); }
    }
    await audit(me.email, x.isNew ? 'Site added' : 'Site changed', code, Object.assign({ name: name, company: comp, status: status }, more || {}));
    return Object.assign({ ok: true }, papersWarn(await papersTell(req, me, code, comp)));
  },
  /* "New site" (with Mechanical's update-95): the Super Admin gives the site's code, name, company and the link of the Supabase
   * project he made; the system checks every step and sets the site up. Can be pressed again and again (it goes on where it
   * stopped). The site is in the list as Closed until Mechanical says Ready, then Active. No key ever comes here. */
  async siteSql(me, x, req) {
    const r = await mechAsk(req, me, { act: 'siteSql', site: 'S1' });
    return { sql: r.sql || '', files: r.files || [] };
  },
  async siteSetup(me, x, req) {
    const code = String(x.code || '').trim().toUpperCase(), name = clean(x.name, 80), comp = clean(x.company, 40);
    const url = String(x.url || '').trim().replace(/\/+$/, '').slice(0, 200);
    if (!/^[A-Z0-9]{1,12}$/.test(code)) throw fail(400, 'The site code: 1 to 12 capital letters or digits (e.g. VTR, 18B).');
    if (name.length < 2) throw fail(400, 'Give the site a name (2 to 80 letters).');
    const c = comp ? ((await db('GET', 'companies?select=id,name&id=eq.' + enc(comp))) || [])[0] : null;
    if (comp && !c) throw fail(404, 'This company is not in the list.');
    const m = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(String(x.sheet || '')) || /^([A-Za-z0-9_-]{20,})$/.exec(String(x.sheet || '').trim());
    if (String(x.sheet || '').trim() && !m) throw fail(400, 'The Google Sheet link: open the Sheet and copy the address from the browser (…/spreadsheets/d/…).');
    const cur = ((await db('GET', 'sites?select=code,status&code=eq.' + enc(code))) || [])[0];
    if (!cur) {
      const last = ((await db('GET', 'sites?select=sort&order=sort.desc&limit=1')) || [])[0];
      await db('POST', 'sites', [{ code: code, name: name, company_id: comp || null, status: 'closed', sort: (last ? last.sort : 0) + 1 }], 'return=minimal');
      await audit(me.email, 'Site added', code, { name: name, company: comp, by: 'New site' });
    } else await db('PATCH', 'sites?code=eq.' + enc(code), { name: name, company_id: comp || null }, 'return=minimal');
    const r = await mechAsk(req, me, { act: 'siteSetup', site: code, name: name, url: url, sheet: m ? m[1] : '', company: c ? { id: c.id, name: c.name } : {}, places: placesIn(x.places) });
    if (c && r && r.ready) await papersTell(req, me, code, c.id);      // (29-10-2026) its company's address, GSTIN, PAN and logo for the papers too
    if (r.ready) {
      if (!cur || cur.status !== 'active') { await db('PATCH', 'sites?code=eq.' + enc(code), { status: 'active' }, 'return=minimal'); await audit(me.email, 'Site ready', code, { name: name, module: 'mechanical' }); }
    }
    return r;
  },
  /* (asked 13-10-2026) delete a site: only one that is Closed first, with its code typed again. The site's own database
   * (its data) is NEVER touched – it only leaves the lists: here (with everybody's access to it) and in Mechanical (set to
   * closed there, so nobody opens it; "New site" with the same link brings it back with its data). The first site cannot go. */
  async siteDelete(me, x, req) {
    const code = String(x.code || '').trim().toUpperCase();
    const cur = ((await db('GET', 'sites?select=code,name,status&code=eq.' + enc(code))) || [])[0];
    if (!cur) throw fail(404, 'This site is not in the list.');
    if (cur.status !== 'closed') throw fail(400, 'First set the site to Closed and Save – then delete it.', 'notclosed');
    if (String(x.confirm || '').trim().toUpperCase() !== code) throw fail(400, 'Type the site code (' + code + ') to delete it.', 'confirm');
    const m = ((await db('GET', 'modules?select=url&key=eq.mechanical')) || [])[0];
    if (m && m.url) await mechAsk(req, me, { act: 'siteOff', site: code });      // the first site is refused there
    const acc = (await db('GET', 'access?select=email,module,role&site=eq.' + enc(code))) || [];
    if (acc.length) await db('DELETE', 'access?site=eq.' + enc(code), undefined, 'return=minimal');
    await db('DELETE', 'sites?code=eq.' + enc(code), undefined, 'return=minimal');
    await audit(me.email, 'Site deleted', code, { name: cur.name, accessRemoved: acc.map(a => a.email + ' ' + a.module + ' ' + a.role).slice(0, 200), data: 'kept in its own database' });
    return { ok: true, accessRemoved: acc.length };
  },
  async companySave(me, x, req) {
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
      await audit(me.email, 'Company changed', x.id, { name: name }); return Object.assign({ ok: true, id: x.id }, papersWarn(await papersTell(req, me, '', x.id)));
    }
    let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || 'CO'; const base = id; let n = 2;
    while (all.some(c => c.id === id)) id = base.slice(0, 18) + (n++);
    await db('POST', 'companies', [{ id, name, address, gstin, pan, logo }], 'return=minimal');
    await audit(me.email, 'Company added', id, { name: name }); return Object.assign({ ok: true, id: id }, papersWarn(await papersTell(req, me, '', id)));
  },
  // (asked 13-10-2026) delete a company: only one that no site belongs to
  async companyDelete(me, x) {
    const id = String(x.id || '');
    const c = ((await db('GET', 'companies?select=id,name&id=eq.' + enc(id))) || [])[0];
    if (!c) throw fail(404, 'This company is not in the list.');
    const used = (await db('GET', 'sites?select=code&company_id=eq.' + enc(id))) || [];
    if (used.length) throw fail(400, 'Sites of this company: ' + used.map(s => s.code).join(', ') + ' – give them another company first (Sites), then delete it.', 'inuse');
    await db('DELETE', 'companies?id=eq.' + enc(id), undefined, 'return=minimal');
    await audit(me.email, 'Company deleted', id, { name: c.name });
    return { ok: true };
  },
  // (asked 13-10-2026) delete a module: only one that is Off first, with its key typed again; everybody's access to it goes too.
  // Mechanical stays (the sites and the pages are set up through it).
  async moduleDelete(me, x) {
    const key = String(x.key || '');
    const m = ((await db('GET', 'modules?select=key,name,status&key=eq.' + enc(key))) || [])[0];
    if (!m) throw fail(404, 'This module is not in the list.');
    if (key === 'mechanical') throw fail(400, 'Mechanical cannot be deleted – the sites and the pages are set up through it. Set it Off instead.', 'mech');
    if (m.status !== 'off') throw fail(400, 'First set the module Off and Save – then delete it.', 'notoff');
    if (String(x.confirm || '').trim().toLowerCase() !== key) throw fail(400, 'Type the module key (' + key + ') to delete it.', 'confirm');
    const acc = (await db('GET', 'access?select=email,site,role&module=eq.' + enc(key))) || [];
    if (acc.length) await db('DELETE', 'access?module=eq.' + enc(key), undefined, 'return=minimal');
    await db('DELETE', 'modules?key=eq.' + enc(key), undefined, 'return=minimal');
    await audit(me.email, 'Module deleted', key, { name: m.name, accessRemoved: acc.map(a => a.email + ' ' + a.site + ' ' + a.role).slice(0, 200) });
    return { ok: true, accessRemoved: acc.length };
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
      if (x.name !== undefined && x.name !== '' && name.length < 2) throw fail(400, 'Give the module a name.');
      await db('PATCH', 'modules?key=eq.' + enc(key), Object.assign({ url: url || null, status: status }, name ? { name: name } : {}), 'return=minimal');
    }
    await audit(me.email, x.isNew ? 'Module added' : 'Module changed', key, { name: name || (cur && cur.name), url: url, status: status });
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
