/* SIGN-INS. The browser keeps a random sign-in in a cookie that page scripts cannot read (HttpOnly) and that other sites'
 * pages do not send (SameSite=Lax); the database keeps only its fingerprint (SHA-256).
 * (18-10-2026, asked: "app 6 hour nantr log out hote as nko aahe … user jo prynt log out krt nahi to prynt log in rahil mg app
 * aso ki web") A sign-in STAYS UNTIL "SIGN OUT" – on the web and in the app: no more "6 hours without use", no more "30 days".
 * It ends only:
 *   * at "Sign out" (here or in a module – one sign-out for every module);
 *   * when the Super Admin switches the person off or gives him a new password (every sign-in of his ends at once);
 *   * when the person changes his password (every other sign-in of his ends).
 * A browser keeps a cookie 400 days at most, so while a sign-in is used its cookie and its end in the database are moved on
 * (at most once in 5 minutes, with the "last seen" time): only a sign-in left unused for 400 days ends by itself.
 * The modules' own sign-ins (Mechanical, Store) stay as they are: when one ends, the module gets a new ticket from this
 * sign-in by itself – nothing is typed. */
'use strict';
const crypto = require('crypto');
const { db, rpc, enc } = require('./db');
const { fail } = require('./http');
const COOKIE = 'rcl_portal';
const KEEP_MS = 400 * 86400 * 1000, KEEP_S = Math.floor(KEEP_MS / 1000), SEEN_MS = 5 * 60 * 1000;
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
  await db('POST', 'sessions', [{ id_hash: fp(token), email: email, expires_at: new Date(Date.now() + KEEP_MS).toISOString(), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) }], 'return=minimal');
  return setCookie(req, token, KEEP_S);
}
// the person of this request's sign-in, or null
async function read(req) {
  const token = cookieOf(req); if (!token || token.length < 20) return null;
  const rows = await db('GET', 'sessions?select=id_hash,email,created_at,last_seen_at,expires_at&id_hash=eq.' + fp(token));
  const s = rows && rows[0]; if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now) { await db('DELETE', 'sessions?id_hash=eq.' + s.id_hash, undefined, 'return=minimal'); return null; }      // unused for 400 days
  const u = ((await db('GET', 'users?select=email,name,password_hash,active,is_super&email=eq.' + enc(s.email))) || [])[0];
  if (!u || !u.active) { await db('DELETE', 'sessions?id_hash=eq.' + s.id_hash, undefined, 'return=minimal'); return null; }
  // in use: "last seen", its end and the cookie are moved on (the answer to this request carries the cookie again – http.js)
  if (now - Date.parse(s.last_seen_at) > SEEN_MS) {
    await db('PATCH', 'sessions?id_hash=eq.' + s.id_hash, { last_seen_at: new Date(now).toISOString(), expires_at: new Date(now + KEEP_MS).toISOString() }, 'return=minimal');
    req.rclCookie = setCookie(req, token, KEEP_S);
  }
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
