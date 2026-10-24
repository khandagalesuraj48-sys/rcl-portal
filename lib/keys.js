/* THE PORTAL'S SIGNATURE ON A "TICKET". When a person opens a module, the Portal hands the module a ticket: a short note
 * (who, which site, which module, as what) that is valid for 60 seconds and signed with the Portal's private key (ES256).
 * The module checks the signature with the Portal's PUBLIC key (/api/jwks) – nobody else can make a ticket, and the
 * module never needs a secret of the Portal.
 * The key pair is made by the Portal itself the first time it is needed. Its private half is kept in the database LOCKED
 * (AES-256-GCM) with a key made from the Vercel setting PORTAL_SECRET – the database alone gives nobody the key. */
'use strict';
const crypto = require('crypto');
const { db } = require('./db');
const { fail } = require('./http');
let MEM = null;

function lock() {
  const s = String(process.env.PORTAL_SECRET || '');
  if (s.length < 32) throw fail(500, 'The Portal server is not set up: PORTAL_SECRET (at least 32 letters and digits) is missing in Vercel → Environment Variables.');
  return crypto.createHash('sha256').update('rcl-portal-keys|' + s).digest();
}
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', lock(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function open(sealed) {
  const b = Buffer.from(String(sealed).replace(/^v1\./, ''), 'base64url');
  try { const d = crypto.createDecipheriv('aes-256-gcm', lock(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
  catch (e) { throw fail(500, 'The Portal\'s signing key cannot be opened: PORTAL_SECRET in Vercel is not the one it was locked with.'); }
}
async function current() {
  if (MEM && Date.now() - MEM.at < 10 * 60 * 1000) return MEM;
  let rows = await db('GET', 'signing_keys?select=kid,public_jwk,private_sealed&active=is.true&order=created_at.asc&limit=1');
  if (!rows || !rows.length) {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = kp.publicKey.export({ format: 'jwk' }), kid = crypto.randomBytes(8).toString('hex');
    Object.assign(jwk, { kid: kid, alg: 'ES256', use: 'sig' });
    await db('POST', 'signing_keys', [{ kid: kid, public_jwk: jwk, private_sealed: seal(kp.privateKey.export({ format: 'pem', type: 'pkcs8' })) }], 'return=minimal');
    PUB = null;      // (a new public key: the next /api/jwks reads it)
    rows = await db('GET', 'signing_keys?select=kid,public_jwk,private_sealed&active=is.true&order=created_at.asc&limit=1');      // (two servers at once: both take the oldest)
  }
  const r = rows[0];
  MEM = { at: Date.now(), kid: r.kid, jwk: r.public_jwk, key: crypto.createPrivateKey(open(r.private_sealed)) };
  return MEM;
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
async function sign(claims) {
  const k = await current();
  const head = b64({ alg: 'ES256', typ: 'JWT', kid: k.kid }), body = b64(claims);
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: k.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return head + '.' + body + '.' + sig;
}
/* (24-10-2026, Mechanical's update-155 – the audit: "/api/jwks reads the database on every call") the public keys are kept in this
 * server's memory for 5 minutes – the same time the answer already tells browsers and modules to keep it (max-age=300); a key this
 * server makes itself empties it at once. Only public keys – nothing secret is kept differently. */
let PUB = null;
async function jwks() {
  if (PUB && Date.now() - PUB.at < 5 * 60 * 1000) return { keys: PUB.keys };
  let rows = (await db('GET', 'signing_keys?select=public_jwk&active=is.true&order=created_at.asc')) || [];
  // no key yet (or the one this server remembers was taken out of the database): make one now – never ask again in a circle
  if (!rows.length) { MEM = null; await current(); rows = (await db('GET', 'signing_keys?select=public_jwk&active=is.true&order=created_at.asc')) || []; }
  const keys = rows.map(r => r.public_jwk);
  if (keys.length) PUB = { at: Date.now(), keys: keys };
  return { keys: keys };
}
module.exports = { sign, jwks, seal, open };
