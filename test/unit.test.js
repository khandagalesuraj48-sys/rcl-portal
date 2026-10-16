/* Unit tests – no database needed:  node --test test/unit.test.js
 * The key one: a password kept by the Mechanical app is accepted by the Portal and the other way round (the Mechanical
 * code is taken from ../rclerp when it is next to this repository, as in the VS Code workspace). */
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = require('../lib/pw');
const MECH = ['../../rclerp', '../../vercel'].map(p => path.join(__dirname, p)).find(p => fs.existsSync(path.join(p, 'server', 'gas.js')));

test('passwords: made, checked, a wrong one refused, the settings Mechanical uses', async () => {
  const h = await pw.make('Ravi#Own2026');
  assert.match(h, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{64}\$[0-9a-f]{12}$/);
  assert.strictEqual(await pw.check('Ravi#Own2026', h), true);
  assert.strictEqual(await pw.check('Ravi#Own2027', h), false);
  assert.strictEqual(await pw.check('Ravi#Own2026', 'tmp$' + h), true, 'a one-time password is checked the same way');
  assert.strictEqual(pw.mustChange('tmp$' + h), true); assert.strictEqual(pw.mustChange(h), false);
  assert.strictEqual(await pw.check('x', 'scrypt$32768$8$3$damaged'), false, 'a damaged kept password is never compared as plain text');
  assert.strictEqual(await pw.check('plain123', 'plain123'), true); assert.strictEqual(pw.mustChange('plain123'), true, 'plain text written by hand: accepted once, must be changed');
  assert.ok(pw.policy('short1') && pw.policy('onlyletters') && pw.policy('12345678') && !pw.policy('Good#Pass1'));
});

test('passwords move between Mechanical and the Portal unchanged (both directions)', { skip: !MECH && 'the Mechanical repository is not next to this one' }, async () => {
  const gas = require(path.join(MECH, 'server', 'gas.js'));
  // Mechanical's own way (server/gas.js scryptHex, app/Code.gs makeHash_): salt, N=32768, r=8, p=3, 32 bytes
  const salt = crypto.randomBytes(16).toString('hex'), mechHash = ['scrypt', 32768, 8, 3, salt, gas.scryptHex('Nashik#Road848!', salt, 32768, 8, 3), 'abcdef012345'].join('$');
  assert.strictEqual(await pw.check('Nashik#Road848!', mechHash), true, 'a Mechanical password opens the Portal');
  const portalHash = await pw.make('Portal#Made2026'), m = portalHash.match(pw.RE);
  assert.strictEqual(gas.scryptHex('Portal#Made2026', m[3], Number(m[1]), 8, Number(m[2])), m[4], 'a Portal password would open Mechanical');
  // the older form, the way Apps Script made it (Utilities.computeDigest with signed bytes) – the same answer
  const U = gas.Utilities, hex = b => b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
  const old = (p, s) => { let h = U.computeDigest(U.DigestAlgorithm.SHA_256, s + '|' + p, U.Charset.UTF_8); for (let i = 0; i < 300; i++) h = U.computeDigest(U.DigestAlgorithm.SHA_256, h.concat(U.newBlob(s).getBytes())); return hex(h); };
  const s16 = '0123456789abcdef';
  assert.strictEqual(pw.oldHash('Old#Pass123', s16), old('Old#Pass123', s16));
  assert.strictEqual(await pw.check('Old#Pass123', 'sha256$' + s16 + '$' + old('Old#Pass123', s16)), true);
});

test('the signing key is kept locked: opens only with the same PORTAL_SECRET', () => {
  const keys = require('../lib/keys'), was = process.env.PORTAL_SECRET;
  try {
    process.env.PORTAL_SECRET = 'unit-test-portal-secret-0123456789abcdef';
    const s = keys.seal('-----BEGIN PRIVATE KEY-----x');
    assert.match(s, /^v1\./); assert.ok(!s.includes('PRIVATE'));
    assert.strictEqual(keys.open(s), '-----BEGIN PRIVATE KEY-----x');
    process.env.PORTAL_SECRET = 'another-portal-secret-0123456789abcdefgh';
    assert.throws(() => keys.open(s), /not the one it was locked with/);
    process.env.PORTAL_SECRET = 'short';
    assert.throws(() => keys.seal('x'), /PORTAL_SECRET/);
  } finally { if (was === undefined) delete process.env.PORTAL_SECRET; else process.env.PORTAL_SECRET = was; }
});

test('a request from another web page is refused; our own page passes', () => {
  const { sameSite } = require('../lib/http');
  assert.throws(() => sameSite({ headers: { host: 'p.example' } }), /did not come from the Portal page/);
  assert.throws(() => sameSite({ headers: { host: 'p.example', 'x-rcl': '1', origin: 'https://evil.example' } }), /another web page/);
  assert.doesNotThrow(() => sameSite({ headers: { host: 'p.example', 'x-rcl': '1', origin: 'https://p.example' } }));
  assert.doesNotThrow(() => sameSite({ headers: { host: 'p.example', 'x-rcl': '1' } }));
});

test('a module link: https only (http only for this computer, for tests)', () => {
  const { okUrl, recoveryCode, codeClean } = require('../lib/util');
  assert.ok(okUrl('https://rclerp.vercel.app') && okUrl('http://127.0.0.1:3000') && !okUrl('http://rclerp.vercel.app') && !okUrl('javascript:alert(1)') && !okUrl('https://a"b'));
  const c = recoveryCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/); assert.strictEqual(codeClean(c.toLowerCase()), c.replace(/-/g, ''));
});

test('the page: every view is there, no secret, no outside script', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ['v_login', 'v_setup', 'v_rec', 'v_pw', 'v_home', 'v_sa'].forEach(id => assert.ok(html.includes('id="' + id + '"'), id));
  assert.ok(!/<script[^>]+src=/i.test(html), 'no script from another site');
  assert.ok(!/sb_secret_|PORTAL_SECRET=|eyJhbGciOi/.test(html), 'no key in the page');
  assert.ok(!/localStorage\.setItem\([^)]*token/i.test(html), 'the sign-in is never kept where scripts can read it');
});

test('(14-10-2026) every ticket the Portal signs has the same issuer: its public address (one address) – else Mechanical says "made by another Portal"', () => {
  const api = path.join(__dirname, '..', 'api');
  const signs = fs.readdirSync(api).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(api, f), 'utf8')).join('\n').match(/keys\.sign\([\s\S]{0,160}?iss: [^,]+,/g) || [];
  assert.ok(signs.length >= 2, 'tickets found: ' + signs.length);
  signs.forEach(s => assert.match(s, /iss: publicUrl\(\) \|\| origin\(req\),/, s));
});

test('(with Mechanical update-117) a site\'s diesel places: set in New site and under Sites → Diesel places, sent to Mechanical inside the signed ticket', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  assert.match(adm, /async placesGet\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, \{ act: 'places', site: site \}\)/);
  assert.match(adm, /async placesSave\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, \{ act: 'placesSave', site: site, places: places \}\);\n    await audit\(me\.email, 'Diesel places', site/);
  assert.match(adm, /act: 'siteSetup', [^\n]*, places: placesIn\(x\.places\) \}\);/);
  ['id="ns_places"', 'id="dp_panel"', "places: '6. Diesel places (name and tank size)', ready: '7. Ready'", "['link', 'key', 'connect', 'tables', 'company', 'places', 'ready']", "places: placesRead($('ns_places'))", 'class="link st-places"'].forEach(t => assert.ok(html.includes(t), t));
  // the page's editor, run on its own
  const at = html.indexOf('  const ltr = n => '), to = html.indexOf("  document.addEventListener('click', e => { const box = e.target.closest('.pl-box');");
  const f = new Function('esc', html.slice(at, to) + '; return { placesRow, placesHtml };')(s => String(s));
  const one = f.placesRow({ name: 'Camp Pump', cap: 18000, used: true, stock: 3940 }, true);
  assert.ok(/value="Camp Pump" placeholder="e.g. Camp Pump" readonly>/.test(one) && /has entries – the name stays/.test(one) && /3,940 Ltr/.test(one) && !/pl-del/.test(one), one);
  assert.ok(/pl-del/.test(f.placesRow({ name: 'MH12ZE1739', cap: 2650 }, true)), 'a place without entries can be removed');
  assert.strictEqual((f.placesHtml([{}, {}], false).match(/<tr><td>/g) || []).length, 2);
});
