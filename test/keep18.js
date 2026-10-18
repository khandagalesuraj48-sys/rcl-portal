/* (18-10-2026, asked: "app 6 hour nantr log out hote as nko aahe … user jo prynt log out krt nahi to prynt log in rahil mg app aso
 * ki web") A sign-in stays until "Sign out" – in a real browser (Chromium), on the local test rig, never the live databases:
 *   node test/keep18.js      (needs the rig: Portal :3010, Mechanical :3000 linked to it; run test/browser.test.js first – it sets
 *                             the Portal up with the rig's users)
 * A person signs in on the Portal and opens Mechanical. Then "the night": his Mechanical sign-in has ended (as after 6 hours
 * without use) and the Portal's sign-in was last used 10 hours ago, 40 days after it was made. He opens the ERP again: he is back
 * in Mechanical by himself – the Portal's sign-in page never shows, nothing is typed. On a computer and on a phone. Then
 * "Logout" in Mechanical: signed out of the Portal too, and opening the ERP asks for the password again. */
'use strict';
const { execSync } = require('child_process');
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const P = 'http://127.0.0.1:3010', M = 'http://127.0.0.1:3000';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 30000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* the page is changing */ } await wait(300); } return null; };
const PW = 'Nashik#Road848!', WHO = 'sujit@rcl.test';

(async () => {
  sql('rcl_portal', "delete from sessions where email = '" + WHO + "'; delete from counters where key like 'F\\_%' or key like 'LG\\_%';");
  sql('rcl', "delete from web.cache where key like 'F\\_%' or key like 'LG\\_%';");
  const browser = await chromium.launch({ timeout: 60000 });
  const app = pg => pg.frames().find(f => f !== pg.mainFrame());
  const inMech = async pg => { if (!pg.url().startsWith(M)) return false; const f = app(pg); return !!f && f.evaluate(() => document.getElementById('login_screen').hidden === true && !!(localStorage.getItem('rcl_token') || sessionStorage.getItem('rcl_token'))); };
  const token = pg => app(pg).evaluate(() => localStorage.getItem('rcl_token') || sessionStorage.getItem('rcl_token'));
  try {
    for (const dev of [{ name: 'computer', o: { viewport: { width: 1280, height: 800 } } }, { name: 'phone', o: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]) {
      const ctx = await browser.newContext(Object.assign({ permissions: ['geolocation'], geolocation: { latitude: 16.69, longitude: 74.17, accuracy: 20 } }, dev.o));
      const pg = await ctx.newPage();
      // every time the Portal's sign-in form is on the screen
      let loginShown = 0;
      const seeLogin = () => pg.url().startsWith(P) && pg.evaluate(() => { const v = document.getElementById('v_login'); return !!v && !v.hidden; }).then(x => { if (x) loginShown++; return x; }, () => false);
      // ---- the sign-in (the only time the password is typed) ----
      await pg.goto(P + '/');
      await pg.waitForSelector('#v_login:not([hidden])');
      await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email');
      await pg.fill('#l_email', WHO); await pg.fill('#l_pass', PW); await pg.click('#l_btn');
      await pg.waitForSelector('#v_home:not([hidden])');
      await pg.click('#h_sites a.mod');
      ok(dev.name + ': signed in on the Portal, Mechanical opens', !!(await until(() => inMech(pg), 60000)), pg.url());
      const before = await token(pg);
      // ---- the night: Mechanical's sign-in has ended; the Portal's was last used 10 hours ago, 40 days after it was made ----
      sql('rcl', "delete from web.cache where key = 'S_" + before.replace(/'/g, '') + "';");
      sql('rcl_portal', "update sessions set created_at = now() - interval '40 days', last_seen_at = now() - interval '10 hours' where email = '" + WHO + "';");
      await pg.goto('about:blank');
      // ---- the next morning: he opens the ERP again ----
      loginShown = 0;
      await pg.goto(M + '/');
      const back = await until(async () => { await seeLogin(); return inMech(pg); }, 60000);
      const after = back ? await token(pg) : '';
      ok(dev.name + ': the next morning he is back in Mechanical by himself – a new Mechanical sign-in from the Portal\'s', !!back && after && after !== before, { url: pg.url(), before: !!before, after: !!after });
      ok(dev.name + ':    the Portal\'s sign-in page never showed, nothing was typed', loginShown === 0, loginShown);
      ok(dev.name + ':    the Portal\'s sign-in is the same one, used again now (kept another 400 days)', sql('rcl_portal', "select count(*) || '|' || bool_and(last_seen_at > now() - interval '5 minutes') || '|' || bool_and(expires_at > now() + interval '399 days') from sessions where email = '" + WHO + "'") === '1|true|true',
        sql('rcl_portal', "select created_at, last_seen_at, expires_at from sessions where email = '" + WHO + "'"));
      await pg.screenshot({ path: path.join(SHOTS, 'keep18-' + dev.name + '.png') });
      // ---- "Logout" in Mechanical: signed out of the Portal too ----
      await app(pg).evaluate(() => { const c = document.getElementById('cf_back'); if (c && !c.hidden) { try { closeConfirm(false); } catch (e) { /* none */ } } });
      await app(pg).evaluate(() => document.getElementById('u_logout').click());
      await until(async () => { const f = app(pg); if (f) await f.evaluate(() => { const c = document.getElementById('cf_back'); if (c && !c.hidden) document.getElementById('cf_ok').click(); }).catch(() => {}); return pg.url().startsWith(P); }, 30000);
      await until(() => seeLogin(), 30000);
      ok(dev.name + ': "Logout" in Mechanical ends the Portal\'s sign-in too', sql('rcl_portal', "select count(*) from sessions where email = '" + WHO + "'") === '0');
      loginShown = 0;
      await pg.goto(M + '/');
      ok(dev.name + ':    opening the ERP after "Logout" asks for the password again', !!(await until(() => seeLogin(), 40000)), pg.url());
      await ctx.close();
    }
  } catch (e) { ok('the test ran to its end', false, String((e && e.stack) || e)); }
  await browser.close();
  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
