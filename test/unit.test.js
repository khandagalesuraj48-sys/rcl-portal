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

test('(with Mechanical update-203) Sites → Day & tank check: the hour the site\'s day starts and the tank check every N days before diesel – sent to Mechanical inside the signed ticket, the Super Admin only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
  assert.match(adm, /async siteRulesGet\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, \{ act: 'siteRules', site: site \}\)/);
  assert.match(adm, /async siteRulesSave\(me, x, req\) \{[\s\S]*?throw fail\(400, 'Day starts at: type the hour as HH:MM \(for example 06:00\)\.'\);[\s\S]*?mechAsk\(req, me, \{ act: 'siteRulesSave', site: site, dayStart: dayStart, tank: tank \}\);[\s\S]*?await audit\(me\.email, 'Day & tank check', site,/);
  assert.match(adm, /const s = await ses\.need\(req, \{ super: true, ownPassword: true \}\);/, 'every admin action: the Super Admin');
  ['id="sr_panel"', 'class="link st-rules"', "action: 'siteRulesGet', site: site", "Object.assign({ action: 'siteRulesSave', site: site }, srRead())", 'id="sr_day"', "['Own', 'Rental', 'Hired']", 'class="link del sr-del"', 'id="sr_add"']
    .forEach(w => assert.ok(html.includes(w), w));
  // the page's rows, run on their own
  const at = html.indexOf('  const srOpt = '), to = html.indexOf('  function srPanel(site, d) {');
  const f = new Function('esc', html.slice(at, to) + '; return { srRow };')(s => String(s));
  const row = f.srRow([{ no: 'MH-1', type: 'Tipper', ownership: 'Rental', not: '' }, { no: 'MH-2', type: 'JCB', ownership: 'Own', not: 'no Tank Capacity' }], { no: 'MH-1', on: false, days: 3 });
  assert.ok(/<option value="MH-1" selected>MH-1 · Tipper · Rental<\/option>/.test(row) && /MH-2 · JCB · Own – no Tank Capacity/.test(row) && /<option value="0" selected>Not<\/option>/.test(row) && /value="3"/.test(row), row);
});

test('(with Mechanical update-208) Head Office\'s Mechanical opens at its own address <Mechanical>/ho/ – every other module and site as before', () => {
  const go = fs.readFileSync(path.join(__dirname, '..', 'api', 'go.js'), 'utf8');
  assert.match(go, /const HO_SITE = 'HO';/);
  assert.match(go, /redirect\(res, String\(it\.url\)\.replace\(\/\\\/\+\$\/, ''\) \+ \(mod === 'mechanical' && site === HO_SITE \? '\/ho\/' : '\/'\) \+ '#sso=' \+ ticket \+ \(page \? '&page=' \+ enc\(page\) : ''\)\);/);
  // the address as built, for each case (a module's address may end with "/")
  const at = (url, mod, site) => String(url).replace(/\/+$/, '') + (mod === 'mechanical' && site === 'HO' ? '/ho/' : '/') + '#sso=T';
  assert.deepStrictEqual([at('https://x.vercel.app', 'mechanical', 'HO'), at('https://x.vercel.app/', 'mechanical', 'VTR'), at('https://x.vercel.app/store', 'store', 'HO')],
    ['https://x.vercel.app/ho/#sso=T', 'https://x.vercel.app/#sso=T', 'https://x.vercel.app/store/#sso=T']);
  // the ticket's answer (json=1, a module inside another) and the person's list (the app, the dashboard) are not changed
  assert.match(go, /if \(asJson\) return send\(res, 200, \{ ticket: ticket \}\);/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'api', 'auth.js'), 'utf8'), /\/ho\//);
});

test('(with Mechanical update-212) Sites → Vehicle photos of a site on fuel cards (HO): the Super Admin only; the photo made smaller on the page, seen first; its two files sent BESIDE the signed ticket, which names them by their SHA-256; a bigger body only for this route, after the sign-in is checked', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8'), http = fs.readFileSync(path.join(__dirname, '..', 'lib', 'http.js'), 'utf8');
  assert.match(adm, /async carPhotos\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, Object\.assign\(\{ act: 'carPhotos', site: site \}, x\.fresh === true \? \{ fresh: true \} : \{\}\)\)/);
  assert.match(adm, /async carPhotoSet\(me, x, req\) \{[\s\S]*?const r = await mechAsk\(req, me, \{ act: 'carPhotoSet', site: site, no: no, was: was, sha: \{ full: full\.sha, thumb: thumb\.sha \} \}, \{ full: full\.url, thumb: thumb\.url \}\);[\s\S]*?await audit\(me\.email, 'Vehicle photo'/);
  assert.match(adm, /async carPhotoRemove\(me, x, req\) \{[\s\S]*?mechAsk\(req, me, \{ act: 'carPhotoRemove', site: site, no: no, was:/);
  assert.match(adm, /body: JSON\.stringify\(\{ fn: 'portalAdmin', args: files \? \[t, files\] : \[t\] \}\)/, 'the files beside the ticket (the ticket stays small – Mechanical takes at most 8,000 letters)');
  assert.match(adm, /const s = await ses\.need\(req, \{ super: true, ownPassword: true \}\);\n\s+const x = await readBody\(req, 4500000\)/, 'the Super Admin\'s sign-in is checked BEFORE the bigger body is read');
  assert.match(http, /function readBody\(req, max\) \{\n\s+const lim = Number\(max\) > 0 \? Number\(max\) : 200000;/, 'every other route: 200 KB as before');
  // the fingerprints: what Mechanical computes from the bytes it gets
  const at = adm.indexOf('    const img = (v, max) =>'), to = adm.indexOf('    const full = img(x.full');
  const fail = (c, m) => Object.assign(new Error(m), { status: c });
  const img = new Function('fail', 'crypto', 'Buffer', adm.slice(at, to) + '; return img;')(fail, crypto, Buffer);
  const b = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.from('car')]);
  assert.deepStrictEqual(img('data:image/jpeg;base64,' + b.toString('base64'), 1000), { url: 'data:image/jpeg;base64,' + b.toString('base64'), sha: crypto.createHash('sha256').update(b).digest('hex') });
  assert.throws(() => img('data:image/png;base64,AAAA', 1000), /must be a picture/);
  assert.throws(() => img('data:image/jpeg;base64,' + Buffer.alloc(2000).toString('base64'), 1000), /too big/);
  // the page: the link in a site's row, its panel closes with the others, made smaller here, seen first, Remove asks first
  ['id="vp_panel"', 'class="link st-photos"', "action: 'carPhotos', site: site", "action: 'carPhotoSet', site: site, no: m.no, was: m.was, full: await vpData(m.full.blob), thumb: await vpData(m.thumb.blob)",
    "action: 'carPhotoRemove', site: VP.site, no: c.no", 'accept="image/jpeg,image/png,image/webp"', 'vpJpeg(im, 1600, 0.82, 1536 * 1024)', 'vpJpeg(im, 480, 0.78, 380 * 1024)', 'Nothing is saved until you press Save photo.',
    "window.confirm('Remove the photo of '", 'c.photo.exp - Date.now() < 90000', "im.dataset.tried = '1'; vpRefresh(true);", 'p.exp = Date.now() + p.left'].forEach(w => assert.ok(html.includes(w), w));
  assert.strictEqual((html.match(/\$\('vp_panel'\)\.hidden = true;/g) || []).length, 6, 'every other panel of Sites closes it (New site, Diesel places, Day & tank check, Backup, Storage) and its own Close');
});

test('(10-11-2026, his animation brief) motion – a console page zooms in, the sign-in card and a photo box pop in (from 72 %), a "⋯" menu drops in, buttons are pressed in, the message slides in kept centred; transform / opacity only; off with reduced motion', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = html.slice(html.indexOf('(motion – his brief of 10-11-2026'), html.indexOf('</style>', html.indexOf('(motion – his brief of 10-11-2026')));
  assert.ok(css.length > 800 && html.indexOf('(motion – his brief of 10-11-2026') < html.indexOf('</style>'));
  assert.match(css, /\.sa-page:not\(\[hidden\]\) \{ animation: moZoomIn \.22s/);
  assert.match(css, /\.vph-back \.vph-box \{ animation: moPop \.26s/);
  assert.match(css, /\.sa-pop:not\(\[hidden\]\) \{ animation: moDrop \.18s/);
  assert.match(css, /@keyframes moToast \{ from \{ opacity: 0; transform: translate\(-50%, 10px\); \} to \{ opacity: 1; transform: translate\(-50%, 0\); \} \}/);
  [...css.matchAll(/@keyframes (\w+) \{([^@]*?)\} \}/g)].forEach(k => assert.doesNotMatch(k[2], /\b(width|height|top|left|margin|padding)\s*:/, k[1] + ': transform / opacity only'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.sa-page, section\.center > \*, \.vph-back, \.vph-box, \.sa-pop, #toast \{ animation: none !important; \}/);
});

test('(11-11-2026, his pick "orbit 1 number mast aahe … screen white aswi" + the character) the sign-in look – web only: the orbit, the card, the character (look only)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /cdn\.21st\.dev/, 'no picture from another site any more');
  assert.match(html, /for \(const sec of document\.querySelectorAll\('section\.center'\)\) sec\.insertAdjacentHTML\('afterbegin', ORBIT\);/, 'the orbit on every sign-in page');
  for (const f of ['tractor', 'package', 'inbox_tray', 'building_construction', 'receipt', 'bar_chart', 'fuel_pump', 'notebook', 'company-logo']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'login', f + '.png')), f + '.png is in the repository');
  }
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'login', 'LICENSE-fluentui-emoji.txt')), 'the pictures\' licence');
  // sign-in works as before: the same form, boxes, button and helps
  const login = html.slice(html.indexOf('<section id="v_login"'), html.indexOf('</section>', html.indexOf('<section id="v_login"')));
  for (const id of ['f_login', 'l_msg', 'l_email', 'l_pass', 'l_eye', 'l_err', 'l_btn', 'l_rec', 'l_setup', 'l_setup_btn']) assert.match(login, new RegExp('id="' + id + '"'), id);
  assert.match(login, /<input id="l_email" type="text" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="Email or mobile number" autocomplete="username" required>/);      // (step 12) his e-mail or his mobile number
  assert.match(login, /<input id="l_pass" type="password" placeholder="Password" autocomplete="current-password" required>/);
  assert.match(login, /<label class="sr" for="l_email">Email or mobile number<\/label>/, 'the boxes keep their names for a screen reader');
  assert.match(html, /await api\('\/api\/auth', \{ action: 'login', email: \$\('l_email'\)\.value\.trim\(\), password: \$\('l_pass'\)\.value \}\)/, 'the sign-in call unchanged');
  // the character: not in the way, not read aloud, told only a count of letters and whether the password is shown
  assert.match(login, /<div class="masc" id="l_masc" data-mood="idle" aria-hidden="true">/);
  assert.match(html, /\.masc \{[^}]*pointer-events: none;/);
  const fn = html.slice(html.indexOf('const mascMood = () => {'), html.indexOf("$('l_eye').addEventListener('click', () => { const show"));
  assert.match(fn, /\$\('l_pass'\)\.type === 'text' \? 'peek' : 'cover'/);
  assert.doesNotMatch(fn, /l_pass'\)\.value/, 'it never reads the password');
  assert.match(fn, /\$\('l_email'\)\.value\.length/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ \.orbit \.ring, \.orbit \.ic span \{ animation: none !important; \} \.masc \.pu, \.masc \.hand \{ transition: none; \} \}/);
  // (a phone: the orbit on top since the same day – the next test)
});

test('(11-11-2026) after sign-in straight into the ERP under the loading look; the sign-in page on a phone – the orbit on top, the character above the keyboard', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<div id="go_boot" hidden role="status">/);
  assert.match(html, /const goOut = url => \{ \$\('go_boot'\)\.hidden = false; location\.replace\(url\); \};/);
  assert.match(html, /if \(e\.persisted\) \{ \$\('go_boot'\)\.hidden = true; start\(\); \}/, 'Back from the browser\'s memory: not left under the look');
  assert.doesNotMatch(html, /location\.replace\(goLink\(/, 'every way into a module goes through goOut');
  // several modules, no "My start": the last one opened here, else Machinery, else the first – never for the Super Admin, a message or ?menu=1
  const hv = html.slice(html.indexOf('function homeView() {'), html.indexOf("const bySite = {};"));
  assert.match(hv, /if \(items\.length > 1 && !params\.has\('menu'\) && !m && !me\.user\.super\) \{/);
  assert.match(hv, /const it = items\.find\(i => i\.module \+ '\|' \+ i\.site === last\) \|\| items\.find\(i => i\.module === 'mechanical'\) \|\| items\[0\];/);
  assert.match(html, /if \(me\.user\.super && !params\.has\('menu'\)\) return saView\(\);/, 'the Super Admin\'s console as before');
  assert.match(html, /localStorage\.setItem\('rcl_portal_last', t\.dataset\.go\)/);
  // a phone
  const ph = html.slice(html.indexOf('/* A PHONE (asked 11-11-2026'), html.indexOf('.brand { display: flex;'));
  assert.match(ph, /\.center \{ flex-direction: column;/);
  assert.match(ph, /\.orbit \{ flex: 0 0 auto; min-height: 0; height: 256px; width: 100%; overflow: hidden; \}/, 'the orbit is shown on a phone');
  assert.doesNotMatch(ph, /\.orbit \{ display: none; \}\s*\.card/, 'not hidden as before');
  assert.match(ph, /\.center\.typing \.orbit \{ display: none; \}/);
  assert.match(ph, /\.card\.si input \{ font-size: 16px; \}/, 'an iPhone does not enlarge the page');
  assert.match(html, /const on = at && byHand && matchMedia\('\(max-width: 860px\)'\)\.matches/, 'folds only when he himself typed – not on the page\'s own first focus');
});

/* ---------------- the Advertise Corner (11-11-2026, step 8) – its rules ---------------- */
test('ads: a post as the Super Admin gives it – cleaned; a wrong one refused with the words for him', () => {
  const A = require('../lib/ads');
  const ok = { title: '  शुभ   दीपावली ', kind: 'festival', size: 'strip', path: '2026/0123456789abcdef01234567.mp4', poster: '2026/0123456789abcdef01234568.jpg', onApp: true, onWeb: true,
    from: '2026-11-11', to: '2026-11-14', days: '7135', timeFrom: '06:00', timeTo: '23:00', seconds: 12, sites: ['VTR', 'VTR', ' '], company: '' };
  const r = A.clean(ok);
  assert.deepStrictEqual([r.title, r.media, r.days, r.sites, r.active, r.on_app, r.on_web, r.seconds], ['शुभ दीपावली', 'video', '1357', ['VTR'], true, true, true, 12]);
  const bad = (ch, re) => assert.throws(() => A.clean(Object.assign({}, ok, ch)), e => re.test(e.message), JSON.stringify(ch));
  bad({ title: ' ' }, /name/); bad({ kind: 'x' }, /kind/); bad({ path: '../secret.mp4' }, /image or the video/); bad({ path: 'https://x/y.mp4' }, /image or the video/);
  bad({ poster: '2026/0123456789abcdef01234568.mp4' }, /still picture/); bad({ onApp: false, onWeb: false }, /where it shows/); bad({ from: '2026-02-30' }, /period/);
  bad({ to: '2026-11-10' }, /ends before/); bad({ days: '089' }, /day of the week/); bad({ timeFrom: '6am' }, /hours/); bad({ timeTo: '05:00' }, /hours end/); bad({ seconds: 2 }, /3 to 60/); bad({ seconds: 600 }, /3 to 60/);
  assert.strictEqual(A.clean(Object.assign({}, ok, { active: false })).active, false, 'Inactive is kept – a post is never deleted');
});

test('ads: shows only in its period, on its days, in its hours (India\'s clock), on its place, site and company', () => {
  const A = require('../lib/ads');
  // 11-11-2026 is a Wednesday (3); 16:30 UTC = 22:00 in India; 18:45 UTC = 00:15 of the NEXT day in India
  assert.deepStrictEqual(A.india(Date.UTC(2026, 10, 11, 16, 30)), { date: '2026-11-11', time: '22:00', day: 3 });
  assert.deepStrictEqual(A.india(Date.UTC(2026, 10, 14, 18, 45)), { date: '2026-11-15', time: '00:15', day: 7 });
  const r = { active: true, on_app: true, on_web: false, date_from: '2026-11-11', date_to: '2026-11-14', days: '123456', time_from: '06:00:00', time_to: '23:00:00', sites: ['VTR'], company: 'RCL' };
  const at = { date: '2026-11-11', time: '22:00', day: 3 }, w = { platform: 'app', site: 'VTR', company: 'RCL' };
  assert.strictEqual(A.live(r, w, at), true);
  assert.strictEqual(A.live(r, Object.assign({}, w, { platform: 'web' }), at), false, 'not on the web');
  assert.strictEqual(A.live(r, w, Object.assign({}, at, { date: '2026-11-10' })), false, 'before its period');
  assert.strictEqual(A.live(r, w, Object.assign({}, at, { date: '2026-11-15' })), false, 'after its period');
  assert.strictEqual(A.live(r, w, Object.assign({}, at, { day: 7 })), false, 'not on a Sunday');
  assert.strictEqual(A.live(r, w, Object.assign({}, at, { time: '05:59' })), false, 'before its hours');
  assert.strictEqual(A.live(r, w, Object.assign({}, at, { time: '23:01' })), false, 'after its hours');
  assert.strictEqual(A.live(r, Object.assign({}, w, { site: '18B' }), at), false, 'another site');
  assert.strictEqual(A.live(r, Object.assign({}, w, { company: 'SKL' }), at), false, 'another company');
  assert.strictEqual(A.live(Object.assign({}, r, { sites: [], company: '' }), { platform: 'app', site: '18B', company: 'SKL' }, at), true, 'no site, no company given = everybody');
  assert.strictEqual(A.live(Object.assign({}, r, { active: false }), w, at), false, 'Inactive');
});

test('ads: the endpoint – "live" for a person signed in with access to the site only; everything else for the Super Admin only; no delete', () => {
  const src = fs.readFileSync(path.join(__dirname, '../api/ads.js'), 'utf8'), sql = fs.readFileSync(path.join(__dirname, '../sql/portal_step8_ads.sql'), 'utf8');
  assert.ok(src.indexOf("action === 'live'") < src.indexOf('ses.need(req, { super: true })') && src.indexOf('ses.need(req, { super: true })') < src.indexOf("action === 'list'"), 'list / uploadUrl / save / order come after the Super Admin check');
  assert.match(src, /access\?select=site&email=eq\./, 'live: his access line on that site is asked');
  assert.ok(!/db\('DELETE'/.test(src), 'no post is deleted');
  assert.match(sql, /values \('ads', 'ads', false,/, 'the bucket is private');
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on public\.ads from public, anon, authenticated/);
  assert.ok(!/grant[^;]*delete[^;]*public\.ads/i.test(sql), 'the server has no right to delete a post');
});

test('ads: the console has the Advertise page – several files at once, each kept Inactive first; the page may reach the file store', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), v = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
  assert.match(page, /data-t="ads"/); assert.match(page, /<section id="t_ads" class="sa-page" hidden>/);
  assert.match(page, /id="ad_files" type="file"[^>]*multiple/);
  assert.match(page, /action: 'save', title: f\.name[^\n]*active: false/, 'a new file is kept Inactive until he sets it');
  assert.match(page, /'versions', 'ads', 'audit'/, 'the page is one of the console\'s pages');
  assert.match(v, /media-src 'self' https: blob:; connect-src 'self' https:\/\/\*\.supabase\.co;/);
});

test('ads (step 9): one size – the strip; "Fit to strip" keeps how a post sits in it for the web and for the app (the file is not changed)', () => {
  const A = require('../lib/ads');
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), api = fs.readFileSync(path.join(__dirname, '../api/ads.js'), 'utf8'), sql = fs.readFileSync(path.join(__dirname, '../sql/portal_step9_ads_fit.sql'), 'utf8');
  assert.deepStrictEqual(A.RATIO, { web: 12.8, app: 3.42 });
  assert.deepStrictEqual(A.fitOf(null), { web: { x: 50, y: 50, z: 1 }, app: { x: 50, y: 50, z: 1, r: 3.42 } }, 'not fitted = from its middle, the strip, as before');
  assert.deepStrictEqual(A.fitOf({ web: { x: 12.345, y: 101, z: 9 }, app: { x: '80', y: 0, z: 2.5 }, more: 1 }), { web: { x: 12.35, y: 50, z: 1 }, app: { x: 80, y: 0, z: 2.5, r: 3.42 } }, 'a wrong value becomes the middle / no zoom');
  // (the app only) a post made higher there: its shape, from the strip (3.42) to an upright video (0.56); the web has none
  assert.deepStrictEqual(A.fitOf({ web: { r: 1 }, app: { r: 0.8 } }), { web: { x: 50, y: 50, z: 1 }, app: { x: 50, y: 50, z: 1, r: 0.8 } });
  assert.strictEqual(A.fitOf({ app: { r: 0.2 } }).app.r, 3.42, 'higher than an upright video: the strip'); assert.strictEqual(A.fitOf({ app: { r: 9 } }).app.r, 3.42);
  assert.strictEqual(A.fitPlain({ app: { r: 1 } }), false, 'a higher post needs step 9 as a fitted one does');
  assert.strictEqual(A.fitPlain({}), true); assert.strictEqual(A.fitPlain({ app: { x: 51 } }), false);
  const ok = { title: 'a', kind: 'festival', size: 'card', path: '2026/0123456789abcdef01234567.mp4', onApp: true, onWeb: true, from: '2026-11-11', to: '2026-11-14', days: '1', timeFrom: '06:00', timeTo: '23:00', seconds: 12, fit: { web: { x: 30, y: 70, z: 1.5 } } };
  const r = A.clean(ok);
  assert.strictEqual(r.size, 'strip', 'whatever is sent: a strip'); assert.deepStrictEqual(r.fit, { web: { x: 30, y: 70, z: 1.5 }, app: { x: 50, y: 50, z: 1, r: 3.42 } });
  assert.match(page, /id="adf_h"/, 'the height slider is in the app\'s part'); assert.match(page, /delete F\.web\.r;/, 'never for the web');
  assert.match(api, /size: 'strip', seconds: r\.seconds,[^\n]*fit: A\.fitOf\(r\.fit\), ratio: A\.RATIO/, 'every post goes out as a strip with its fit and the strip\'s shape');
  assert.match(api, /if \(!A\.fitPlain\(row\.fit\)\) throw fail\(409, STEP9, 'step9'\);/, 'before step 9 a fitted post says what to run; a plain one is kept as before');
  assert.match(sql, /alter table public\.ads add column if not exists fit jsonb;/);
  assert.match(page, /id="ad_fit"/); assert.doesNotMatch(page, /id="ad_size"|adCrop|AD_DIM/, 'no other size, no cutting of files');
  assert.match(page, /const adFitCss = f => 'object-fit:cover;object-position:' \+ f\.x \+ '% ' \+ f\.y \+ '%;transform:scale\(' \+ f\.z \+ '\);transform-origin:' \+ f\.x \+ '% ' \+ f\.y \+ '%';/);
  assert.match(page, /size: 'strip', fit: AD\.f\.fit \|\| p\.fit \|\| null,/);
});

test('ads: a video is tried in the browser before it is added – one that cannot play is refused with what to make instead; a post whose video does not play says so', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(page, /if \(\/\^video\\\/\/\.test\(f\.type\) && !\(await adPlays\(f\)\)\) \{ toast\(AD_NOPLAY/);
  assert.match(page, /const AD_NOPLAY = '[^']*MP4 with H\.264 video[^']*'/);
  assert.match(page, /v\.addEventListener\('error', \(\) => end\(false\), \{ once: true \}\);/);
  assert.match(page, /pv\.addEventListener\('error', bad, \{ once: true \}\)/);
});

test('company first (12-11-2026): under the one address a device that has not chosen its company goes to /company; the sign-in has "Change company"; never on the Portal\'s own address', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const src = page.slice(page.indexOf("const CO_KEY = 'ocs_company'"), page.indexOf('async function loginView()'));
  const run = (pathname, hash, stored, noStore) => {
    const out = { to: '', kept: stored, hist: 0 };
    const location = { pathname, hash, search: '', replace: u => { out.to = u; } };
    const localStorage = { getItem: () => { if (noStore) throw new Error('x'); return out.kept; }, setItem: (k, v) => { if (noStore) throw new Error('x'); out.kept = v; } };
    const history = { replaceState: () => { out.hist++; } };
    out.gate = new Function('location', 'localStorage', 'history', src + '; return coGate();')(location, localStorage, history);
    return out;
  };
  let r = run('/portal/', '', null); assert.strictEqual(r.gate, true); assert.strictEqual(r.to, '/company');
  r = run('/portal/', '', 'RCL'); assert.strictEqual(r.gate, false); assert.strictEqual(r.to, '');
  r = run('/portal/', '#co=rcl', null); assert.strictEqual(r.gate, false); assert.strictEqual(r.kept, 'RCL'); assert.strictEqual(r.hist, 1, 'the code leaves the address bar');
  r = run('/portal/', '#signin', null); assert.strictEqual(r.gate, false, 'the way in without the first page');
  r = run('/portal/', '', null, true); assert.strictEqual(r.gate, false, 'no storage: the sign-in as before, never a loop');
  r = run('/portal/', '#co=<script>', null); assert.strictEqual(r.gate, true, 'only letters and digits are a code');
  r = run('/', '', null); assert.strictEqual(r.gate, false, 'the Portal\'s own address and the rig: as before');
  assert.match(page, /async function loginView\(\) \{\n    if \(coGate\(\)\) return;\n    show\('v_login'\);/);
  assert.match(page, /<a class="link forgot" id="l_co" href="\/company\?change" style="[^"]*" hidden>Change company<\/a>/);
});

test('an employee\'s sign-in from HR (api/hrlogin.js): who may, the limit, the one-time password', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'hrlogin.js'), 'utf8'), { oneTime } = require('../api/hrlogin');
  assert.match(src, /sameSite\(req\);\n  const me = \(await ses\.need\(req, \{ ownPassword: true \}\)\)\.user/, 'the Portal page\'s own request, a person with his own password');
  assert.match(src, /if \(!me\.is_super && !\(\(await db\('GET', 'access\?select=role&email=eq\.' \+ enc\(me\.email\) \+ '&site=eq\.' \+ enc\(site\) \+ '&module=eq\.' \+ HR \+ '&role=eq\.admin'\)\)/, 'the Super Admin or the HR ADMIN of that site – not an HR User');
  assert.match(src, /const other = \(\(await db\('GET', 'access\?select=module&email=eq\.' \+ enc\(cur\.email\) \+ '&module=neq\.' \+ SELF \+ '&limit=1'\)\) \|\| \[\]\)\.length > 0;\n    if \(cur\.is_super \|\| other\) throw fail\(403/, 'never a person with other work, never the Super Admin');
  assert.match(src, /if \(!cur\.active\) throw fail\(403/); assert.match(src, /hash = temp \? 'tmp\$' \+ await pw\.make\(temp\) : ''/); assert.match(src, /if \(hash\) await ses\.endAll\(id\);/);
  assert.match(src, /\{ email: id, site: site, module: SELF, role: 'user', granted_by: me\.email \}/, 'only "My HR", as a user');
  assert.ok(!/audit\([^\n]*temp/.test(src), 'the password is never written in the activity record');
  const seen = new Set(); for (let i = 0; i < 200; i++) { const t = oneTime(); assert.match(t, /^[a-zA-Z2-9]{10}$/); assert.ok(/[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t) && !/[0O1lI]/.test(t), t); seen.add(t); }
  assert.strictEqual(seen.size, 200);
  // (13-11-2026, step 12) the first password by the name; a mobile number as typed; many at once never makes a password anew
  const { firstPass } = require('../api/hrlogin'), W = require('../lib/who');
  assert.deepStrictEqual(['Ramesh Suresh Patil', 'SUNITA devi', 'A. Kumar', ''].map(firstPass), ['Ramesh@1234', 'Sunita@1234', '', '']);
  assert.deepStrictEqual(['+91 98765 43210', '09876543210', '12345', 'a@b.co'].map(W.mobile), ['9876543210', '9876543210', '', '']);
  assert.ok(W.noMail(W.mobileId('9876543210')) && W.MOBILE_ID.test('9876543210@mobile.invalid') && !W.noMail('a@b.co'));
  assert.match(src, /const fresh = !cur \|\| \(!many && !!cur\), temp = !fresh \? '' : cur \? oneTime\(\) : firstPass\(name\) \|\| oneTime\(\)/, 'new: the first password; asked again: one by chance; many at once: none for a person who has a sign-in');
  assert.match(src, /if \(!x\.rows\.length \|\| x\.rows\.length > 25\) throw fail\(400/);
  const auth = fs.readFileSync(path.join(__dirname, '..', 'api', 'auth.js'), 'utf8');
  assert.match(auth, /const mob = W\.mobile\(x\.email\), email = mob \|\| lc\(x\.email\)\.slice\(0, 120\)/); assert.match(auth, /u = mob \? await W\.byMobile\(mob, cols\) : await W\.who\(email, cols\)/);
  const sql12 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'portal_step12_mobile.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(!/\b(drop|delete|truncate|update)\b/i.test(sql12), 'step 12 only adds'); assert.match(sql12, /add column if not exists mobile text/); assert.match(sql12, /create unique index if not exists users_mobile on public\.users \(mobile\) where mobile is not null/);
});

test('HR once a site: "My HR" is left out of a person\'s list where he has the HR office\'s module', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'auth.js'), 'utf8');
  assert.match(src, /return items\.filter\(x => !\(x\.module === 'hrme' && items\.some\(y => y\.site === x\.site && y\.module === 'hr'\)\)\);/);
});

// (12-11-2026) sign-in with a code by e-mail: the switches, the code, its hash, the letter
test('e-mail code: the switches are ON only when said so; a code is 6 digits; kept only as a keyed hash; the letter never names the key', () => {
  const otp = require('../lib/otp'), mail = require('../lib/mail'), keep = Object.assign({}, process.env);
  try {
    for (const v of ['false', 'off', '0', 'no', '', ' ', 'False']) { process.env.OTP_LOGIN = v; assert.strictEqual(otp.on('OTP_LOGIN'), false, 'off for "' + v + '"'); }
    delete process.env.OTP_LOGIN; assert.strictEqual(otp.on('OTP_LOGIN'), false, 'not set: off');
    for (const v of ['true', 'on', '1', 'yes', ' TRUE ']) { process.env.OTP_LOGIN = v; assert.strictEqual(otp.on('OTP_LOGIN'), true, 'on for "' + v + '"'); }
    for (let i = 0; i < 300; i++) assert.match(otp.make(), /^\d{6}$/);
    process.env.PORTAL_SECRET = 'unit-secret-0123456789abcdefghijklmnopqrstuv';
    const h = otp.hash('a@x.test', 'login', '123456'); assert.match(h, /^[0-9a-f]{64}$/); assert.ok(!h.includes('123456'));
    assert.notStrictEqual(h, otp.hash('b@x.test', 'login', '123456'), 'another person: another hash'); assert.notStrictEqual(h, otp.hash('a@x.test', 'verify', '123456'), 'a verify code is not a sign-in code');
    process.env.PORTAL_SECRET = 'another-secret-0123456789abcdefghijklmnopqrs'; assert.notStrictEqual(h, otp.hash('a@x.test', 'login', '123456'), 'not to be worked out without the server\'s secret');
    process.env.PORTAL_SECRET = 'short'; assert.throws(() => otp.hash('a@x.test', 'login', '123456'), /PORTAL_SECRET/);
    assert.deepStrictEqual([otp.MINUTES, otp.COOL_S, otp.TRIES], [10, 60, 5]);
    delete process.env.RESEND_API_KEY; delete process.env.OTP_FROM; assert.match(String(mail.missing()), /RESEND_API_KEY/);
    process.env.RESEND_API_KEY = 're_unit_made_up'; process.env.OTP_FROM = 'no-reply@unit.test'; assert.ok(!mail.missing());
    const l = mail.letter('654321', 'login', 10), all = JSON.stringify(l); assert.ok(all.includes('654321') && /10 minutes/.test(l.text)); assert.ok(!all.includes('re_unit_made_up'), 'the key is never in a letter');
  } finally { for (const k of ['OTP_LOGIN', 'PORTAL_SECRET', 'RESEND_API_KEY', 'OTP_FROM']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
});
