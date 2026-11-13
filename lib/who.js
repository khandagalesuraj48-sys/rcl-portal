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
/* (step 12, asked 13-11-2026: "login email plus mobile number … mobile number gela tr password ni login") THE MOBILE NUMBER a person
 * signs in with: ten digits as HR put them on his sign-in – "+91", a leading 0, spaces and dashes are not minded. A number the
 * Portal does not know opens nothing ("system madhe … nasel tr login nahi"). Until the step-12 SQL is run: no number is known. */
const noStep12 = e => /42703|PGRST204/.test(String(e && e.message));
function mobile(v) { let d = String(v === undefined || v === null ? '' : v).replace(/[\s\-().]/g, ''); if (/^\+91\d{10}$/.test(d)) d = d.slice(3); else if (/^(91|0)\d{10}$/.test(d)) d = d.replace(/^(91|0)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : ''; }
async function byMobile(m, cols) {
  if (!m) return null;
  try { return ((await db('GET', 'users?select=' + cols + ',mobile&mobile=eq.' + m)) || [])[0] || null; }
  catch (e) { if (!noStep12(e)) throw e; return null; }
}
// the user ID of a person who has no e-mail: made of his mobile number of that day – an address that can never receive a mail
const MOBILE_ID = /^[6-9]\d{9}@mobile\.invalid$/, mobileId = m => m + '@mobile.invalid', noMail = id => /\.invalid$/.test(String(id || ''));
module.exports = { who, taken, noStep11, noStep12, mobile, byMobile, mobileId, noMail, MOBILE_ID };
