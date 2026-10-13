/* SIGN-INS. The browser keeps a random sign-in in a cookie that page scripts cannot read (HttpOnly) and that other sites'
 * pages do not send (SameSite=Lax); the database keeps only its fingerprint (SHA-256). Like the Mechanical app:
 * ends after 6 hours without use, after 30 days at most, at "Sign out", when the person is switched off, and when his
 * password changes (every other sign-in of his ends). */
'use strict';
const crypto = require('crypto');
const { db, rpc, enc } = require('./db');
const { fail } = require('./http');
const COOKIE = 'rcl_portal';
const IDLE_MS = 6 * 3600 * 1000, MAX_MS = 30 * 86400 * 1000;
const fp = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function cookieOf(req) {
  const c = String(req.headers.cookie || ''); const m = c.split(/;\s*/).map(x => x.split('=')).find(x => x[0] === COOKIE);
  return m ? decodeURIComponent(m.slice(1).join('=')) : '';
}
const secure = req => String(req.headers['x-forwarded-proto'] || '') === 'https' || !!process.env.VERCEL;
const setCookie = (req, token, maxAgeS) => COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeS + (secure(req) ? '; Secure' : '');
const clearCookie = req => setCookie(req, '', 0);

async function create(req, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db('POST', 'sessions', [{ id_hash: fp(token), email: email, expires_at: new Date(Date.now() + MAX_MS).toISOString(), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) }], 'return=minimal');
  return setCookie(req, token, Math.floor(MAX_MS / 1000));
}
// the person of this request's sign-in, or null
async function read(req) {
  const token = cookieOf(req); if (!token || token.length < 20) return null;
  const rows = await db('GET', 'sessions?select=id_hash,email,created_at,last_seen_at,expires_at&id_hash=eq.' + fp(token));
  const s = rows && rows[0]; if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now || now - Date.parse(s.last_seen_at) > IDLE_MS) { await db('DELETE', 'sessions?id_hash=eq.' + s.id_hash, undefined, 'return=minimal'); return null; }
  const u = ((await db('GET', 'users?select=email,name,password_hash,active,is_super&email=eq.' + enc(s.email))) || [])[0];
  if (!u || !u.active) { await db('DELETE', 'sessions?id_hash=eq.' + s.id_hash, undefined, 'return=minimal'); return null; }
  if (now - Date.parse(s.last_seen_at) > 5 * 60 * 1000) await db('PATCH', 'sessions?id_hash=eq.' + s.id_hash, { last_seen_at: new Date(now).toISOString() }, 'return=minimal');
  return { idHash: s.id_hash, user: u };
}
async function need(req, opt) {
  const s = await read(req); if (!s) throw fail(401, 'SESSION_EXPIRED', 'session');
  if (opt && opt.super && !s.user.is_super) throw fail(403, 'Only the Super Admin can do this.', 'super');
  if (opt && opt.ownPassword && !require('./pw').isHashed(s.user.password_hash)) throw fail(403, 'Set your own password first.', 'mustchange');
  return s;
}
async function end(req) { const t = cookieOf(req); if (t) await db('DELETE', 'sessions?id_hash=eq.' + fp(t), undefined, 'return=minimal'); }
async function endAll(email, keepHash) { await db('DELETE', 'sessions?email=eq.' + enc(email) + (keepHash ? '&id_hash=neq.' + keepHash : ''), undefined, 'return=minimal'); }

/* LIMITS (counted BEFORE a password is looked at, inside the database): 60 sign-ins a minute in all; 5 wrong tries for one
 * e-mail → 15 minutes. */
async function limit(email) {
  const n = await rpc('portal_hit', { p_key: 'LG_' + Math.floor(Date.now() / 60000), p_ttl: 120 });
  if (Number(n) > 60) throw fail(429, 'Too many sign-in attempts. Please wait a minute and try again.', 'busy');
  const f = await rpc('portal_hit', { p_key: 'F_' + email, p_ttl: 900 });
  if (Number(f) > 5) throw fail(429, 'Too many wrong attempts. Try again after 15 minutes.', 'locked');
  return { right: () => rpc('portal_unhit', { p_key: 'F_' + email }) };
}
module.exports = { create, read, need, end, endAll, limit, clearCookie, COOKIE, fp };
