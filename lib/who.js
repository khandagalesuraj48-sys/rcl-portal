/* WHO IS SIGNING IN (step 11; his decision of 12-11-2026). The e-mail a user was made with is his USER ID – fixed for ever, the
 * name every module knows him by. The e-mail he verified with a code (users.login_email) is the one he SIGNS IN with: from then
 * on only that one opens his account (with his password or with a code) – his user ID no longer does. A user who has not
 * verified yet signs in with his user ID, as before. Until the step-11 SQL is run: exactly as before. */
'use strict';
const { db, enc } = require('./db');
const noStep11 = e => /42703|login_email|send_to/.test(String(e && e.message));
/* → the user row for the e-mail typed at the sign-in, or null. `cols` = the columns wanted (email is always among them). */
async function who(typed, cols) {
  let rows;
  try { rows = (await db('GET', 'users?select=' + cols + ',login_email&or=(email.eq.' + enc(q(typed)) + ',login_email.eq.' + enc(q(typed)) + ')')) || []; }
  catch (e) { if (!noStep11(e)) throw e; return ((await db('GET', 'users?select=' + cols + '&email=eq.' + enc(typed))) || [])[0] || null; }
  const own = rows.find(u => String(u.login_email || '').toLowerCase() === typed); if (own) return own;      // the verified sign-in e-mail wins
  const id = rows.find(u => u.email === typed); return id && !id.login_email ? id : null;                     // a user ID opens only while nothing is verified
}
const q = v => '"' + String(v).replace(/["\\]/g, '') + '"';      // (a value inside or=(…): quoted)
/* Is this address already another user's – as his user ID or as his verified sign-in e-mail? */
async function taken(addr, exceptId) {
  let rows;
  try { rows = (await db('GET', 'users?select=email&or=(email.eq.' + enc(q(addr)) + ',login_email.eq.' + enc(q(addr)) + ')')) || []; }
  catch (e) { if (!noStep11(e)) throw e; rows = (await db('GET', 'users?select=email&email=eq.' + enc(addr))) || []; }
  return rows.some(u => u.email !== exceptId);
}
module.exports = { who, taken, noStep11 };
