/* A CODE SENT BY E-MAIL (OTP) – made, kept and checked in one place (12-11-2026; his rules):
 *   6 digits from the system's secure random numbers · valid 10 minutes · works ONCE · 5 wrong tries end it · a new code ends the
 *   one before · 60 seconds between two codes · kept only as a keyed hash (HMAC with the Portal's secret: the database alone
 *   cannot be tried out) · never written in a log or the activity record.
 *   LIMITS (counted in the database before anything is sent): 5 codes an hour for one e-mail, 20 an hour from one network address,
 *   40 a minute in all; 10 checks in 15 minutes for one e-mail.
 * Needs the Portal's step 10 (sql/portal_step10_email_otp.sql). */
'use strict';
const crypto = require('crypto');
const { db, rpc, enc } = require('./db');
const { fail } = require('./http');
const mail = require('./mail');
const MINUTES = 10, COOL_S = 60, TRIES = 5;
const NOSTEP = 'This needs one database step first: run sql/portal_step10_email_otp.sql once in the Portal\'s Supabase → SQL Editor.';
const on = name => /^(on|1|true|yes)$/i.test(String(process.env[name] || '').trim());
const make = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
function hash(email, purpose, code) {
  const s = String(process.env.PORTAL_SECRET || ''); if (s.length < 32) throw fail(500, 'The Portal server is not set up: PORTAL_SECRET is missing in Vercel → Environment Variables.');
  return crypto.createHmac('sha256', s).update('otp|' + purpose + '|' + email + '|' + code).digest('hex');
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const ipOf = req => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 60) || 'none';
const noStep = e => /42P01|42703|otps|email_verified_at|email_alert/.test(String(e && e.message));
// may a code go out now? { ok } or { ok: false, wait (seconds), why } – counts the try
async function mayAsk(req, email) {
  if (Number(await rpc('portal_hit', { p_key: 'OA_' + Math.floor(Date.now() / 60000), p_ttl: 120 })) > 40) return { ok: false, wait: 60, why: 'busy' };
  if (Number(await rpc('portal_hit', { p_key: 'OI_' + ipOf(req), p_ttl: 3600 })) > 20) return { ok: false, wait: 600, why: 'too many from this network' };
  return { ok: true };
}
// the newest code of this e-mail for this purpose that can still be used
const live = async (email, purpose) => ((await db('GET', 'otps?select=id,code_hash,expires_at,attempts,created_at&email=eq.' + enc(email) + '&purpose=eq.' + purpose + '&used_at=is.null&order=id.desc&limit=1')) || [])[0] || null;
/* Makes and sends a code. → { sent: true } | { sent: false, wait, why }. The code leaves this function only inside the e-mail. */
async function send(req, email, purpose, to) {      // (step 11) `to`: the address it goes to when that is not `email` (his user ID)
  const gate = await mayAsk(req, email); if (!gate.ok) return { sent: false, wait: gate.wait, why: gate.why };
  const last = await live(email, purpose), now = Date.now();
  if (last && now - Date.parse(last.created_at) < COOL_S * 1000) return { sent: false, wait: Math.ceil((COOL_S * 1000 - (now - Date.parse(last.created_at))) / 1000), why: 'cooldown' };
  if (Number(await rpc('portal_hit', { p_key: 'OE_' + email, p_ttl: 3600 })) > 5) return { sent: false, wait: 3600, why: 'too many for this e-mail' };
  const code = make(), stamp = new Date(now).toISOString();
  // the codes before this one end now (a new code ends the old one)
  await db('PATCH', 'otps?email=eq.' + enc(email) + '&purpose=eq.' + purpose + '&used_at=is.null', { used_at: stamp }, 'return=minimal');
  const row = (await db('POST', 'otps', [Object.assign({ email: email, purpose: purpose, code_hash: hash(email, purpose, code), expires_at: new Date(now + MINUTES * 60000).toISOString() }, to && to !== email ? { send_to: to } : {})], 'return=representation'))[0];
  const m = await mail.sendCode(to || email, code, purpose, MINUTES);
  if (!m.ok) { await db('PATCH', 'otps?id=eq.' + row.id, { used_at: stamp }, 'return=minimal'); return { sent: false, wait: 0, why: m.why }; }      // not sent: this code can never be used
  return { sent: true, wait: COOL_S };
}
/* Checks a code. → the code's row number (and the code is used up) | false. Wrong: one try more; at 5 the code ends. */
async function check(email, purpose, code) {
  code = String(code === undefined || code === null ? '' : code).replace(/\D/g, '');
  if (Number(await rpc('portal_hit', { p_key: 'OV_' + email, p_ttl: 900 })) > 10) throw fail(429, 'Too many tries. Ask for a new code after 15 minutes.', 'locked');
  const o = await live(email, purpose), now = Date.now();
  if (!o || code.length !== 6 || Date.parse(o.expires_at) <= now || o.attempts >= TRIES) { if (o && code.length !== 6) return false; if (o && (Date.parse(o.expires_at) <= now || o.attempts >= TRIES)) await db('PATCH', 'otps?id=eq.' + o.id, { used_at: new Date(now).toISOString() }, 'return=minimal'); return false; }
  if (!same(o.code_hash, hash(email, purpose, code))) {
    const n = o.attempts + 1; await db('PATCH', 'otps?id=eq.' + o.id + '&used_at=is.null', Object.assign({ attempts: n }, n >= TRIES ? { used_at: new Date(now).toISOString() } : {}), 'return=minimal'); return false;
  }
  /* used once: the row is marked only while it is still unused, then READ AGAIN – it is ours only when it carries the mark of this
   * very request (what a database sends back after a change that touches the columns of its own condition is not relied upon) */
  const mark = 1000 + crypto.randomInt(0, 2000000000);      // (in "attempts" of a used-up row: the number of the request that used it)
  await db('PATCH', 'otps?id=eq.' + o.id + '&used_at=is.null', { used_at: new Date(now).toISOString(), attempts: mark }, 'return=minimal');
  const won = ((await db('GET', 'otps?select=used_at,attempts&id=eq.' + o.id)) || [])[0];
  if (!won || !won.used_at || Number(won.attempts) !== mark) return false;
  await rpc('portal_unhit', { p_key: 'OV_' + email });
  return o.id;
}
// (step 11) the address a code was sent to, when that was not the user ID ('' = the user ID, or step 11 not run)
async function sentTo(id) { try { return String((((await db('GET', 'otps?select=send_to&id=eq.' + Number(id))) || [])[0] || {}).send_to || '').toLowerCase(); } catch (e) { if (/42703|send_to/.test(String(e && e.message))) return ''; throw e; } }
module.exports = { on, send, check, sentTo, make, hash, ipOf, noStep, NOSTEP, MINUTES, COOL_S, TRIES };
