/* POST /api/ads { action, … } – THE ADVERTISE CORNER (11-11-2026; sql/portal_step8_ads.sql; the rules: lib/ads.js).
 *   live       { platform: 'app' | 'web', site }  – for a person signed in: the posts that show NOW on his site, in their order,
 *              each with a link to its file that works for one hour. He must have an access line on that site (the Super Admin: any).
 *   list       – the Super Admin: every post (Active and Inactive), with links to look at them
 *   uploadUrl  { type, bytes }  – the Super Admin: a place for ONE new file and a link the browser sends it to directly
 *              (a video is too big to pass through this server); only images and videos, at most 25 MB
 *   save       { id?, … }  – the Super Admin: a new post or a change (lib/ads.js clean); a post is never deleted – active: false
 *   order      { ids: [...] }  – the Super Admin: the order of the slides
 * The files are in a PRIVATE bucket ("ads") of the Portal's Supabase – never public, never in git. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const ses = require('../lib/session');
const { db, enc } = require('../lib/db');
const { audit } = require('../lib/audit');
const { guard } = require('../lib/preview');
const A = require('../lib/ads');

const BUCKET = 'ads';
const STEP8 = 'The Advertise Corner needs the Portal\'s database step 8 first: run sql/portal_step8_ads.sql once in the Portal\'s Supabase → SQL Editor.';
const store = () => ({ url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: String(process.env.SUPABASE_SECRET_KEY || '') });
const missing = e => /PGRST205|42P01|Could not find the table|relation .*ads.* does not exist/i.test(String((e && e.message) || e));

async function storage(path, body) {
  const c = store();
  if (!c.url || !c.key) throw fail(500, 'The Portal server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel → Environment Variables.');
  await guard(c);
  let r;
  try { r = await fetch(c.url + '/storage/v1/' + path, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw fail(503, 'Could not reach the place of the posts\' files – please try again in a moment.'); }
  const t = await r.text();
  if (!r.ok) { if (/bucket not found/i.test(t)) throw fail(409, STEP8, 'step8'); throw fail(500, 'Files of the posts: ' + r.status + ' ' + t.slice(0, 200)); }
  let j; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { c, j };
}
// links that work for [seconds]
async function signed(paths, seconds) {
  paths = Array.from(new Set(paths.filter(Boolean)));
  if (!paths.length) return {};
  const { c, j } = await storage('object/sign/' + BUCKET, { expiresIn: seconds, paths });
  const out = {};
  (Array.isArray(j) ? j : []).forEach(x => { if (x && x.path && x.signedURL && !x.error) out[x.path] = c.url + '/storage/v1' + x.signedURL; });
  return out;
}
const rows = async q => { try { return (await db('GET', 'ads?select=*&' + q)) || []; } catch (e) { if (missing(e)) return null; throw e; } };
const view = (r, urls) => ({ id: r.id, title: r.title, kind: r.kind, media: r.media, size: r.size, seconds: r.seconds, url: urls[r.path] || '', poster: r.poster ? urls[r.poster] || '' : '' });

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'POST only.');
  sameSite(req);
  const x = await readBody(req), action = String(x.action || '');

  if (action === 'live') {
    const s = await ses.read(req);
    if (!s) throw fail(401, 'Please sign in on the Portal first.', 'signin');
    const platform = x.platform === 'app' ? 'app' : 'web', site = String(x.site || '').trim();
    if (!site) throw fail(400, 'Which site?');
    if (!s.user.is_super) {
      const acc = (await db('GET', 'access?select=site&email=eq.' + enc(s.user.email) + '&site=eq.' + enc(site) + '&limit=1')) || [];
      if (!acc.length) throw fail(403, 'You have no access to this site.', 'site');
    }
    const at = A.india();
    const all = await rows('active=eq.true&date_from=lte.' + at.date + '&date_to=gte.' + at.date + '&order=sort.asc,created_at.asc&limit=200');
    if (!all) return send(res, 200, { posts: [] });                // before step 8: nothing is shown, as before
    const st = ((await db('GET', 'sites?select=code,company_id&code=eq.' + enc(site))) || [])[0] || {};
    const now = all.filter(r => A.live(r, { platform, site, company: String(st.company_id || '') }, at)).slice(0, 20);
    const urls = now.length ? await signed(now.map(r => r.path).concat(now.map(r => r.poster)), 3600) : {};
    return send(res, 200, { posts: now.map(r => view(r, urls)).filter(p => p.url) });
  }

  const me = await ses.need(req, { super: true });

  if (action === 'list') {
    const all = await rows('order=sort.asc,created_at.asc&limit=500');
    if (!all) throw fail(409, STEP8, 'step8');
    const urls = all.length ? await signed(all.map(r => r.path).concat(all.map(r => r.poster)), 3600) : {};
    return send(res, 200, { posts: all.map(r => Object.assign(view(r, urls), { path: r.path, posterPath: r.poster || '', onApp: r.on_app, onWeb: r.on_web, from: r.date_from, to: r.date_to, days: r.days,
      timeFrom: String(r.time_from).slice(0, 5), timeTo: String(r.time_to).slice(0, 5), sites: r.sites || [], company: r.company || '', sort: r.sort, active: r.active, at: r.updated_at, by: r.updated_by })), now: A.india() });
  }

  if (action === 'uploadUrl') {
    const ext = A.TYPES[String(x.type || '')], bytes = Number(x.bytes);
    if (!ext) throw fail(400, 'Only images (JPG, PNG, WebP, GIF) and videos (MP4, WebM) can be added.');
    if (!(bytes > 0)) throw fail(400, 'This file is empty.');
    if (bytes > A.MAX_BYTES) throw fail(400, 'This file is ' + Math.ceil(bytes / 1048576) + ' MB – a post\'s file can be at most 25 MB. Make the video shorter or smaller.');
    const path = A.india().date.slice(0, 4) + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
    const { c, j } = await storage('object/upload/sign/' + BUCKET + '/' + path, {});
    if (!j || !j.url) throw fail(500, 'Files of the posts: no place was given for the file.');
    return send(res, 200, { path, url: c.url + '/storage/v1' + j.url, type: String(x.type) });
  }

  if (action === 'save') {
    const row = Object.assign(A.clean(x), { updated_by: me.user.email, updated_at: new Date().toISOString() });
    const id = String(x.id || '');
    try {
      if (id) {
        if (!/^[0-9a-f-]{36}$/.test(id)) throw fail(400, 'This post is not in the list.');
        const r = await db('PATCH', 'ads?id=eq.' + id, row, 'return=representation');
        if (!r || !r.length) throw fail(404, 'This post is not in the list.');
      } else {
        const last = ((await db('GET', 'ads?select=sort&order=sort.desc&limit=1')) || [])[0];
        await db('POST', 'ads', [Object.assign(row, { created_by: me.user.email, sort: (last ? Number(last.sort) || 0 : 0) + 1 })], 'return=minimal');
      }
    } catch (e) { if (missing(e)) throw fail(409, STEP8, 'step8'); throw e; }
    await audit(me.user.email, id ? 'ad.change' : 'ad.add', row.title, { size: row.size, app: row.on_app, web: row.on_web, from: row.date_from, to: row.date_to, active: row.active });
    return send(res, 200, { ok: true });
  }

  if (action === 'order') {
    const ids = (Array.isArray(x.ids) ? x.ids : []).map(String).filter(i => /^[0-9a-f-]{36}$/.test(i)).slice(0, 500);
    if (!ids.length) throw fail(400, 'No posts to put in order.');
    for (let i = 0; i < ids.length; i++) await db('PATCH', 'ads?id=eq.' + ids[i], { sort: i + 1 }, 'return=minimal');
    await audit(me.user.email, 'ad.order', String(ids.length), null);
    return send(res, 200, { ok: true });
  }
  throw fail(400, 'Unknown action.');
});
