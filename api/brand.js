/* THE BRAND (14-11-2026; sql/portal_step13_brand.sql; the rules: lib/brand.js).
 *   GET  /api/brand                      → { name, first, second, line, logo, photo } – for everybody, also before the
 *                                          sign-in (the name and logo are on the sign-in page and the app's opening screen)
 *   GET  /api/brand?img=logo|photo|co-ID → the picture itself (404 when there is none: the built-in one is shown)
 *   POST /api/brand { action }           → the Super Admin: get · save { first, second, line } · file { name, mime, data } ·
 *                                          fileRemove { name }
 * Nothing but the name, the line and these pictures is given without a sign-in. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const ses = require('../lib/session');
const { db, enc } = require('../lib/db');
const { audit } = require('../lib/audit');
const B = require('../lib/brand');

const STEP13 = 'Branding needs the Portal\'s database step 13 first: run sql/portal_step13_brand.sql once in the Portal\'s Supabase → SQL Editor.';
const missing = e => /PGRST205|42P01|Could not find the table|relation .*brand.* does not exist/i.test(String((e && e.message) || e));
// the row and the list of pictures (without the pictures) – null when step 13 is not run
async function read() {
  try {
    const [row, files] = await Promise.all([db('GET', 'brand?select=first,second,line,updated_at,updated_by&id=eq.product'), db('GET', 'brand_files?select=name,updated_at')]);
    return { row: (row || [])[0] || null, files: files || [] };
  } catch (e) { if (missing(e)) return null; throw e; }
}
let memo = null;      // what everybody is told is asked from the database at most once in 30 seconds on a server
async function told() {
  if (memo && Date.now() - memo.at < 30000) return memo.v;
  const r = await read(), v = B.view(r && r.row, r && r.files);
  memo = { at: Date.now(), v }; return v;
}

module.exports = handler(async (req, res) => {
  if (req.method === 'GET') {
    const img = String((req.query && req.query.img) || new URL(req.url, 'http://x').searchParams.get('img') || '');
    if (!img) {
      let v; try { v = await told(); } catch (e) { v = B.view(null, []); }      // the database not answering: the built-in name, never a broken page
      // no list of the companies is given without a sign-in: a client's logo is asked for by its id, which a person learns only with his own sites
      return send(res, 200, { name: v.name, first: v.first, second: v.second, line: v.line, logo: v.logo, photo: v.photo }, { 'Cache-Control': 'public, max-age=60' });
    }
    if (!B.NAME.test(img)) throw fail(404, 'No such picture.');
    let f = null; try { f = ((await db('GET', 'brand_files?select=mime,data&name=eq.' + enc(img))) || [])[0]; } catch (e) { if (!missing(e)) throw e; }
    if (!f || B.TYPES.indexOf(f.mime) < 0) throw fail(404, 'No such picture.');
    const buf = Buffer.from(String(f.data), 'base64');
    res.statusCode = 200; res.setHeader('Content-Type', f.mime); res.setHeader('Content-Length', String(buf.length)); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', /[?&]v=\d+/.test(String(req.url)) ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    return res.end(buf);
  }
  if (req.method !== 'POST') throw fail(405, 'GET or POST only.');
  sameSite(req);
  const me = await ses.need(req, { super: true });
  const x = await readBody(req, 1500000), action = String(x.action || '');
  if (action === 'get') {
    const r = await read();
    return send(res, 200, Object.assign(B.view(r && r.row, r && r.files), { ready: !!r, by: r && r.row ? r.row.updated_by : '', at: r && r.row ? r.row.updated_at : '', max: B.MAX }));
  }
  const now = new Date().toISOString();
  try {
    if (action === 'save') {
      const b = B.clean(x);
      await db('POST', 'brand?on_conflict=id', [Object.assign({ id: 'product', updated_by: me.user.email, updated_at: now }, b)], 'resolution=merge-duplicates,return=minimal');
      await audit(me.user.email, 'Brand changed', 'product', b); memo = null;
      return send(res, 200, { ok: true });
    }
    if (action === 'file') {
      const f = B.file(x);
      if (/^co-/.test(f.name) && !((await db('GET', 'companies?select=id&id=eq.' + enc(f.name.slice(3)))) || []).length) throw fail(404, 'This company is not in the list.');
      await db('POST', 'brand_files?on_conflict=name', [Object.assign({ updated_by: me.user.email, updated_at: now }, f)], 'resolution=merge-duplicates,return=minimal');
      await audit(me.user.email, 'Brand picture changed', f.name, { mime: f.mime, kb: Math.ceil(f.data.length * 3 / 4 / 1024) }); memo = null;
      return send(res, 200, { ok: true, v: String(Date.parse(now)) });
    }
    if (action === 'fileRemove') {
      const name = String(x.name || ''); if (!B.NAME.test(name)) throw fail(400, 'This picture has no place in the brand.');
      await db('DELETE', 'brand_files?name=eq.' + enc(name), undefined, 'return=minimal');
      await audit(me.user.email, 'Brand picture removed', name, {}); memo = null;
      return send(res, 200, { ok: true });
    }
  } catch (e) { if (missing(e)) throw fail(409, STEP13, 'step13'); throw e; }
  throw fail(400, 'Unknown action.');
});
