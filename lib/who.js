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
/* (step 12, 13-11-2026: "login email plus mobile number … mobile number gela tr password ni login") THE MOBILE NUMBER a person can
 * sign in with – with his PASSWORD only (a code goes only to an e-mail). It is put on a user by HR when it gives an employee his
 * sign-in; a number belongs to one user. An employee who has no e-mail gets a user ID made of his number (<number>@mobile.id) –
 * a name for the modules, never an address anything is sent to. Until the step-12 SQL is run: nobody signs in with a number. */
const noStep12 = e => /42703|mobile/.test(String(e && e.message));
// what was typed, as a mobile number: ten digits beginning 6–9 (spaces, dashes, +91 / 0 in front are taken off) – else ''
function mobileOf(v) { let t = String(v === undefined || v === null ? '' : v).replace(/[\s\-().]/g, ''); if (/^\+?91[6-9]\d{9}$/.test(t)) t = t.slice(-10); else if (/^0[6-9]\d{9}$/.test(t)) t = t.slice(1); return /^[6-9]\d{9}$/.test(t) ? t : ''; }
const MOBILE_ID = /^[6-9]\d{9}@mobile\.id$/, idFor = m => m + '@mobile.id', isMobileId = e => MOBILE_ID.test(String(e || ''));
async function byMobile(mobile, cols) {
  if (!mobile) return null;
  try { return ((await db('GET', 'users?select=' + cols + ',mobile&mobile=eq.' + mobile)) || [])[0] || null; }
  catch (e) { if (!noStep12(e)) throw e; return null; }
}
// is the step-12 SQL run? (asked by what gives a mobile number to a user)
async function step12() { try { await db('GET', 'users?select=mobile&limit=1'); return true; } catch (e) { if (!noStep12(e)) throw e; return false; } }
module.exports = { who, taken, noStep11, noStep12, mobileOf, idFor, isMobileId, byMobile, step12 };
