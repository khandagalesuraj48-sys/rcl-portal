/* (14-10-2026) the Super Admin opens the modules, and gives a Store User his pages – in a real browser, on the local rig (after
 * test/api.test.js or test/browser.test.js made the Super Admin sa@rcl.test). Test data only; put back at the end.
 *   NODE_PATH=<folder with playwright> node test/super14.js */
'use strict';
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const P = 'http://127.0.0.1:3010', SAPW = 'Super#Admin2040';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 800) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const storeWas = sql('rcl_portal', "select status || '|' || coalesce(url, '') from modules where key = 'store'");
  sql('rcl_portal', fs.readFileSync(path.join(__dirname, '..', 'sql', 'portal_step3_pages.sql'), 'utf8'));
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = 'http://127.0.0.1:3020', status = 'live'; " +
    "insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'store', 'user', 'test') on conflict (email, site, module) do update set role = 'user', pages = null;");
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const errs = [];
  try {
    const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); pg.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await pg.goto(P + '/'); await pg.fill('#l_email', 'sa@rcl.test'); await pg.fill('#l_pass', SAPW); await pg.click('#l_btn'); await wait(2500);
    ok('the Super Admin signs in: his console, with "Open modules"', await pg.isVisible('#v_sa') && await pg.isVisible('#sa_mods'));
    await pg.click('#sa_mods'); await wait(1500);
    const cards = await pg.$$eval('#h_sites a.mod', a => a.map(x => x.innerText.replace(/\s+/g, ' ')));
    ok('   "Open modules": every live module of every active site, each as Admin; "Super Admin console" to go back', await pg.isVisible('#v_home') && cards.length >= 2 && cards.every(t => /Admin/.test(t)) && cards.some(t => /Mechanical/.test(t)) && cards.some(t => /Store/.test(t)) && await pg.isVisible('#h_sa'), cards);
    await pg.screenshot({ path: path.join(SHOTS, 'super_modules.png') });
    const href = await pg.$eval('#h_sites a.mod', a => a.getAttribute('href'));
    const r = await pg.request.get(new URL(href, P + '/').toString(), { maxRedirects: 0 });
    const loc = r.headers().location || '', c = loc.includes('#sso=') ? JSON.parse(Buffer.from(loc.split('#sso=')[1].split('&')[0].split('.')[1], 'base64url').toString()) : {};
    ok('   a card opens the module with a ticket as its Admin', r.status() === 302 && c.role === 'admin' && c.sub === 'sa@rcl.test', loc);
    await pg.click('#h_sa'); await wait(1500);
    await pg.selectOption('#u_site', 'S1'); await wait(500); await pg.selectOption('#u_mod', 'store'); await wait(500);
    const pagesBtn = await pg.$('#u_rows tr[data-email="sujit@rcl.test"] .u-spages');
    ok('Users & Access → Store: a Store User has a "Pages" button', !!pagesBtn);
    await pagesBtn.click(); await wait(500);
    const sel = await pg.$$eval('#pg_panel .pg-sel', s => s.map(x => x.dataset.k + ':' + x.value + ':' + [...x.options].map(o => o.value).join('/')));
    ok('   his Store pages: Dashboard (View / No access), Item Master (Edit / View / No access)', sel.join(' ') === 'dashboard:View:View/None items:Edit:Edit/View/None', sel);
    await pg.selectOption('#pg_panel .pg-sel[data-k="items"]', 'View'); await pg.selectOption('#pg_panel .pg-sel[data-k="dashboard"]', 'None');
    await pg.screenshot({ path: path.join(SHOTS, 'super_store_pages.png') });
    await pg.click('#pg_ssave'); await wait(1500);
    ok('   saved with his access line', sql('rcl_portal', "select pages::text from access where email = 'sujit@rcl.test' and site = 'S1' and module = 'store'") === '{"items": "View", "dashboard": "None"}');
  } catch (e) { ok('the run finished', false, e.stack || String(e)); }
  finally { await b.close(); }
  ok('no script error', errs.length === 0, errs);
  sql('rcl_portal', "delete from access where email = 'sujit@rcl.test' and site = 'S1' and module = 'store'");
  if (!storeWas) sql('rcl_portal', "delete from modules where key = 'store'"); else sql('rcl_portal', "update modules set status = '" + storeWas.split('|')[0] + "', url = nullif('" + storeWas.split('|')[1] + "', '') where key = 'store'");
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
