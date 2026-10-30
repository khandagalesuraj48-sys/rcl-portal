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
  assert.match(adm, /async placesSave\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, Object\.assign\(\{ act: 'placesSave', site: site, places: places \}, mode \? \{ mode: mode \} : \{\}\)\);\n    await audit\(me\.email, 'Diesel places', site/);      // (with update-164: and the fuel-card mode)
  assert.match(adm, /act: 'siteSetup', [^\n]*, places: placesIn\(x\.places\) \}\);/);
  ['id="ns_places"', 'id="dp_panel"', "places: '6. Diesel places (name and tank size)', ready: '7. Ready'", "['link', 'key', 'connect', 'tables', 'company', 'places', 'ready']", "places: placesRead($('ns_places'))", 'class="link st-places"'].forEach(t => assert.ok(html.includes(t), t));
  // the page's editor, run on its own
  const at = html.indexOf('  const ltr = n => '), to = html.indexOf("  document.addEventListener('click', e => { const box = e.target.closest('.pl-box');");
  const f = new Function('esc', html.slice(at, to) + '; return { placesRow, placesHtml };')(s => String(s));
  const one = f.placesRow({ name: 'Camp Pump', cap: 18000, used: true, stock: 3940 }, true);
  assert.ok(/value="Camp Pump" placeholder="e.g. Camp Pump" readonly>/.test(one) && /has entries – the name and fuel stay/.test(one) && /3,940 Ltr/.test(one) && !/pl-del/.test(one), one);
  assert.ok(/pl-del/.test(f.placesRow({ name: 'MH12ZE1739', cap: 2650 }, true)), 'a place without entries can be removed');
  assert.strictEqual((f.placesHtml([{}, {}], false).match(/<tr><td>/g) || []).length, 2);
});

test('update-155: a new row is not sent twice after no answer; one that never left, a read, a change, a delete and an upsert are asked again', async () => {
  const { db, rpc } = require('../lib/db');
  const DB = (m, p, b, pr) => db(m, p.replace('ROWS', 'companies'), b, pr);
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  let plan = [], calls = 0;
  const fault = code => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error(code), { code: code }); return e; };
  global.fetch = async () => { calls++; const step = plan.shift();
    if (step === 'refused') throw fault('ECONNREFUSED');      // the request never left: no connection
    if (step === 'dropped') throw fault('UND_ERR_SOCKET');    // sent, and the answer was lost on the way back
    if (step === 500) return new Response('{"message":"boom"}', { status: 500 });
    if (step === 503) return new Response('{"message":"not reachable"}', { status: 503 });
    return new Response('[{"id":1}]', { status: 200 }); };
  const run = async (steps, ...args) => { plan = steps.slice(); calls = 0; try { return { r: await DB(...args), n: calls }; } catch (e) { return { e: e, n: calls }; } };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production';
    let x = await run(['dropped', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=representation');
    assert.ok(x.e && x.e.status === 503 && /may or may not have been saved/.test(x.e.message) && x.n === 1, 'a new row whose answer was lost: not sent again – ' + (x.e && x.e.message) + ' / ' + x.n);
    x = await run([500, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(x.e && x.n === 1, 'a new row the database answered 500 to: not sent again');
    x = await run(['refused', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row that never left (no connection): sent again');
    x = await run([503, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row the database said it did not take (503): sent again');
    for (const [m, p, pr] of [['GET', 'ROWS?select=id', undefined], ['PATCH', 'ROWS?id=eq.1', 'return=minimal'], ['DELETE', 'ROWS?id=eq.1', 'return=minimal'], ['POST', 'ROWS?on_conflict=id', 'resolution=merge-duplicates,return=minimal']]) {
      x = await run(['dropped', 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ': asked again as before (done twice it leaves the same)');
      x = await run([500, 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ' after a 500: asked again as before');
    }
    plan = ['dropped', 'ok']; calls = 0; await rpc('portal_hit', { p_key: 'X', p_ttl: 60 }); assert.strictEqual(calls, 2, 'a sign-in count is asked again as before');
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('update-157: the backup export – only with the secret; only its tables; passwords and recovery codes hidden; "since" for Sheet 2', async () => {
  const { allowed } = require('../lib/bkexport'), E = require('../api/backup-export.js');
  const env = { BACKUP_EXPORT_SECRET: process.env.BACKUP_EXPORT_SECRET, VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const asked = [];
  global.fetch = async (url) => { const u = String(url); asked.push(u);
    if (/\/rest\/v1\/$/.test(u)) return new Response(JSON.stringify({ definitions: { users: { properties: { email: {}, name: {}, password_hash: {}, recovery_hash: {}, updated_at: {}, totp_secret: {} } }, audit: { properties: { id: {}, at: {}, actor: {} } }, sessions: { properties: { id_hash: {} } }, signing_keys: { properties: { kid: {} } } } }), { status: 200 });
    if (/users\?select=email,name,active,is_super,start_item,last_login_at,created_at,updated_at,password_hash,recovery_hash&/.test(u)) return new Response(JSON.stringify([{ email: 'a@x', name: 'A', password_hash: 'scrypt$1$2', recovery_hash: 'scrypt$3' }, { email: 'b@x', name: 'B', password_hash: '', recovery_hash: null }]), { status: 200 });
    if (/audit\?select=\*/.test(u)) return new Response('[]', { status: 200 });
    return new Response(JSON.stringify([{ updated_at: '2026-10-24T10:00:00Z', at: '2026-10-24T09:00:00Z', email: 'a@x', id: 1 }]), { status: 200, headers: { 'content-range': '0-0/7' } }); };
  const call = async (body, auth) => { let status = 0, out = null;
    const req = { method: 'POST', headers: auth === undefined ? { authorization: 'Bearer ' + 'k'.repeat(30) } : auth, body: body };
    const res = { setHeader() {}, end(t) { out = JSON.parse(t); }, set statusCode(v) { status = v; } };
    await E(req, res); return { status: status, j: out }; };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production';
    delete process.env.BACKUP_EXPORT_SECRET;
    assert.throws(() => allowed({ headers: { authorization: 'Bearer anything' } }), e => e.status === 503);      // not set up: nothing is given
    process.env.BACKUP_EXPORT_SECRET = 'k'.repeat(30);
    assert.throws(() => allowed({ headers: {} }), e => e.status === 401);
    assert.throws(() => allowed({ headers: { authorization: 'Bearer ' + 'j'.repeat(30) } }), e => e.status === 401);
    assert.strictEqual((await call({ action: 'catalog' }, {})).status, 401);
    let r = await call({ action: 'catalog' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.j.tables.map(t => t.name), ['users', 'audit']);      // the sign-ins and signing keys are not in the list at all
    assert.deepStrictEqual(r.j.tables[0].cols, ['email', 'name', 'password_hash', 'recovery_hash', 'updated_at']);      // (review 25-10-2026) only the listed columns: a column added later (here "totp_secret") never leaves
    assert.strictEqual(r.j.tables[0].count, 7); assert.strictEqual(r.j.tables[0].newest, '2026-10-24T10:00:00Z');
    r = await call({ action: 'rows', table: 'users', offset: 0, limit: 1000 });
    assert.deepStrictEqual(r.j.rows[0], { email: 'a@x', name: 'A', password_hash: { __hidden: true }, recovery_hash: { __hidden: true } });
    assert.deepStrictEqual(r.j.rows[1], { email: 'b@x', name: 'B', password_hash: '', recovery_hash: null });      // none kept: nothing to hide
    assert.ok(/users\?select=email,name,active,is_super,start_item,last_login_at,created_at,updated_at,password_hash,recovery_hash&order=email\.asc&offset=0&limit=1000$/.test(asked[asked.length - 1]), asked[asked.length - 1]);
    for (const t of ['sessions', 'signing_keys', 'counters', '__proto__', 'constructor']) assert.strictEqual((await call({ action: 'rows', table: t })).status, 400, t);
    asked.length = 0; r = await call({ action: 'rows', table: 'audit', since: '2026-10-24T08:00:00.000Z', offset: 1000, limit: 5000 });
    assert.ok(/audit\?select=\*&at=gte\.2026-10-24T08%3A00%3A00\.000Z&order=id\.asc&offset=1000&limit=1000$/.test(asked[0]), asked[0]);      // since: only what is new; at most 1000 a page
    assert.strictEqual((await call({ action: 'rows', table: 'audit', since: "x'; drop" })).status, 400);
    assert.strictEqual((await call({ action: 'rows', table: 'users', since: '2026-10-24T08:00:00Z' })).status, 200);      // a table without its own time: whole
    assert.ok(!/updated_at=gte/.test(asked[asked.length - 1]));
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('update-158: the backup export says how full the database is (web_usage) – only with the secret, no row of any table; before its step: which file to run', async () => {
  const E = require('../api/backup-export.js');
  const env = { BACKUP_EXPORT_SECRET: process.env.BACKUP_EXPORT_SECRET, VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const asked = []; let missing = false;
  global.fetch = async (url, o) => { asked.push(String(url) + ' ' + ((o && o.method) || 'GET'));
    if (/rpc\/web_usage$/.test(String(url))) return missing ? new Response('{"code":"PGRST202"}', { status: 404 }) : new Response(JSON.stringify({ db: 12345678, files: [{ bucket: 'app-builds', n: '3', bytes: '4096' }], at: 'x' }), { status: 200 });
    return new Response('[]', { status: 200 }); };
  const call = async (body, auth) => { let status = 0, out = null;
    const req = { method: 'POST', headers: auth === undefined ? { authorization: 'Bearer ' + 'k'.repeat(30) } : auth, body: body };
    const res = { setHeader() {}, end(t) { out = JSON.parse(t); }, set statusCode(v) { status = v; } };
    await E(req, res); return { status: status, j: out }; };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production'; process.env.BACKUP_EXPORT_SECRET = 'k'.repeat(30) + '\n';      // (a line end pasted with it)
    assert.strictEqual((await call({ action: 'usage' }, {})).status, 401);
    let r = await call({ action: 'usage' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.j, { db: 12345678, files: [{ bucket: 'app-builds', n: 3, bytes: 4096 }] });
    assert.deepStrictEqual(asked, ['http://db.test/rest/v1/rpc/web_usage POST']);      // nothing else is read
    missing = true; r = await call({ action: 'usage' });
    assert.ok(r.status === 200 && r.j.needSql && /portal_step4_usage\.sql/.test(r.j.error), JSON.stringify(r.j));
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('(with Mechanical update-163) the fuel of each diesel place – Diesel / Petrol / CNG – chosen in New site and Sites → Diesel places, sent inside the signed ticket; a place with entries keeps its fuel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  // the server: only Petrol / CNG travel (none = Diesel, as a Portal of before); anything else is left out (Mechanical checks again)
  const at0 = adm.indexOf('const PLACE_FUELS = '), to0 = adm.indexOf('\n', adm.indexOf('const placesIn = ') + 200);
  const placesIn = new Function('clean', adm.slice(at0, adm.indexOf(').filter(p => p.name || p.cap);', at0) + 33) + '; return placesIn;')((v, n) => String(v || '').trim().slice(0, n));
  assert.deepStrictEqual(placesIn([{ name: 'DIESEL CARD', cap: 500, fuel: 'Diesel' }, { name: 'PETROL CARD', cap: 500, fuel: 'Petrol' }, { name: 'CNG CARD', cap: 300, fuel: 'CNG' }, { name: 'X', cap: 1, fuel: 'Kerosene' }]),
    [{ name: 'DIESEL CARD', cap: 500 }, { name: 'PETROL CARD', cap: 500, fuel: 'Petrol' }, { name: 'CNG CARD', cap: 300, fuel: 'CNG' }, { name: 'X', cap: 1 }]);
  assert.ok(to0 > at0);
  assert.match(adm, /await audit\(me\.email, 'Diesel places', site, Object\.assign\(\{ places: \(r\.places \|\| \[\]\)\.map\(p => p\.name \+ ' ' \+ p\.cap \+ ' Ltr' \+ \(p\.fuel && p\.fuel !== 'Diesel' \? ' ' \+ p\.fuel : ''\)\) \}, mode \?/);      // (with update-164: the mode too)
  // the page: a Fuel box in each row (a place with entries: its fuel stays), read with the row; CNG's stock in kg
  const at = html.indexOf('  const ltr = n => '), to = html.indexOf("  document.addEventListener('click', e => { const box = e.target.closest('.pl-box');");
  const f = new Function('esc', html.slice(at, to) + '; return { placesRow, placesHtml };')(s => String(s));
  const used = f.placesRow({ name: 'CNG CARD', cap: 300, used: true, stock: 32, fuel: 'CNG' }, true);
  assert.ok(/<select class="pl-fuel" disabled>/.test(used) && /<option selected>CNG<\/option>/.test(used) && /32 kg/.test(used) && /the name and fuel stay/.test(used), used);
  const fresh = f.placesRow({}, false);
  assert.ok(/<select class="pl-fuel"><option selected>Diesel<\/option><option>Petrol<\/option><option>CNG<\/option><\/select>/.test(fresh), fresh);
  assert.ok(/<th>Diesel place<\/th><th>Fuel<\/th><th>Tank size \(Ltr\)<\/th>/.test(f.placesHtml([{}], true)));
  assert.ok(html.includes("fuel: (tr.querySelector('.pl-fuel') || {}).value || 'Diesel'"), 'read with the row');
});

test('(with Mechanical update-164) a site on fuel cards – no diesel stock (HO): chosen in Sites → Diesel places, sent inside the signed ticket; once a fill was paid by a card the site stays on fuel cards', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  // the server: only "card" or "stock" travel (none sent = as the site is); what Mechanical says comes back
  assert.ok(adm.includes("const mode = x.mode === 'card' || x.mode === 'stock' ? x.mode : '';"));
  assert.ok(adm.includes("mode: r.mode === 'card' ? 'card' : 'stock', cardEntries: !!r.cardEntries"), 'placesGet / placesSave answer the mode');
  assert.ok(adm.includes("fuel: r.mode === 'card' ? 'fuel cards – no stock' : 'diesel places – stock'"), 'the Portal\'s audit says it');
  // the page: the choice above the places; on cards the places are hidden and the note says where the cards are made
  const at = html.indexOf('  function placesPanel(site, d) {'), to = html.indexOf("  $('st_rows').addEventListener('click', e => { const b = e.target.closest('.st-places');");
  assert.ok(at > -1 && to > at);
  const box = { innerHTML: '' };
  const S = { data: { sites: [{ code: 'HO', name: 'HEAD OFFICE' }] } };
  const f = new Function('S', '$', 'esc', 'placesHtml', 'document', html.slice(at, html.indexOf("  $('dp_panel').addEventListener('change'", at)) + '; return placesPanel;')(S, () => box, x => String(x), () => '<table></table>', {});
  f('HO', { mode: 'card', cardEntries: true, set: true, places: [] });
  assert.ok(/value="card" checked/.test(box.innerHTML) && /value="stock" disabled/.test(box.innerHTML) && /it stays on fuel cards/.test(box.innerHTML) && /id="dp_box" hidden/.test(box.innerHTML), box.innerHTML);
  f('HO', { mode: 'stock', set: true, places: [] });
  assert.ok(/value="stock" checked>/.test(box.innerHTML) && !/id="dp_box" hidden/.test(box.innerHTML) && /class="note dp-cnote" style="margin:4px 0 0" hidden/.test(box.innerHTML));
  assert.ok(html.includes("places: placesRead($('dp_box')), mode: dpMode() });"), 'the mode is sent with the save');
});

test('(with Mechanical update-189, 29-10-2026) a Mechanical page with a date offers a 4th access "Admin" – Edit, and its entries of an earlier day; the Portal sends it, Mechanical takes it only on such a page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  assert.ok(adm.includes("const PAGE_ACCESS = ['Admin', 'Edit', 'View', 'None'];"), 'the save passes Admin on');
  assert.ok(html.includes("p.dateAdmin ? ['Admin', 'Edit', 'View', 'None'] : ['Edit', 'View', 'None']"), 'only a page Mechanical marks dateAdmin');
  assert.ok(html.includes("const PG_WORD = { Admin: 'Admin',"));
  assert.ok(/<b>Admin<\/b> = Edit \+ entries of an earlier day/.test(html), 'said what it is');
});

test('(29-10-2026, "jithe jithe type krun entry hotat … voice mick … hindi english marathi"; words and numbers) speak into a box: the page has voice.js; a number said in words → the number; the site lets its own pages use the microphone (nothing else)', () => {
  // (the Portal's page has every script inside it: the block between its two markers, run as the unit test's own)
  const html0 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), vs = html0.slice(html0.indexOf('/* RCL ERP – SPEAK INTO A BOX'), html0.indexOf('/* (end of SPEAK INTO A BOX) */'));
  const box = { module: { exports: {} } }; require('vm').runInNewContext(vs, box); const V = box.module.exports;
  const cases = [["12", "12"], ["12.5", "12.5"], ["१२.५", "12.5"], ["1,200", "1200"], ["₹500", "500"], ["twelve", "12"], ["twelve point five", "12.5"], ["zero point five", "0.5"], ["point two five", "0.25"], ["one hundred twenty", "120"], ["two thousand five hundred", "2500"], ["twenty five thousand", "25000"], ["two and a half", "2.5"], ["1 lakh 20 thousand", "120000"], ["a hundred", "100"], ["बारा", "12"], ["बारा पॉइंट पाच", "12.5"], ["बारा लिटर", "12"], ["लिटर बारा", "12"], ["साडे तीन हजार", "3500"], ["साडेतीन", "3.5"], ["साडेतीनशे", "350"], ["दीडशे", "150"], ["दोनशे", "200"], ["सव्वाशे", "125"], ["पावणे दोन", "1.75"], ["दीड हजार", "1500"], ["अडीच लाख", "250000"], ["एक लाख वीस हजार", "120000"], ["पंधरा हजार पाचशे", "15500"], ["एकशेवीस", "120"], ["शंभर", "100"], ["अर्धा", "0.5"], ["चौऱ्याहत्तर", "74"], ["नव्व्याण्णव", "99"], ["पंचाहत्तर बॅग", "75"], ["बारा पंधरा", "12"], ["दो सौ", "200"], ["डेढ़ सौ", "150"], ["ढाई हज़ार", "2500"], ["एक सौ बीस", "120"], ["साढ़े चार", "4.5"], ["सवा दो", "2.25"], ["पौने तीन", "2.75"], ["अड़तीस", "38"], ["पचहत्तर", "75"], ["दो करोड़ पचास लाख", "25000000"], ["निन्यानवे", "99"], ["पाँच", "5"], ["सात सौ पचास रुपये", "750"], ["cement", ""], ["", ""], ["twenty twenty", "20"], ["twenty five", "25"], ["12 kg", "12"], ["12kg", "12"], ["50 bag", "50"], ["three point one four", "3.14"], ["एक हजार दोनशे पन्नास", "1250"], ["दोन हजार", "2000"], ["शून्य", "0"], ["सहाशे", "600"], ["पाचशे पन्नास", "550"]];
  cases.forEach(([said, want]) => assert.strictEqual(V.toNumber(said), want, said));
  assert.strictEqual(V.toNumber('नऊ आठ दोन शून्य एक', 'digits'), '98201', 'a phone number said digit by digit');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(vs.length > 5000 && page.includes('/* (end of SPEAK INTO A BOX) */'), 'the page has it (inside it)');
  const pp = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).headers || []).flatMap(h => h.headers || []).find(h => h.key === 'Permissions-Policy').value;
  assert.strictEqual(pp, 'camera=(), microphone=(self), geolocation=()', 'the microphone for its own pages only; the camera and the place still off');
});

test('(with Mechanical update-193, 29-10-2026 – a requirement printed with no logo, no company, no address) a company and a site\'s company saved here are told to Mechanical – the papers of the modules read them there', async () => {
  const adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const at = adm.indexOf('async function papersTell('), to = adm.indexOf('async function mechAsk(');
  const asked = [], rows = { RACHANA: { id: 'RACHANA', name: 'Rachana Construction Limited', address: 'Plot 5, MIDC', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', logo: null } };
  let answer = { ok: true };
  const db = async (m, p) => { const id = decodeURIComponent((/id=eq\.([^&]+)/.exec(p) || [])[1] || ''); return rows[id] ? [rows[id]] : []; };
  const mechAsk = async (req, me, c) => { asked.push(c); if (answer instanceof Error) throw answer; return answer; };
  const f = new Function('db', 'enc', 'mechAsk', adm.slice(at, to) + '; return { papersTell, papersWarn };')(db, encodeURIComponent, mechAsk);
  // a company alone: the site "PORTAL", no link – with all the company has
  assert.strictEqual(await f.papersTell({}, { email: 'sa@x' }, '', 'RACHANA'), '');
  assert.deepStrictEqual(asked.pop(), { act: 'papers', site: 'PORTAL', link: false, company: { id: 'RACHANA', name: 'Rachana Construction Limited', address: 'Plot 5, MIDC', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', logo: '' } });
  // a site's company: the site, link; a site given no company: company null
  await f.papersTell({}, {}, 'S1', 'RACHANA'); const c1 = asked.pop(); assert.deepStrictEqual([c1.site, c1.link, c1.company.id], ['S1', true, 'RACHANA']);
  await f.papersTell({}, {}, 'T2', ''); assert.deepStrictEqual(asked.pop(), { act: 'papers', site: 'T2', link: true, company: null });
  // not told (Mechanical not reachable, or not updated yet): said – never a failed save
  answer = new Error('Mechanical: The Portal request could not be accepted (not a known request).');
  const w = await f.papersTell({}, {}, 'S1', 'RACHANA'); assert.match(w, /not a known request/);
  assert.match(f.papersWarn(w).warn, /^Saved\. But the papers of the modules .* could not be told \(Mechanical: .*\) – save again in a minute\.$/); assert.deepStrictEqual(f.papersWarn(''), {});
  answer = { ok: false, note: 'The first site has no list of sites yet (step-7 SQL).' }; assert.match(await f.papersTell({}, {}, 'S1', 'RACHANA'), /step-7/);
  // where it is called: the company's save (added, changed), the site's save, a new site once ready – and the page shows the warning
  assert.strictEqual((adm.match(/papersWarn\(await papersTell\(req, me, '', (x\.)?id\)\)/g) || []).length, 2);
  assert.match(adm, /async siteSave\(me, x, req\) \{[\s\S]*?return Object\.assign\(\{ ok: true \}, papersWarn\(await papersTell\(req, me, code, comp\)\)\);/);
  assert.match(adm, /if \(c && r && r\.ready\) await papersTell\(req, me, code, c\.id\);/);
  assert.strictEqual((html.match(/toast\(r && r\.warn \? r\.warn : '(Site|Company) saved\.', !!\(r && r\.warn\)\)/g) || []).length, 2);
});

test('(29-10-2026, "mala te kahi save karayla nko sangu … site option ahe portal madhe tithech site address and contact number name he option de") the Store\'s ticket brings the papers\' heading – the site\'s company and the site\'s own address and contact (step 5)', async () => {
  const go = fs.readFileSync(path.join(__dirname, '..', 'api', 'go.js'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sqlTxt = fs.readFileSync(path.join(__dirname, '..', 'sql', 'portal_step5_site_papers.sql'), 'utf8'), body = sqlTxt.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bdrop\b|\btruncate\b|\bdelete\b|\bupdate\b/i.test(body), 'step 5 only adds');
  ['address', 'contact_name', 'contact_phone'].forEach(c => assert.ok(body.includes('alter table public.sites add column if not exists ' + c + ' text;'), c));
  // the heading: read for the store only, from the site and its company
  const at = go.indexOf('async function paperOf('), to = go.indexOf('module.exports = handler(');
  const rows = { 'sites?select=*&code=eq.S1': [{ code: 'S1', name: 'VTR Site – NH 848', company_id: 'RCL', address: 'Site office, Valshind', contact_name: 'Ramesh Patil', contact_phone: '98765 43210' }],
    'companies?select=id,name,address,gstin,pan,logo&id=eq.RCL': [{ id: 'RCL', name: 'RACHANA CONSTRUCTION LIMITED', address: 'Mittal Chambers, Nariman Point', gstin: '27AAKCR9897B1ZQ', pan: 'AAKCR9897B', logo: null }],
    'sites?select=*&code=eq.T2': [{ code: 'T2', name: 'Test Two', company_id: null }] };
  const paperOf = new Function('db', 'enc', go.slice(at, to) + '; return paperOf;')(async (m, p) => { if (p === 'sites?select=*&code=eq.BAD') throw new Error('x'); return rows[p] || []; }, encodeURIComponent);
  assert.deepStrictEqual(await paperOf('S1'), { site: { code: 'S1', name: 'VTR Site – NH 848', address: 'Site office, Valshind', contact: 'Ramesh Patil', phone: '98765 43210' },
    company: { id: 'RCL', name: 'RACHANA CONSTRUCTION LIMITED', address: 'Mittal Chambers, Nariman Point', gstin: '27AAKCR9897B1ZQ', pan: 'AAKCR9897B', logo: '' } });
  assert.deepStrictEqual(await paperOf('T2'), { site: { code: 'T2', name: 'Test Two', address: '', contact: '', phone: '' }, company: null }, 'no company, before step 5: as it is');
  assert.strictEqual(await paperOf('BAD'), null, 'a read that fails: no heading in the ticket (the Store keeps the one it had)');
  assert.strictEqual(await paperOf('ZZ'), null);
  assert.ok(go.includes("const paper = mod === 'store' ? await paperOf(site) : null;") && go.includes('paper: paper || undefined,'), 'only in the Store\'s ticket');
  // the site's save: the three, cut to size; a number of digits only; before step 5 the site saved and the step named
  assert.ok(adm.includes("const more = ['address', 'contact_name', 'contact_phone'].some(k => k in x) ? { address: clean(x.address, 300), contact_name: clean(x.contact_name, 80), contact_phone: clean(x.contact_phone, 40) } : null;"));
  assert.ok(adm.includes("if (more.address || more.contact_name || more.contact_phone) throw fail(400, STEP5);") && /sql\/portal_step5_site_papers\.sql/.test(adm));
  assert.ok(adm.includes("db('GET', 'sites?select=*&order=sort.asc,code.asc')") && adm.includes("step5: 'address' in s"));
  // the page: under each site, saved with it
  ['class="st-addr"', 'class="st-cname"', 'class="st-cphone"', "address: sub.querySelector('.st-addr').value, contact_name: sub.querySelector('.st-cname').value, contact_phone: sub.querySelector('.st-cphone').value"].forEach(k => assert.ok(html.includes(k), k));
});

test('(29-10-2026, "pratek kamamadhe … verification … approval … head office … super admin swatache portel madhun krel"; "konte jail konte nahi jail te super admin tharau shakel") the Store\'s workflow: who verifies / approves each work (per person), what goes to Head Office (per site, step 6) – told to the Store in its signed ticket', async () => {
  const adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sqlTxt = fs.readFileSync(path.join(__dirname, '..', 'sql', 'portal_step6_rules.sql'), 'utf8'), body = sqlTxt.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bdrop\b|\btruncate\b|\bdelete\b|\bupdate\b/i.test(body) && body.includes('alter table public.sites add column if not exists rules jsonb;'), 'step 6 only adds one column');
  // the people's choices: Yes / None, given to a Store Admin too; the order of the cards
  const at = adm.indexOf('const STORE_PAGES = '), to = adm.indexOf('const STEP6 = ');
  const M = new Function(adm.slice(at, to) + '; return { STORE_PAGES, HO_WORKS, hoOf, storeWf };')();
  const keys = M.STORE_PAGES.map(p => p.key);
  assert.deepStrictEqual(keys, ['dashboard', 'items', 'req', 'grn', 'issue', 'reports', 'po', 'vreq', 'approve', 'purchase', 'vpo', 'poapprove', 'vgrn', 'agrn', 'viss', 'aiss']);
  ['vreq', 'vpo', 'vgrn', 'agrn', 'viss', 'aiss'].forEach(k => { const p = M.STORE_PAGES.find(y => y.key === k); assert.deepStrictEqual([p.opts, p.admin], [['None', 'Yes'], true], k); });
  // Head Office: not set = as before (requirements to HO Purchase, nothing else)
  assert.deepStrictEqual(M.hoOf(null), { req: true, grn: false, iss: false });
  assert.deepStrictEqual(M.hoOf({ store: { ho: { req: false, grn: true, iss: true } } }), { req: false, grn: true, iss: true });
  assert.deepStrictEqual(M.hoOf({ store: { ho: { req: 'no', grn: 'yes' } } }), { req: true, grn: false, iss: false }, 'only true / false count');
  // the workflow told to the Store: each step's people (a switched-off user is nobody)
  const users = [{ email: 'a@x', name: 'Anil', active: true }, { email: 'b@x', name: 'Bina', active: true }, { email: 'c@x', name: 'Chetan', active: false }];
  const acc = [{ email: 'a@x', pages: { vreq: 'Yes', vgrn: 'Yes', aiss: 'Yes' } }, { email: 'b@x', pages: { vpo: 'Yes', agrn: 'Yes', viss: 'None' } }, { email: 'c@x', pages: { vreq: 'Yes' } }];
  assert.deepStrictEqual(M.storeWf(acc, users, { store: { ho: { req: true, grn: true, iss: false } } }), { verify: { req: [{ email: 'a@x', name: 'Anil' }], po: [{ email: 'b@x', name: 'Bina' }], grn: [{ email: 'a@x', name: 'Anil' }], iss: [] },
    approve: { grn: [{ email: 'b@x', name: 'Bina' }], iss: [{ email: 'a@x', name: 'Anil' }] }, ho: { req: true, grn: true, iss: false } });
  // sent in the same signed ticket as who approves; the Store's step 9 missing at a site: said
  assert.ok(adm.includes("act: 'approvers', levels: levels, po: po, wf: wf,") && adm.includes("if (j.step9 === false && needs9) return 'NOTE9';") && adm.includes('sql/store_step9_workflow.sql'));
  assert.strictEqual((adm.match(/warn === 'NOTE9' \? \{ warn: note9\(site\) \}/g) || []).length, 3, 'Store pages, access and the Workflow\'s save');
  // the Workflow's save: Yes / No each, before step 6 the step named, told to the Store
  const rs = adm.slice(adm.indexOf('  async rulesSave(me, x, req) {'), adm.indexOf('  async storePagesSave('));
  assert.ok(rs.includes("if (!('rules' in cur)) throw fail(400, STEP6, 'nostep');") && rs.includes("if (typeof g[k] !== 'boolean') throw fail(400,") && rs.includes('await storeTell(req, me, site)') && rs.includes("await audit(me.email, 'Workflow',"));
  // the page: the Workflow tab, each work's steps, Yes / No, the save; "Yes" written (it showed "undefined")
  ['data-t="wf"', 'id="t_wf"', "action: 'rulesSave', site: S.wfSite, ho: ho", 'class="wf-ho"', "Yes: 'Yes'", "else if (t === 'wf') workflow();"].forEach(k => assert.ok(html.includes(k), k));
});

test('(with Mechanical update-195) Sites → Purchase backup: its own button and panel; the ticket asks Mechanical for target "purchase" (kept at the first site); the record says Purchase', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  assert.match(html, /id="st_pbk"[^>]*>Portal backup<\/button><button class="sa-btn" id="st_purbk" type="button"[^>]*>Purchase backup<\/button>/);
  assert.match(html, /\$\('st_purbk'\)\.addEventListener\('click', \(\) => bkOpen\(\{ target: 'purchase' \}\)\);/);
  assert.match(html, /who\.target === 'purchase' \? 'Purchase backup' :/);
  assert.match(adm, /if \(x\.target === 'purchase'\) return \{ target: 'purchase', site: 'PORTAL' \};/);
  assert.match(adm, /t\.target === 'portal' \? 'Portal' : t\.target === 'purchase' \? 'Purchase' : t\.site/);
  // any other target is a site of the list (nothing else reaches Mechanical)
  assert.match(adm, /const site = String\(x\.site \|\| ''\)\.toUpperCase\(\);\n  if \(!\/\^\[A-Z0-9\]\{1,12\}\$\/\.test\(site\) \|\| !await siteOk\(site\)\) throw fail\(400, 'Pick a site\.'\);\n  return \{ target: '', site: site \};/);
});
