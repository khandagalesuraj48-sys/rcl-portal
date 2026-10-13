/* GET /api/go?module=mechanical&site=VTR – open a module on a site, already signed in.
 * The Portal checks the person may open it, then sends the browser to the module with a TICKET: signed by the Portal, valid
 * 60 seconds, usable once (the module keeps its number). It travels after "#" in the link, so it never reaches a server's
 * log. The module checks the signature with the Portal's public key and starts its own session for that site.
 * Not signed in → the sign-in page, and back here after it. */
'use strict';
const crypto = require('crypto');
const { handler, redirect, query, origin } = require('../lib/http');
const { db, enc } = require('../lib/db');
const pw = require('../lib/pw');
const ses = require('../lib/session');
const keys = require('../lib/keys');
const { audit } = require('../lib/audit');
const { myItems } = require('./auth');

module.exports = handler(async (req, res) => {
  const q = query(req), mod = String(q.get('module') || ''), site = String(q.get('site') || '').toUpperCase();
  const s = await ses.read(req);
  if (!s) return redirect(res, '/?next=' + enc('/api/go?module=' + enc(mod) + '&site=' + enc(site)));
  const u = s.user;
  if (u.is_super) return redirect(res, '/?msg=super');
  if (pw.mustChange(u.password_hash)) return redirect(res, '/');
  const items = await myItems(u.email);
  const it = items.find(x => x.module === mod && x.site === site);
  if (!it) return redirect(res, '/?msg=noaccess');
  const m = ((await db('GET', 'modules?select=url&key=eq.' + enc(mod))) || [])[0];
  const now = Math.floor(Date.now() / 1000);
  const ticket = await keys.sign({
    iss: origin(req), aud: mod, sub: u.email, name: u.name, site: site, siteName: it.siteName, role: it.role,
    // the person's other modules on this site and his other sites of this module – for the module's own "Modules" switch
    mods: items.filter(x => x.site === site).map(x => ({ key: x.module, name: x.moduleName })),
    sites: items.filter(x => x.module === mod).map(x => ({ code: x.site, name: x.siteName })),
    iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex') });
  await audit(u.email, 'Opened module', mod + ' · ' + site, null);
  redirect(res, String(m.url).replace(/\/+$/, '') + '/#sso=' + ticket);
});
