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
  const ticket = await keys.sign({
    iss: publicUrl() || origin(req), aud: mod, sub: u.email, name: u.name, site: site, siteName: it.siteName, role: it.role,
    // the person's other modules on this site and his other sites of this module – for the module's own "Modules" switch
    // (with each one's address: a module's menu lists the pages of the others and opens them in the same window)
    mods: items.filter(x => x.site === site).map(x => ({ key: x.module, name: x.moduleName, url: x.url })),
    sites: items.filter(x => x.module === mod).map(x => ({ code: x.site, name: x.siteName })),
    // (14-10-2026) the pages the Super Admin gave him in this module on this site (Users & Access → Pages); none = every page
    pages: it.role === 'admin' ? undefined : (it.pages || undefined),
    // (14-10-2026) the Super Admin – Mechanical lets him change entries of a billed period and approve others' changes there
    super: u.is_super ? true : undefined,
    iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') });
  await audit(u.email, 'Opened module', mod + ' · ' + site, null);
  if (asJson) return send(res, 200, { ticket: ticket });
  redirect(res, String(m.url).replace(/\/+$/, '') + '/#sso=' + ticket + (page ? '&page=' + enc(page) : ''));
});
