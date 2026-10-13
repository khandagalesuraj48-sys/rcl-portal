/* The Portal page in a real browser (Chromium), on the local test rig – never the live databases:
 *   node test/browser.test.js            (needs the rig: Portal :3010, its database, Mechanical :3000/:3100)
 * The first start, the Super Admin console, a new user with a one-time password, the dashboard on a computer and on a
 * phone, and the jump into a module. Pictures are saved in test/shots/ (not kept in git). */
'use strict';
const { execSync } = require('child_process');
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const P = 'http://127.0.0.1:3010', M = 'http://127.0.0.1:3000';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const mech = async (fn, ...args) => (await (await fetch(M + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }), signal: AbortSignal.timeout(60000) })).json());
const SAPW = 'Super#Admin2040', PW = 'Nashik#Road848!';

(async () => {
  // the same start as test/api.test.js: an empty Portal, a fresh Mechanical Super Admin
  sql('rcl_portal', "truncate public.access, public.sessions, public.audit, public.counters, public.signing_keys, public.users, public.sites, public.companies cascade; update public.modules set url = null, status = 'live' where key = 'mechanical'; delete from public.modules where key <> 'mechanical';");
  sql('rcl', "delete from rcl_super_admin; delete from web.cache where key like 'SA%' or key like 'F\\_%' or key like 'LG\\_%';");
  const a = await mech('login', 'sujit@rcl.test', PW);
  const mk = await mech('api', a.result.token, 'createSuperAdmin', [{ email: 'sa@rcl.test', name: 'Owner', password: SAPW, password2: SAPW }]);
  ok('rig: a Mechanical Super Admin made', !!(mk.result && mk.result.recovery), mk.error);

  const browser = await chromium.launch({ timeout: 60000 });
  const errors = [];
  // only the Portal's own page counts (Mechanical, opened at the end, is tested in its own repository); the one wrong password tried on purpose answers 401
    const watch = pg => { pg.on('pageerror', e => { if (pg.url().startsWith(P)) errors.push(String(e)); }); pg.on('console', m => { if (m.type() === 'error' && pg.url().startsWith(P) && !/favicon|status of 401/.test(m.text())) errors.push(m.text()); }); pg.setDefaultTimeout(20000); };
  try {
    // ---- computer ----
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage(); watch(pg);
    await pg.goto(P + '/');
    await pg.waitForSelector('#l_setup:not([hidden])');
    ok('first start: the sign-in page offers "bring the users over"', await pg.isVisible('#l_setup_btn'));
    await pg.screenshot({ path: path.join(SHOTS, '01-login-first-start.png') });
    await pg.click('#l_setup_btn'); await pg.fill('#s_email', 'sa@rcl.test'); await pg.fill('#s_pass', 'wrong-pass-9');
    // wait for the server's answer itself, so a slow or missing answer is told apart from a page that did not show it
    const [ans] = await Promise.all([pg.waitForResponse(r => r.url() === P + '/api/setup' && r.request().method() === 'POST' && /"import"/.test(r.request().postData() || ''), { timeout: 30000 }), pg.click('#s_btn')]);
    ok('   the server answers a wrong import password with 401', ans.status() === 401, ans.status());
    await pg.waitForFunction(() => document.getElementById('s_err').textContent.length > 0);
    ok('   a wrong password: told plainly, in English and Marathi', /Wrong email or password/.test(await pg.textContent('#s_err')) && /[ऀ-ॿ]/.test(await pg.textContent('#s_err')), await pg.textContent('#s_err'));
    await pg.fill('#s_pass', SAPW); await pg.click('#s_btn');
    await pg.waitForSelector('#v_login:not([hidden])'); await pg.waitForSelector('#l_setup', { state: 'hidden' });
    ok('   the import done: back to sign-in, email filled in, the offer gone', (await pg.inputValue('#l_email')) === 'sa@rcl.test');
    // the Super Admin
    await pg.fill('#l_pass', SAPW); await pg.click('#l_btn');
    await pg.waitForSelector('#v_sa:not([hidden])'); await pg.waitForSelector('#u_rows tr');
    ok('the Super Admin lands on his console (no module cards)', await pg.isHidden('#v_home'));
    const n = await pg.$$eval('#u_rows tr', r => r.length);
    ok('   Users & Access lists the users brought over (not the Super Admin himself)', n >= 3 && !(await pg.textContent('#u_rows')).includes('sa@rcl.test'), n);
    await pg.screenshot({ path: path.join(SHOTS, '02-super-users.png'), fullPage: true });
    // a new user: Mechanical (User) on the first site, one-time password
    await pg.click('#u_new'); await pg.fill('#u_rows tr[data-new] .u-email', 'ravi@rcl.test'); await pg.fill('#u_rows tr[data-new] .u-name', 'Ravi Patil');
    await pg.selectOption('#u_rows tr[data-new] .sel-r[data-m="mechanical"]', 'user'); await pg.fill('#u_rows tr[data-new] .u-pw', 'Ravi#Temp2026');
    await pg.click('#u_rows tr[data-new] .u-save');
    await pg.waitForSelector('#u_rows tr[data-email="ravi@rcl.test"]');
    const site1 = await pg.inputValue('#u_site');
    ok('   user added with Mechanical on ' + site1 + ' (saved in the Portal database)', sql('rcl_portal', "select role from access where email = 'ravi@rcl.test' and site = '" + site1 + "' and module = 'mechanical'") === 'user');
    // per-site access: give sujit Mechanical on another site as well
    const other = await pg.$$eval('#u_site option', (o, s1) => o.map(x => x.value).filter(v => v && v !== s1)[0] || '', site1);
    if (other) {
      await pg.selectOption('#u_site', other); await pg.waitForSelector('#u_rows tr[data-email="sujit@rcl.test"]');
      await pg.selectOption('#u_rows tr[data-email="sujit@rcl.test"] .sel-r[data-m="mechanical"]', 'user'); await pg.click('#u_rows tr[data-email="sujit@rcl.test"] .u-save');
      await pg.waitForFunction(() => /Saved: sujit/.test(document.getElementById('toast').textContent));
      ok('   access is per site: sujit given Mechanical on ' + other + ' too', sql('rcl_portal', "select role from access where email = 'sujit@rcl.test' and site = '" + other + "' and module = 'mechanical'") === 'user');
    } else ok('   a second site on the rig to test per-site access', false, 'only one site');
    for (const t of ['sites', 'companies', 'modules', 'audit']) { await pg.click('#sa_tabs button[data-t="' + t + '"]'); await pg.waitForSelector('#t_' + t + ':not([hidden])'); await pg.screenshot({ path: path.join(SHOTS, '03-super-' + t + '.png'), fullPage: true }); }
    ok('   the Activity tab shows the import and the new user', /Import from Mechanical/.test(await pg.textContent('#a_rows')) && /ravi@rcl\.test/.test(await pg.textContent('#a_rows')));
    await pg.click('#sa_out'); await pg.waitForSelector('#v_login:not([hidden])');
    ok('   sign-out: back to the sign-in page', true);
    // the new user: one-time password → his own password → one module on one site → straight in
    await pg.fill('#l_email', 'ravi@rcl.test'); await pg.fill('#l_pass', 'Ravi#Temp2026'); await pg.click('#l_btn');
    await pg.waitForSelector('#v_pw:not([hidden])');
    ok('a new user must first set his own password', /Set your own password/.test(await pg.textContent('#p_title')));
    await pg.screenshot({ path: path.join(SHOTS, '04-set-own-password.png') });
    await pg.fill('#p_old', 'Ravi#Temp2026'); await pg.fill('#p_new', 'Ravi#Own2026x'); await pg.fill('#p_new2', 'Ravi#Own2026x');
    await Promise.all([pg.waitForURL(u => u.href.startsWith(M) , { timeout: 30000 }), pg.click('#p_btn')]);
    const url = pg.url();
    ok('   one module on one site: he goes straight into Mechanical, with a sign-in ticket', url.startsWith(M + '/#sso=') && url.split('#sso=')[1].split('.').length === 3, url.slice(0, 80));
    // sujit: two sites → the dashboard
    await pg.goto(P + '/?menu=1'); // ravi still signed in here; sign out first through the page
    await pg.waitForSelector('#v_home:not([hidden])');
    ok('   from a module, "?menu=1" shows his dashboard instead of jumping again', (await pg.$$eval('#h_sites a.mod', x => x.length)) === 1);
    await pg.click('#h_out'); await pg.waitForSelector('#v_login:not([hidden])');
    await pg.fill('#l_email', 'sujit@rcl.test'); await pg.fill('#l_pass', PW); await pg.click('#l_btn');
    await pg.waitForSelector('#v_home:not([hidden])');
    const cards = await pg.$$eval('#h_sites a.mod', x => x.map(a => a.textContent));
    ok('sujit (two sites) sees his dashboard: one card per site and module', cards.length === 2, cards);
    await pg.screenshot({ path: path.join(SHOTS, '05-dashboard-computer.png'), fullPage: true });
    await Promise.all([pg.waitForURL(u => u.href.startsWith(M), { timeout: 30000 }), pg.click('#h_sites a.mod >> nth=0')]);
    ok('   a card opens the module with a ticket', pg.url().includes('#sso='));
    await ctx.close();

    // ---- phone ----
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), pp = await ph.newPage(); watch(pp);
    await pp.goto(P + '/'); await pp.waitForSelector('#v_login:not([hidden])');
    const wide = async () => pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('phone: the sign-in page fits (no sideways scrolling)', (await wide()) <= 0, await wide());
    await pp.screenshot({ path: path.join(SHOTS, '06-phone-login.png') });
    await pp.fill('#l_email', 'sujit@rcl.test'); await pp.fill('#l_pass', PW); await pp.click('#l_btn');
    await pp.waitForSelector('#v_home:not([hidden])');
    ok('phone: the dashboard fits', (await wide()) <= 0, await wide());
    await pp.screenshot({ path: path.join(SHOTS, '07-phone-dashboard.png'), fullPage: true });
    await pp.click('#h_out'); await pp.waitForSelector('#v_login:not([hidden])');
    await pp.fill('#l_email', 'sa@rcl.test'); await pp.fill('#l_pass', SAPW); await pp.click('#l_btn');
    await pp.waitForSelector('#v_sa:not([hidden])'); await pp.waitForSelector('#u_rows tr');
    ok('phone: the Super Admin console – the page itself fits (the users table scrolls inside its own box)', (await wide()) <= 0, await wide());
    await pp.screenshot({ path: path.join(SHOTS, '08-phone-super.png'), fullPage: true });
    await ph.close();
    ok('no script error on any page', errors.length === 0, errors);
  } catch (e) { ok('the run finished', false, e.stack || String(e)); }
  finally { await browser.close(); }
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
