/* POST /api/app – the mobile app's newest version, on the local rig (never live): the Portal :3010 with its app store played by
 * the rig's Storage stand-in (:3100, bucket "app-releases" in the rig database).   node test/app.test.js */
'use strict';
const crypto = require('crypto'), { execSync } = require('child_process');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3100', KEY = 'sb_secret_rigkey', PW = 'Nashik#Road848!';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const put = (p, body, type) => fetch(ST + '/storage/v1/object/app-releases/' + p, { method: 'POST', headers: { apikey: KEY, 'Content-Type': type, 'x-upsert': 'true' }, body });
(async () => {
  sql('rcl', "insert into storage.buckets (id, name, public) values ('app-releases', 'app-releases', false) on conflict (id) do nothing;");
  execSync('rm -rf /home/claude/rig/storage/app-releases');
  let cookie = '';
  const app = async (body, opt) => { opt = opt || {}; const h = { 'Content-Type': 'application/json' }; if (!opt.noHeader) h['X-RCL'] = '1'; if (cookie && !opt.noCookie) h.Cookie = cookie;
    const r = await fetch(P + '/api/app', { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  let r = await app({ action: 'latest', platform: 'android' });
  ok('not signed in: refused ("signin")', r.status === 401 && r.j.code === 'signin', r);
  const lg = await fetch(P + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: 'sujit@rcl.test', password: PW }) });
  cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
  r = await app({ action: 'latest', platform: 'android' }, { noHeader: true });
  ok('without the page\'s header: refused', r.status === 403, r);
  r = await app({ action: 'latest', platform: 'android' });
  ok('signed in, nothing in the store yet: { none: true }', r.status === 200 && r.j.none === true, r);
  const apk = crypto.randomBytes(4096), sha = crypto.createHash('sha256').update(apk).digest('hex');
  await put('android/rcl-erp-1.0.1-2.apk', apk, 'application/vnd.android.package-archive');
  await put('android/latest.json', JSON.stringify({ build: 2, version: '1.0.1', file: 'android/rcl-erp-1.0.1-2.apk', sha256: sha, notes: 'Faster lists.' }), 'application/json');
  r = await app({ action: 'latest', platform: 'android' });
  ok('a version there: build, version, notes, fingerprint and a link', r.j.build === 2 && r.j.version === '1.0.1' && r.j.notes === 'Faster lists.' && r.j.sha256 === sha && /^http:\/\/127\.0\.0\.1:3100\/storage\/v1\/object\/sign\/app-releases\/android\/rcl-erp-1\.0\.1-2\.apk\?token=/.test(r.j.url || ''), r.j);
  const dl = Buffer.from(await (await fetch(r.j.url)).arrayBuffer());
  ok('   the link gives the very file (same fingerprint)', crypto.createHash('sha256').update(dl).digest('hex') === sha);
  ok('   the store\'s key is not in the answer', !JSON.stringify(r.j).includes(KEY));
  for (const [bad, why] of [[{ build: 3, version: '1.0.2', file: '../secret.apk', sha256: sha }, 'a file outside android/'], [{ build: 3, version: '1.0.2', file: 'android/x.apk', sha256: 'abc' }, 'no proper fingerprint'],
    [{ build: 0, version: '1.0.2', file: 'android/rcl-erp-1.0.1-2.apk', sha256: sha }, 'no build number'], [{ build: 3, version: '1.0.2', file: 'android/missing.apk', sha256: sha }, 'a file that is not there']]) {
    await put('android/latest.json', JSON.stringify(bad), 'application/json');
    r = await app({ action: 'latest', platform: 'android' });
    ok('   a wrong latest.json (' + why + '): nothing given to the phones', r.j.none === true && !r.j.url, r.j);
  }
  await put('ios/latest.json', JSON.stringify({ build: 2, version: '1.0.1', store: 'https://testflight.apple.com/join/AbCdEf' }), 'application/json');
  r = await app({ action: 'latest', platform: 'ios' });
  ok('iPhone: the TestFlight / App Store page (no file)', r.j.store === 'https://testflight.apple.com/join/AbCdEf' && !r.j.url, r.j);
  await put('ios/latest.json', JSON.stringify({ build: 2, version: '1.0.1', store: 'https://evil.example/app' }), 'application/json');
  r = await app({ action: 'latest', platform: 'ios' });
  ok('   another site\'s link: not given', r.j.none === true, r.j);
  execSync('rm -rf /home/claude/rig/storage/app-releases');
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + e.stack); process.exit(1); });
