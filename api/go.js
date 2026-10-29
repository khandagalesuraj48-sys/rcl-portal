/* GET /api/go?module=mechanical&site=VTR – open a module on a site, already signed in.
 * The Portal checks the person may open it, then sends the browser to the module with a TICKET: signed by the Portal, valid
 * 60 seconds, usable once (the module keeps its number). It travels after "#" in the link, so it never reaches a server's
 * log. The module checks the signature with the Portal's public key and starts its own session for that site.
 * Not signed in → the sign-in page, and back here after it. */
'use strict';
const crypto = require('crypto');
const { handler, redirect, send, sameSite, query, origin, publicUrl } = require('../lib/http');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const keys = require('../lib/keys');
const { audit } = require('../lib/audit');
const { myItems } = require('./auth');

/* (29-10-2026, his requirement printed with an empty heading: "mala te kahi save karayla nko sangu … mi agodar sagle save keley") THE
 * PAPERS' HEADING – the Store's PO and Purchase Requisition Form – comes with the Store's ticket, from what the Super Admin gave here:
 * the site's company (Companies: name, address, GSTIN, PAN, logo) and the site's own address and contact (Sites; the Portal's step 5).
 * Nothing to save anywhere else: every opening of the Store (and its fresh ticket every 10 minutes) brings it as it is here now.
 * A read that fails: no heading in this ticket (the Store keeps the one it had). */
async function paperOf(code) {
  try {
    const s = ((await db('GET', 'sites?select=*&code=eq.' + enc(code))) || [])[0]; if (!s) return null;
    const c = s.company_id ? ((await db('GET', 'companies?select=id,name,address,gstin,pan,logo&id=eq.' + enc(s.company_id))) || [])[0] : null;
    return { site: { code: s.code, name: s.name || '', address: s.address || '', contact: s.contact_name || '', phone: s.contact_phone || '' },
      company: c ? { id: c.id, name: c.name || '', address: c.address || '', gstin: c.gstin || '', pan: c.pan || '', logo: c.logo || '' } : null };
  } catch (e) { return null; }
}

module.exports = handler(async (req, res) => {
  const q = query(req), mod = String(q.get('module') || ''), site = String(q.get('site') || '').toUpperCase();
  // the page of the module to open (from a module's menu: "Store → Item Master"); only a plain name passes
  const page = /^[a-z0-9_-]{1,40}$/i.test(String(q.get('page') || '')) ? String(q.get('page')) : '';
  // ONE ADDRESS: every way back to the Portal page is RELATIVE ("../" from …/api/go = the Portal page), so it stays right
  // whether the Portal is opened at its own address or under the main one (<main>/portal)
  /* IN THE SAME VIEW (asked 13-10-2026: "sign in ekdach … modual change sathi sign in nahi … app ekdam smooth"): a module shown
   * INSIDE another one (the Store's page inside Mechanical's screen) asks for its ticket with json=1 – the answer is the ticket
   * itself, no page change. Only the Portal's own address may ask (our header; a page of another site cannot read the answer). */
  const asJson = q.get('json') === '1';
  /* (23-10-2026) renew=1: the Store's / Engineering's open page keeps its sign-in fresh with a ticket every 10 minutes (their
   * sign-in now lasts 15 minutes, so a person removed here is out there within 15 minutes) – the same checks, the same ticket; only
   * the activity record is not written again for it (it would be one line every 10 minutes for every open page). */
  const renew = asJson && q.get('renew') === '1';
  if (asJson) sameSite(req);
  const back = (where, code) => asJson ? send(res, code === 'signin' ? 401 : 403, { error: code === 'signin' ? 'Sign in on the Portal first.' : 'This cannot be opened here.', code: code }) : redirect(res, where);
  const s = await ses.read(req);
  if (!s && asJson) return back('', 'signin');
  if (!s) return redirect(res, '../?next=' + enc('api/go?module=' + enc(mod) + '&site=' + enc(site) + (page ? '&page=' + enc(page) : '')));
  const u = s.user;
  // (14-10-2026) the Super Admin opens every module of every site, as its Admin (myItems: all)
  if (pw.mustChange(u.password_hash)) return back('../', 'signin');
  const items = await myItems(u.email, !!u.is_super);
  const it = items.find(x => x.module === mod && x.site === site);
  if (!it) return back('../?msg=noaccess', 'noaccess');
  const m = ((await db('GET', 'modules?select=url&key=eq.' + enc(mod))) || [])[0];
  const now = Math.floor(Date.now() / 1000);
  const paper = mod === 'store' ? await paperOf(site) : null;
  const ticket = await keys.sign({
    iss: publicUrl() || origin(req), aud: mod, sub: u.email, name: u.name, site: site, siteName: it.siteName, role: it.role,
    // the person's other modules on this site and his other sites of this module – for the module's own "Modules" switch
    // (with each one's address: a module's menu lists the pages of the others and opens them in the same window)
    mods: items.filter(x => x.site === site).map(x => ({ key: x.module, name: x.moduleName, url: x.url })),
    sites: items.filter(x => x.module === mod).map(x => ({ code: x.site, name: x.siteName })),
    // (14-10-2026) the pages the Super Admin gave him in this module on this site (Users & Access → Pages); none = every page
    // (with the Store's step 2) a Store Admin's "Store Purchase" (HO Purchase – every site) goes too; the Super Admin has it
    pages: mod === 'store' && it.role === 'admin' ? (u.is_super || (it.pages && it.pages.purchase === 'Edit') ? { purchase: 'Edit' } : undefined) : it.role === 'admin' ? undefined : (it.pages || undefined),
    // (14-10-2026) the Super Admin – Mechanical lets him change entries of a billed period and approve others' changes there
    super: u.is_super ? true : undefined,
    // (29-10-2026) the Store's papers: the site's company and the site's own address and contact, as given here (Companies, Sites)
    paper: paper || undefined,
    iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') });
  if (!renew) await audit(u.email, 'Opened module', mod + ' · ' + site, null);
  if (asJson) return send(res, 200, { ticket: ticket });
  redirect(res, String(m.url).replace(/\/+$/, '') + '/#sso=' + ticket + (page ? '&page=' + enc(page) : ''));
});
