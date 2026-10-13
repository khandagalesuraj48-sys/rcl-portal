/* PASSWORDS – kept exactly the way the Mechanical app keeps them, so every person's password moves to the Portal unchanged:
 *   scrypt$<N>$8$<p>$<salt 32 hex>$<hash 64 hex>$<stamp 12 hex>       a one-time password has "tmp$" in front
 *   sha256$<salt 16 hex>$<hash 64 hex>                                 the older form (accepted, kept afresh at the next sign-in)
 *   plain text written into the table by hand                          accepted once, must be changed
 * (Mechanical: app/Code.gs makeHash_ / checkPw_ and server/gas.js scryptHex – the same settings.) */
'use strict';
const crypto = require('crypto');
const SC = { N: 32768, r: 8, p: 3 };
const RE = /^scrypt\$(16384|32768|65536|131072)\$8\$([1-5])\$([0-9a-f]{32})\$([0-9a-f]{64})\$([0-9a-f]{12})$/;
const OLD = /^sha256\$([0-9a-f]{16})\$([0-9a-f]{64})$/;
const PW_MIN = 8;

const scrypt = (pw, saltHex, N, p) => new Promise((ok, no) => crypto.scrypt(Buffer.from(String(pw), 'utf8'), Buffer.from(saltHex, 'hex'), 32, { N: N, r: 8, p: p, maxmem: 160 * 1024 * 1024 }, (e, k) => e ? no(e) : ok(k.toString('hex'))));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isHashed = s => RE.test(String(s || '')) || OLD.test(String(s || ''));
const isTemp = s => /^tmp\$/.test(String(s || '')) && isHashed(String(s).slice(4));
const current = s => { const m = String(s || '').replace(/^tmp\$/, '').match(RE); return !!m && Number(m[1]) === SC.N && Number(m[2]) === SC.p; };
// the older form, worked out the way Apps Script did it (SHA-256 of salt|password, then 300 rounds with the salt appended)
function oldHash(pw, salt) {
  let h = crypto.createHash('sha256').update(salt + '|' + pw, 'utf8').digest();
  const s = Buffer.from(salt, 'utf8');
  for (let i = 0; i < 300; i++) h = crypto.createHash('sha256').update(Buffer.concat([h, s])).digest();
  return h.toString('hex');
}
async function make(pw, stamp) {
  const salt = crypto.randomBytes(16).toString('hex'), st = /^[0-9a-f]{12}$/.test(String(stamp || '')) ? String(stamp) : crypto.randomBytes(6).toString('hex');
  return ['scrypt', SC.N, SC.r, SC.p, salt, await scrypt(pw, salt, SC.N, SC.p), st].join('$');
}
async function check(pw, stored) {
  stored = String(stored || ''); if (!stored) return false;
  const body = isTemp(stored) ? stored.slice(4) : stored;
  const m = body.match(RE); if (m) return same(await scrypt(pw, m[3], Number(m[1]), Number(m[2])), m[4]);
  const o = body.match(OLD); if (o) return same(oldHash(String(pw), o[1]), o[2]);
  if (/^(tmp\$)?(scrypt|sha256)\$/.test(stored)) return false;        // damaged: never compared as plain text
  return same(String(pw), stored);                                    // plain text written by hand: accepted, must be changed
}
// a wrong e-mail costs the same time as a right one (the answer's time must not tell which e-mails exist)
async function dummy(pw) { try { await scrypt(pw, '00000000000000000000000000000000', SC.N, SC.p); } catch (e) { /* only the time matters */ } return false; }
function policy(pw) {
  pw = String(pw || '');
  if (pw.length < PW_MIN) return 'Password must have at least ' + PW_MIN + ' characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must have letters and numbers.';
  if (/^(admin@123|demo1234|password1|12345678|rcl@1234)$/i.test(pw)) return 'This password is too easy to guess.';
  return '';
}
// must this person set a password of his own at this sign-in? (a one-time one, or one not kept as a hash)
const mustChange = stored => !isHashed(stored);
module.exports = { make, check, dummy, policy, mustChange, isHashed, isTemp, current, scrypt, oldHash, RE };
