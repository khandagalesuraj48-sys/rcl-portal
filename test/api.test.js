/* The Portal through its own doors, on the local test rig (never the live databases):
 *   Portal :3010 (test/…/portal_srv.sh) with its test database (door :3106), Mechanical's first site (door :3100) and its app
 *   server on :3000 (to make the Mechanical Super Admin). Test passwords only.
 *   node test/api.test.js
 * The test sets its own start: the Portal database emptied, a Mechanical Super Admin made afresh. */
'use strict';
const { execSync } = require('child_process');
const crypto = require('crypto');
const P = 'http://127.0.0.1:3010', M = 'http://127.0.0.1:3000';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
// a browser of our own: keeps the cookie, sends our header
function browser() {
  let cookie = '';
  const req = async (path, body, opt) => {
    opt = opt || {};
    const h = { 'Content-Type': 'application/json' }; if (!opt.noHeader) h['X-RCL'] = '1'; if (opt.origin) h.Origin = opt.origin; if (cookie && !opt.noCookie) h.Cookie = cookie;
    const r = await fetch(P + path, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    return { status: r.status, j: j || {}, loc: r.headers.get('location'), setCookie: sc };
  };
  return { req, get cookie() { return cookie; } };
}
const mech = async (fn, ...args) => (await (await fetch(M + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }) })).json());
const SAPW = 'Super#Admin2040', PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';

(async () => {
  // ---- the start ----
  sql('rcl_portal', "truncate public.access, public.sessions, public.audit, public.counters, public.signing_keys, public.users, public.sites, public.companies cascade; update public.modules set url = null, status = 'live' where key = 'mechanical'; delete from public.modules where key <> 'mechanical';");
  sql('rcl_portal', "alter table public.users drop column if exists start_item; notify pgrst, 'reload schema';");      // (rig: as before the step-2 SQL)
  execSync('timeout 60 bash /home/claude/rig/portal_srv.sh');      // a fresh Portal server: it forgets the signing key of the emptied database
  // Mechanical as the rig has it: users on the first site only (opening a module through the Portal adds a user's site there – an earlier run)
  sql('rcl', "delete from public.rcl_user_sites where site <> 'S1'; delete from public.app_users where email = 'ravi@rcl.test'; delete from public.rcl_user_sites where email = 'ravi@rcl.test';");
  sql('rcl', "delete from rcl_super_admin; delete from web.cache where key like 'SA%' or key like 'F\\_%' or key like 'LG\\_%'; delete from rcl_companies where id not in (select company_id from rcl_sites where company_id is not null); insert into rcl_companies (id, name, gstin) values ('RACHANATEST', 'Rachana Test Co', '27AABCR1234Q1ZX') on conflict (id) do nothing;");
  const a = await mech('login', 'sujit@rcl.test', PW);
  const mk = await mech('api', a.result.token, 'createSuperAdmin', [{ email: 'sa@rcl.test', name: 'Owner', password: SAPW, password2: SAPW }]);
  const REC = mk.result && mk.result.recovery;
  ok('Mechanical: a Super Admin made (the one the Portal will take over)', !!REC, mk.error);

  const A = browser();
  let r = await A.req('/api/auth', { action: 'me' });
  ok('nobody signed in yet', r.status === 200 && r.j.signedIn === false);
  r = await A.req('/api/setup', { action: 'status' });
  ok('first start: the Portal asks to bring the users over (and knows the way to Mechanical)', r.j.needed === true && r.j.mech === true, r.j);
  r = await A.req('/api/setup', { action: 'import', email: 'sa@rcl.test', password: SAPW }, { noHeader: true });
  ok('a request without the Portal page\'s own header is refused (403)', r.status === 403, r.j);
  r = await A.req('/api/setup', { action: 'import', email: 'sa@rcl.test', password: 'wrong-pass-9' });
  ok('the import needs the Mechanical Super Admin\'s real password', r.status === 401 && /Wrong email or password/.test(r.j.error), r.j);
  r = await A.req('/api/setup', { action: 'import', email: 'sujit@rcl.test', password: PW });
  ok('… not an ordinary Admin\'s', r.status === 401, r.j);
  r = await A.req('/api/setup', { action: 'import', email: 'sa@rcl.test', password: SAPW });
  ok('the import: companies, sites, users, access', r.status === 200 && r.j.ok && r.j.users >= 3 && r.j.sites >= 2 && r.j.access >= 3, r.j);
  ok('   every user\'s kept password is the SAME as in Mechanical (nobody resets a password)', ['sujit@rcl.test', 'view@rcl.test', 'none@rcl.test'].every(e => sql('rcl_portal', "select password_hash from users where email = '" + e + "'") === sql('rcl', "select password_hash from app_users where email = '" + e + "'")));
  ok('   the Super Admin came over with his password and recovery code', sql('rcl_portal', "select password_hash || recovery_hash from users where is_super") === sql('rcl', 'select password_hash || recovery_hash from rcl_super_admin'));
  ok('   who has which site → Mechanical access there (sujit Admin on S1)', sql('rcl_portal', "select role from access where email = 'sujit@rcl.test' and site = 'S1' and module = 'mechanical'") === 'admin');
  ok('   Mechanical\'s link taken from the setting (MECH_APP_URL)', sql('rcl_portal', "select url || '|' || status from modules where key = 'mechanical'") === 'http://127.0.0.1:3000|live');
  ok('   Mechanical only read: its users are unchanged', sql('rcl', "select count(*) from app_users where email like '%@rcl.test'") === '3');
  r = await A.req('/api/setup', { action: 'import', email: 'sa@rcl.test', password: SAPW });
  ok('the import door is shut for good once the Super Admin is there', r.status === 403 && /already set up/.test(r.j.error), r.j);
  r = await A.req('/api/setup', { action: 'status' });
  ok('   and the sign-in page no longer offers it', r.j.needed === false);

  // ---- signing in ----
  r = await A.req('/api/auth', { action: 'login', email: 'sujit@rcl.test', password: 'wrong-pass-1' });
  ok('wrong password: the same answer as for an unknown email', r.status === 401 && r.j.error === 'Wrong email or password.' && r.j.code === 'wrong', r.j);
  r = await A.req('/api/auth', { action: 'login', email: 'nobody@rcl.test', password: 'wrong-pass-1' });
  ok('   unknown email: the same answer', r.status === 401 && r.j.error === 'Wrong email or password.');
  r = await A.req('/api/auth', { action: 'login', email: 'sujit@rcl.test', password: PW }, { origin: 'https://evil.example' });
  ok('a sign-in sent from another web page is refused', r.status === 403, r.j);
  r = await A.req('/api/auth', { action: 'login', email: 'sujit@rcl.test', password: PW });
  ok('sujit signs in with his Mechanical password', r.status === 200 && r.j.user.email === 'sujit@rcl.test' && !r.j.mustChange, r.j);
  ok('   the cookie: HttpOnly, SameSite=Lax, kept 400 days – the most a browser keeps (Secure on https)', /HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie) && /Max-Age=34560000/.test(r.setCookie), r.setCookie);
  ok('   the database keeps only a fingerprint of the sign-in, never the sign-in itself', !sql('rcl_portal', 'select string_agg(id_hash, \',\') from sessions').includes(decodeURIComponent(A.cookie.split('=')[1])));
  r = await A.req('/api/auth', { action: 'me' });
  ok('   his dashboard: Mechanical on S1 as Admin', r.j.signedIn && r.j.items.some(i => i.site === 'S1' && i.module === 'mechanical' && i.role === 'admin'), r.j.items);
  // ---- opening a module ----
  r = await A.req('/api/go?module=mechanical&site=S1');
  ok('opening Mechanical: the browser goes to Mechanical with a ticket after "#"', r.status === 302 && /^http:\/\/127\.0\.0\.1:3000\/#sso=[\w-]+\.[\w-]+\.[\w-]+$/.test(r.loc || ''), r.loc);
  const tk = (r.loc || '').split('#sso=')[1] || '';
  const [h, b, sg] = tk.split('.'); const head = JSON.parse(Buffer.from(h, 'base64url')), cl = JSON.parse(Buffer.from(b, 'base64url'));
  const jw = await (await fetch(P + '/api/jwks')).json(), key = jw.keys.find(k => k.kid === head.kid);
  const good = !!key && crypto.verify('sha256', Buffer.from(h + '.' + b), { key: crypto.createPublicKey({ key: key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'));
  ok('   the ticket is signed (ES256) and checks out with the Portal\'s PUBLIC key (/api/jwks)', head.alg === 'ES256' && good);
  ok('   it says who, which site, which module, as what – and is good for 60 seconds only', cl.sub === 'sujit@rcl.test' && cl.site === 'S1' && cl.aud === 'mechanical' && cl.role === 'admin' && cl.exp - cl.iat === 60 && cl.super === undefined && /^[0-9a-f]{32}$/.test(cl.jti) && Array.isArray(cl.mods) && cl.mods.every(m => /^http:\/\/127\.0\.0\.1:\d+/.test(m.url)), cl);
  r = await A.req('/api/go?module=mechanical&site=S1&page=lg');
  ok('   a page asked for goes along after the ticket (#sso=…&page=lg); a strange page name is dropped', /#sso=[\w.-]+&page=lg$/.test(r.loc || '') && /#sso=[\w.-]+$/.test((await A.req('/api/go?module=mechanical&site=S1&page=' + encodeURIComponent('x"><b'))).loc || ''), r.loc);
  // (13-10-2026, in the same view) a module shown inside another asks for its ticket as an answer, not a page change
  r = await A.req('/api/go?module=mechanical&site=S1&json=1');
  ok('   json=1 (a module inside another): the ticket itself, no page change; it checks out like the other', r.status === 200 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(r.j.ticket || '') && !r.loc, r);
  r = await A.req('/api/go?module=mechanical&site=S1&json=1', undefined, { noHeader: true });
  ok('   json=1 without the Portal page\'s header: refused', r.status === 403 && !r.j.ticket, r);
  r = await A.req('/api/go?module=mechanical&site=S1&json=1', undefined, { origin: 'https://evil.example' });
  ok('   json=1 asked from another site: refused', r.status === 403 && !r.j.ticket, r);
  r = await A.req('/api/go?module=mechanical&site=T9&json=1');
  ok('   json=1 for a site he does not have: "noaccess", no ticket', r.status === 403 && r.j.code === 'noaccess' && !r.j.ticket, r);
  r = await A.req('/api/go?module=mechanical&site=S1&json=1', undefined, { noCookie: true });
  ok('   json=1 not signed in: "signin", no ticket', r.status === 401 && r.j.code === 'signin' && !r.j.ticket, r);
  const forged = h + '.' + Buffer.from(JSON.stringify(Object.assign({}, cl, { sub: 'sa@rcl.test' }))).toString('base64url') + '.' + sg;
  const f2 = forged.split('.');
  ok('   a ticket changed by anybody fails the check', !crypto.verify('sha256', Buffer.from(f2[0] + '.' + f2[1]), { key: crypto.createPublicKey({ key: key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(f2[2], 'base64url')));
  ok('   the private key is kept LOCKED in the database (no key text in it)', !/BEGIN/.test(sql('rcl_portal', 'select private_sealed from signing_keys')) && /^v1\./.test(sql('rcl_portal', 'select private_sealed from signing_keys')));
  r = await A.req('/api/go?module=mechanical&site=T2');
  ok('a site he does not have: back to his dashboard with a note, no ticket', r.status === 302 && r.loc === '../?msg=noaccess', r.loc);
  const N = browser();
  r = await N.req('/api/go?module=mechanical&site=S1');
  ok('not signed in: to the sign-in page (a RELATIVE address – right at its own address and under the main one), and back to the module after it', r.status === 302 && r.loc === '../?next=' + encodeURIComponent('api/go?module=mechanical&site=S1'), r.loc);
  r = await A.req('/api/admin', { action: 'overview' });
  ok('an ordinary user (even a Mechanical Admin) cannot open the Super Admin console', r.status === 403, r.j);

  // ---- the Super Admin ----
  const S = browser();
  r = await S.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: SAPW });
  ok('the Super Admin signs in on the same page', r.status === 200 && r.j.user.super === true, r.j);
  r = await S.req('/api/go?module=mechanical&site=S1');
  // (14-10-2026, asked) the Super Admin opens every module of every site, as its Admin
  const saT = (r.loc.split('#sso=')[1] || '').split('&')[0], saC = saT ? JSON.parse(Buffer.from(saT.split('.')[1], 'base64url').toString()) : {};
  ok('   he opens a module of a site (14-10-2026): a ticket as its Admin', r.status === 302 && /#sso=/.test(r.loc) && saC.sub === 'sa@rcl.test' && saC.role === 'admin' && saC.aud === 'mechanical' && saC.site === 'S1', r.loc);
  ok('   (14-10-2026) his ticket says he is the Super Admin (Mechanical: billed entries, Approvals)', saC.super === true, saC);
  r = await S.req('/api/auth', { action: 'me' });
  ok('   his "My modules": every live module of every active site, as Admin', r.j.items.length > 0 && r.j.items.every(i => i.role === 'admin') && r.j.items.some(i => i.site === 'S1' && i.module === 'mechanical'), r.j.items);
  r = await S.req('/api/admin', { action: 'overview' });
  ok('   his console: users (no kept password in the answer), sites, modules, companies, access', r.status === 200 && r.j.users.length >= 4 && !JSON.stringify(r.j).includes('scrypt$') && r.j.sites.length >= 2 && r.j.modules.length === 1, Object.keys(r.j));
  r = await S.req('/api/admin', { action: 'companySave', name: 'Sketchline Industries', gstin: '27ABC' });
  ok('   company: a wrong GSTIN is refused', r.status === 400 && /right format/.test(r.j.error), r.j);
  r = await S.req('/api/admin', { action: 'companySave', name: 'Sketchline Industries' });
  ok('   company added', r.status === 200 && r.j.ok, r.j);
  r = await S.req('/api/admin', { action: 'siteSave', isNew: true, code: '18b', name: 'Kolhapur 18B', company: r.j.id, status: 'active' });
  ok('   site 18B added (code in capitals)', r.status === 200 && sql('rcl_portal', "select name from sites where code = '18B'") === 'Kolhapur 18B', r.j);
  r = await S.req('/api/admin', { action: 'siteSave', isNew: true, code: '18B', name: 'Again', status: 'active' });
  ok('   the same code twice: refused', r.status === 409, r.j);
  r = await S.req('/api/admin', { action: 'moduleSave', key: 'mechanical', url: 'ftp://x', status: 'live' });
  ok('   a module link must be https', r.status === 400, r.j);
  r = await S.req('/api/admin', { action: 'moduleSave', isNew: true, key: 'store', name: 'Store', url: '', status: 'off' });
  ok('   module Store added (Off – not on any dashboard yet)', r.status === 200, r.j);
  r = await S.req('/api/admin', { action: 'userSave', isNew: true, email: 'Ravi@Portal.test', name: 'Ravi', active: true, newPassword: '' });
  ok('   a new user needs a one-time password', r.status === 400 && /one-time password/.test(r.j.error), r.j);
  r = await S.req('/api/admin', { action: 'userSave', isNew: true, email: 'Ravi@Portal.test', name: 'Ravi', active: true, newPassword: 'Temp1234' });
  ok('   new user added (email kept in small letters)', r.status === 200 && sql('rcl_portal', "select count(*) from users where email = 'ravi@portal.test'") === '1', r.j);
  r = await S.req('/api/admin', { action: 'accessSet', email: 'ravi@portal.test', site: '18B', module: 'mechanical', role: 'user' });
  ok('   Ravi gets Mechanical on 18B as User', r.status === 200, r.j);
  r = await S.req('/api/admin', { action: 'accessSet', email: 'sa@rcl.test', site: 'S1', module: 'mechanical', role: 'user' });
  ok('   the Super Admin cannot be given a module', r.status === 400, r.j);
  r = await S.req('/api/admin', { action: 'userSave', email: 'sa@rcl.test', name: 'X', active: false });
  ok('   nor be switched off from the users list', r.status === 400, r.j);

  // ---- the pages of Mechanical, given here (Mechanical :3000 is linked to this Portal on the rig) ----
  r = await S.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('Pages: the Super Admin sees S1\'s users in Mechanical with their pages', r.status === 200 && r.j.pages.some(x => x.key === 'Diesel Issue') && r.j.users.some(u => u.email === 'view@rcl.test' && u.perms.Dashboard), r.j.error || r.j);
  ok('   (no password in the answer)', !/scrypt|sha256/.test(JSON.stringify(r.j)));
  const keepPg = sql('rcl', "select perm_diesel_issue from app_users where email = 'view@rcl.test'");
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Edit', Dashboard: 'View' } });
  ok('   he sets view\'s pages: saved in Mechanical', r.status === 200 && sql('rcl', "select perm_diesel_issue from app_users where email = 'view@rcl.test'") === 'Edit', r.j);
  ok('   written in the Activity record here', sql('rcl_portal', "select count(*) from audit where action = 'Pages' and target = 'view@rcl.test · S1'") === '1');
  // (with Mechanical's update-189) a page with a date offers Admin (Edit, and its entries of an earlier day); Mechanical keeps it there only
  r = await S.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('   Admin offered on the pages with a date (Diesel Issue, Log Book …), not on the others (Reports)', r.status === 200 && r.j.pages.find(x => x.key === 'Diesel Issue').dateAdmin === true && r.j.pages.find(x => x.key === 'Log Book').dateAdmin === true && !r.j.pages.find(x => x.key === 'Reports').dateAdmin, r.j.pages);
  const rpWas = sql('rcl', "select coalesce(perm_reports, '') from app_users where email = 'view@rcl.test'");
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Admin', Reports: 'Admin', Dashboard: 'View' } });
  ok('   Diesel Issue = Admin saved in Mechanical as Admin; Reports "Admin" (a page without a date) not taken – as it was', r.status === 200 && sql('rcl', "select perm_diesel_issue || '|' || coalesce(perm_reports, '') from app_users where email = 'view@rcl.test'") === 'Admin|' + rpWas && r.j.user && r.j.user.perms['Diesel Issue'] === 'Admin', r.j);
  r = await S.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('   …and shown as Admin when his pages are opened again', r.status === 200 && (r.j.users.find(u => u.email === 'view@rcl.test') || { perms: {} }).perms['Diesel Issue'] === 'Admin', r.j.users);
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Edit', Reports: /^edit$/i.test(rpWas) ? 'Edit' : /^(no access|none|)$/i.test(rpWas) ? 'None' : 'View' } });
  ok('   back to Edit', r.status === 200 && sql('rcl', "select perm_diesel_issue from app_users where email = 'view@rcl.test'") === 'Edit', r.j);
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: '18B', email: 'view@rcl.test', perms: { Dashboard: 'View' } });
  ok('   a site where he does not have Mechanical: refused (give the site first)', r.status === 400 && r.j.code === 'noaccess', r.j);
  r = await A.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('   nobody but the Super Admin', r.status === 403, r.status);
  // ---- (with Mechanical's update-162) his diesel sources: the places he may give diesel FROM (Diesel Issue / Diesel Transfer) ----
  const dsWas = sql('rcl', "select count(*) from web.props where key = 'DIESEL_SOURCES'"), dsOf = () => sql('rcl', "select coalesce((select value from web.props where key = 'DIESEL_SOURCES'), '')");
  r = await S.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('Diesel sources: the site\'s places come with the users (S1: Dispenser, VTR Store); nobody has any chosen yet', r.status === 200 && JSON.stringify(r.j.places) === '["Dispenser","VTR Store"]' && r.j.users.every(u => !u.dsrc) && dsWas === '0', r.j.places);
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Edit' }, sources: { 'Diesel Issue': ['VTR Store'], 'Diesel Transfer': ['Dispenser', 'VTR Store'], 'Diesel Inward': ['Dispenser'] } });
  ok('   Issue: only VTR Store ticked; Transfer: both ticked → saved in Mechanical (S1\'s own database); Transfer = every source; Inward: never', r.status === 200 && /Diesel sources of view@rcl\.test – Diesel Issue: VTR Store; Diesel Transfer: every source/.test(r.j.changes) &&
    JSON.stringify(JSON.parse(dsOf() || '{}')) === '{"view@rcl.test":{"Diesel Issue":["VTR Store"]}}' && JSON.stringify(r.j.user && r.j.user.dsrc) === '{"Diesel Issue":["VTR Store"]}', [r.j, dsOf()]);
  ok('   the Activity record here has it', /Diesel sources of view@rcl\.test/.test(sql('rcl_portal', "select detail::text from audit where action = 'Pages' and target = 'view@rcl.test · S1' order by id desc limit 1")));
  r = await S.req('/api/admin', { action: 'mechPages', site: 'S1' });
  ok('   opened again: his ticks as saved', JSON.stringify((r.j.users.find(u => u.email === 'view@rcl.test') || {}).dsrc) === '{"Diesel Issue":["VTR Store"]}', r.j.users);
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Edit' } });
  ok('   a save without sources (a page before update-162): his sources stay', r.status === 200 && JSON.stringify(JSON.parse(dsOf() || '{}')) === '{"view@rcl.test":{"Diesel Issue":["VTR Store"]}}', dsOf());
  r = await S.req('/api/admin', { action: 'mechPagesSave', site: 'S1', email: 'view@rcl.test', perms: { 'Diesel Issue': 'Edit' }, sources: { 'Diesel Issue': ['Dispenser', 'VTR Store'], 'Diesel Transfer': ['Dispenser', 'VTR Store'] } });
  ok('   every place ticked again = every source (nothing kept for him)', r.status === 200 && JSON.stringify(JSON.parse(dsOf() || '{}')) === '{}' && !(r.j.user && r.j.user.dsrc), [r.j, dsOf()]);
  if (dsWas === '0') sql('rcl', "delete from web.props where key = 'DIESEL_SOURCES'");
  sql('rcl', "update app_users set perm_diesel_issue = '" + keepPg + "', updated_at = now() where email = 'view@rcl.test'");

  // ---- a brand-new user ----
  const R = browser();
  r = await R.req('/api/auth', { action: 'login', email: 'ravi@portal.test', password: 'Temp1234' });
  ok('Ravi signs in with the one-time password → must set his own', r.status === 200 && r.j.mustChange === true, r.j);
  r = await R.req('/api/auth', { action: 'me' });
  ok('   until then: no modules', r.j.mustChange === true && r.j.items.length === 0);
  r = await R.req('/api/go?module=mechanical&site=18B');
  ok('   and no ticket', r.status === 302 && r.loc === '../', r.loc);
  r = await R.req('/api/auth', { action: 'changePassword', old: 'Temp1234', password: 'short' });
  ok('   a weak password is refused', r.status === 400 && /at least 8/.test(r.j.error), r.j);
  r = await R.req('/api/auth', { action: 'changePassword', old: 'Temp1234', password: 'Ravi#Own2026' });
  ok('   he sets his own', r.status === 200, r.j);
  r = await R.req('/api/auth', { action: 'me' });
  ok('   now his dashboard: Mechanical on Kolhapur 18B (one module, one site – the page opens it straight away)', r.j.items.length === 1 && r.j.items[0].site === '18B' && r.j.items[0].siteName === 'Kolhapur 18B', r.j.items);
  // ---- switching off, signing out everywhere ----
  r = await S.req('/api/admin', { action: 'userSave', email: 'ravi@portal.test', name: 'Ravi', active: false });
  r = await R.req('/api/auth', { action: 'me' });
  ok('switched off by the Super Admin → his sign-in ends at once', r.j.signedIn === false);
  r = await R.req('/api/auth', { action: 'login', email: 'ravi@portal.test', password: 'Ravi#Own2026' });
  ok('   and he cannot sign in', r.status === 401);
  await S.req('/api/admin', { action: 'userSave', email: 'ravi@portal.test', name: 'Ravi', active: true });
  // ---- (18-10-2026) a sign-in stays until "Sign out": no 6 hours without use, no 30 days ----
  const V = browser();
  await V.req('/api/auth', { action: 'login', email: 'view@rcl.test', password: VPW });
  sql('rcl_portal', "update sessions set last_seen_at = now() - interval '7 hours' where email = 'view@rcl.test'");
  r = await V.req('/api/auth', { action: 'me' });
  ok('7 hours without use: still signed in (no 6-hour limit any more)', r.j.signedIn === true && r.j.user && r.j.user.email === 'view@rcl.test', r.j);
  ok('   the answer gives the cookie again – the same sign-in, kept another 400 days', /Max-Age=34560000/.test(r.setCookie || '') && V.cookie && r.setCookie.split(';')[0] === V.cookie, r.setCookie);
  ok('   its end in the database is moved on too (about 400 days from now)', sql('rcl_portal', "select (expires_at > now() + interval '399 days')::text from sessions where email = 'view@rcl.test'") === 'true');
  r = await V.req('/api/auth', { action: 'me' });
  ok('   used again within 5 minutes: nothing written, no cookie sent again', r.j.signedIn === true && !r.setCookie, r.setCookie);
  sql('rcl_portal', "update sessions set created_at = now() - interval '45 days', last_seen_at = now() - interval '20 days', expires_at = now() + interval '10 days' where email = 'view@rcl.test'");
  r = await V.req('/api/auth', { action: 'me' });
  ok('45 days after the sign-in, 20 days without use: still signed in (no 30-day limit any more)', r.j.signedIn === true, r.j);
  r = await V.req('/api/go?module=mechanical&site=S1');
  ok('   and a module opens with a ticket at once – nothing typed', r.status === 302 && /#sso=/.test(r.loc || ''), r.loc);
  sql('rcl_portal', "update sessions set expires_at = now() - interval '1 minute' where email = 'view@rcl.test'");
  r = await V.req('/api/auth', { action: 'me' });
  ok('only a sign-in left unused for 400 days ends by itself', r.j.signedIn === false);
  await V.req('/api/auth', { action: 'login', email: 'view@rcl.test', password: VPW });
  r = await V.req('/api/auth', { action: 'logout' });
  ok('"Sign out" ends it at once', r.status === 200 && /Max-Age=0/.test(r.setCookie || '') && sql('rcl_portal', "select count(*) from sessions where email = 'view@rcl.test'") === '0', r.setCookie);
  // ---- the lock ----
  for (let i = 0; i < 5; i++) await V.req('/api/auth', { action: 'login', email: 'view@rcl.test', password: 'wrong-' + i });
  r = await V.req('/api/auth', { action: 'login', email: 'view@rcl.test', password: VPW });
  ok('5 wrong passwords → locked for 15 minutes (also the right one)', r.status === 429 && /15 minutes/.test(r.j.error), r.j);
  sql('rcl_portal', "delete from counters where key like 'F\\_%'");
  // ---- the Super Admin's recovery code (made in Mechanical – it works here) ----
  const X = browser();
  r = await X.req('/api/auth', { action: 'recover', email: 'sa@rcl.test', code: 'AAAA-BBBB-CCCC-DDDD', password: 'Super#Admin2041' });
  ok('recovery: a wrong code is refused', r.status === 400 && /recovery code is wrong/.test(r.j.error), r.j);
  r = await X.req('/api/auth', { action: 'recover', email: 'sa@rcl.test', code: REC.toLowerCase(), password: 'Super#Admin2041' });
  ok('   the code written down in Mechanical works in the Portal → new password + a NEW code', r.status === 200 && r.j.recovery && r.j.recovery !== REC, r.j);
  r = await S.req('/api/auth', { action: 'me' });
  ok('   his old sign-ins have ended', r.j.signedIn === false);
  r = await X.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: 'Super#Admin2041' });
  ok('   he signs in with the new password', r.status === 200 && r.j.user.super, r.j);
  // ---- "My start": the module that opens straight after sign-in (step-2 SQL) ----
  r = await A.req('/api/auth', { action: 'me' });
  ok('My start, before the step-2 SQL: the page is told it is not ready (no star shown)', r.j.signedIn && r.j.startReady === false && r.j.start === '', r.j);
  r = await A.req('/api/auth', { action: 'setStart', module: 'mechanical', site: 'S1' });
  ok('   choosing one says which SQL to run', r.status === 500 && r.j.code === 'nostep' && /portal_step2_start\.sql/.test(r.j.error), r.j);
  execSync('timeout 60 su postgres -c "psql -d rcl_portal -v ON_ERROR_STOP=1 -tA -q -f ' + require('path').join(__dirname, '..', 'sql', 'portal_step2_start.sql') + '"');
  await wait(1500);
  ok('   the step-2 SQL only adds the column (users and passwords as they were)', sql('rcl_portal', "select count(*) from users where password_hash is null") === '0' && sql('rcl_portal', "select count(start_item) from users") === '0');
  r = await A.req('/api/auth', { action: 'me' });
  ok('after the SQL: ready, nothing chosen yet', r.j.startReady === true && r.j.start === '', r.j);
  r = await A.req('/api/auth', { action: 'setStart', module: 'mechanical', site: 'ZZ' });
  ok('   a module on a site he does not have: refused', r.status === 403, r.j);
  r = await A.req('/api/auth', { action: 'setStart', module: 'mechanical', site: 's1' });
  ok('   his own: saved', r.status === 200 && r.j.start === 'mechanical|S1' && sql('rcl_portal', "select start_item from users where email = 'sujit@rcl.test'") === 'mechanical|S1', r.j);
  r = await A.req('/api/auth', { action: 'me' });
  ok('   the page is told his start', r.j.start === 'mechanical|S1');
  sql('rcl_portal', "delete from access where email = 'sujit@rcl.test' and site = 'S1'");
  r = await A.req('/api/auth', { action: 'me' });
  ok('   his start is not used once he no longer has it (the dashboard instead)', r.j.start === '', r.j);
  sql('rcl_portal', "insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'mechanical', 'admin', 'test')");
  r = await A.req('/api/auth', { action: 'setStart' });
  ok('   taken away: his modules page opens again', r.status === 200 && sql('rcl_portal', "select coalesce(start_item, '-') from users where email = 'sujit@rcl.test'") === '-', r.j);
  r = await X.req('/api/auth', { action: 'setStart', module: 'mechanical', site: 'S1' });
  ok('   the Super Admin may have a start too (he opens every module – 14-10-2026)', r.status === 200 && sql('rcl_portal', "select start_item from users where is_super") === 'mechanical|S1', r.j);
  await X.req('/api/auth', { action: 'setStart' });
  ok('   written in the Activity record', sql('rcl_portal', "select count(*) from audit where action = 'Start module'") === '4');
  // ---- (asked 13-10-2026) change, switch off and delete: sites, companies, modules; the Module picker is the page's ----
  r = await X.req('/api/admin', { action: 'companySave', name: 'Delete Me Pvt Ltd' });
  const delCo = r.j.id;
  await X.req('/api/admin', { action: 'siteSave', isNew: true, code: 'DEL1', name: 'Delete Me', company: delCo, status: 'active' });
  await X.req('/api/admin', { action: 'accessSet', email: 'ravi@portal.test', site: 'DEL1', module: 'mechanical', role: 'user' });
  r = await X.req('/api/admin', { action: 'companyDelete', id: delCo });
  ok('delete a company a site belongs to: refused, the site is named', r.status === 400 && /DEL1/.test(r.j.error), r.j);
  r = await X.req('/api/admin', { action: 'siteDelete', code: 'DEL1', confirm: 'DEL1' });
  ok('delete an Active site: refused – it must be Closed first', r.status === 400 && /Closed/.test(r.j.error), r.j);
  await X.req('/api/admin', { action: 'siteSave', code: 'DEL1', name: 'Delete Me', company: delCo, status: 'closed' });
  r = await X.req('/api/admin', { action: 'siteDelete', code: 'DEL1', confirm: 'nope' });
  ok('   Closed, but the code not typed again: refused', r.status === 400 && /Type the site code/.test(r.j.error) && sql('rcl_portal', "select count(*) from sites where code = 'DEL1'") === '1', r.j);
  r = await X.req('/api/admin', { action: 'siteDelete', code: 'DEL1', confirm: 'del1' });
  ok('   Closed and its code typed: deleted, with the access given on it', r.status === 200 && r.j.accessRemoved === 1 && sql('rcl_portal', "select (select count(*) from sites where code = 'DEL1') + (select count(*) from access where site = 'DEL1')") === '0', r.j);
  ok('   written in the Activity record (what was removed; the data kept)', /kept in its own database/.test(sql('rcl_portal', "select detail::text from audit where action = 'Site deleted' and target = 'DEL1'")));
  r = await X.req('/api/admin', { action: 'companyDelete', id: delCo });
  ok('   now no site belongs to the company: deleted', r.status === 200 && sql('rcl_portal', "select count(*) from companies where id = '" + delCo + "'") === '0', r.j);
  const s1 = sql('rcl_portal', "select name || '|' || coalesce(company_id, '') from sites where code = 'S1'").split('|');
  await X.req('/api/admin', { action: 'siteSave', code: 'S1', name: s1[0], company: s1[1], status: 'closed' });
  r = await X.req('/api/admin', { action: 'siteDelete', code: 'S1', confirm: 'S1' });
  ok('the first site: Mechanical refuses – nothing is deleted', r.status === 400 && /first site/.test(r.j.error) && sql('rcl_portal', "select count(*) from sites where code = 'S1'") === '1' && sql('rcl_portal', "select count(*) from access where site = 'S1'") !== '0' && sql('rcl', "select status from rcl_sites where code = 'S1'") === 'ready', r.j);
  await X.req('/api/admin', { action: 'siteSave', code: 'S1', name: s1[0], company: s1[1], status: 'active' });
  await X.req('/api/admin', { action: 'moduleSave', isNew: true, key: 'tmpmod', name: 'Temp', url: 'https://tmp.example.com', status: 'live' });
  r = await X.req('/api/admin', { action: 'moduleSave', key: 'tmpmod', name: 'Temp Two', url: 'https://tmp.example.com', status: 'live' });
  ok('a module\'s name can be changed', r.status === 200 && sql('rcl_portal', "select name from modules where key = 'tmpmod'") === 'Temp Two', r.j);
  await X.req('/api/admin', { action: 'accessSet', email: 'ravi@portal.test', site: 'S1', module: 'tmpmod', role: 'user' });
  r = await X.req('/api/admin', { action: 'moduleDelete', key: 'tmpmod', confirm: 'tmpmod' });
  ok('delete a Live module: refused – it must be Off first', r.status === 400 && /Off/.test(r.j.error), r.j);
  await X.req('/api/admin', { action: 'moduleSave', key: 'tmpmod', name: 'Temp Two', url: 'https://tmp.example.com', status: 'off' });
  r = await X.req('/api/admin', { action: 'moduleDelete', key: 'tmpmod', confirm: 'tmpmod' });
  ok('   Off and its key typed: deleted, with the access given to it', r.status === 200 && r.j.accessRemoved === 1 && sql('rcl_portal', "select (select count(*) from modules where key = 'tmpmod') + (select count(*) from access where module = 'tmpmod')") === '0', r.j);
  await X.req('/api/admin', { action: 'moduleSave', key: 'mechanical', name: 'Mechanical', url: sql('rcl_portal', "select url from modules where key = 'mechanical'"), status: 'off' });
  r = await X.req('/api/admin', { action: 'moduleDelete', key: 'mechanical', confirm: 'mechanical' });
  ok('   Mechanical can never be deleted', r.status === 400 && /cannot be deleted/.test(r.j.error) && sql('rcl_portal', "select count(*) from modules where key = 'mechanical'") === '1', r.j);
  await X.req('/api/admin', { action: 'moduleSave', key: 'mechanical', name: 'Mechanical', url: sql('rcl_portal', "select url from modules where key = 'mechanical'"), status: 'live' });
  r = await A.req('/api/admin', { action: 'siteDelete', code: 'S1', confirm: 'S1' });
  ok('   nobody but the Super Admin can delete', r.status === 403 || r.status === 401, r.status);
  // ---- (14-10-2026) the Store's pages for a Store User, set here (step 3) and carried in his ticket ----
  sql('rcl_portal', 'alter table public.access drop column if exists pages; notify pgrst, \'reload schema\';'); await new Promise(z => setTimeout(z, 800));
  const storeWas = sql('rcl_portal', "select status || '|' || coalesce(url, '') from modules where key = 'store'");      // (another test may have made it)
  if ((await X.req('/api/admin', { action: 'moduleSave', isNew: true, key: 'store', name: 'Store', url: 'https://store.example.com', status: 'live' })).status === 409)
    await X.req('/api/admin', { action: 'moduleSave', key: 'store', name: 'Store', url: 'https://store.example.com', status: 'live' });
  await X.req('/api/admin', { action: 'accessSet', email: 'sujit@rcl.test', site: 'S1', module: 'store', role: 'user' });
  r = await X.req('/api/admin', { action: 'storePagesSave', email: 'sujit@rcl.test', site: 'S1', pages: { dashboard: 'None', items: 'View' } });
  ok('Store pages before step 3: says which SQL file to run', r.status === 500 && r.j.code === 'nostep' && /portal_step3_pages\.sql/.test(r.j.error), r.j);
  r = await X.req('/api/admin', { action: 'overview' });
  ok('   the console still works without the step (no pages column yet)', r.status === 200 && Array.isArray(r.j.access) && r.j.storePages.length === 10, r.j.error);      // (the Store's step 2: 7 pages + approves, purchase; 28-10-2026 + approves purchase orders)
  const step3 = require('fs').readFileSync(require('path').join(__dirname, '..', 'sql', 'portal_step3_pages.sql'), 'utf8');
  sql('rcl_portal', step3); sql('rcl_portal', step3); await new Promise(z => setTimeout(z, 800));
  r = await X.req('/api/admin', { action: 'storePagesSave', email: 'sujit@rcl.test', site: 'S1', pages: { dashboard: 'None', items: 'View', other: 'Edit' } });
  const pg3 = JSON.parse(sql('rcl_portal', "select pages::text from access where email = 'sujit@rcl.test' and site = 'S1' and module = 'store'") || '{}');
  ok('step 3 run (twice): his Store pages are saved with his access line (only the Store\'s pages; the Store\'s step-2 pages not given = No access)', r.status === 200 && pg3.items === 'View' && pg3.dashboard === 'None' && pg3.req === 'None' && pg3.grn === 'None' && pg3.approve === 'None' && pg3.purchase === 'None' && !('other' in pg3), pg3);
  ok('   the Store could not be told who approves (no Store at that address): saved, and said', /Saved\. But the Store was not told who approves/.test(String(r.j.warn)), r.j);
  r = await A.req('/api/go?module=store&site=S1');
  const stT = (r.loc.split('#sso=')[1] || '').split('&')[0], stC = stT ? JSON.parse(Buffer.from(stT.split('.')[1], 'base64url').toString()) : {};
  ok('   his Store ticket carries them (User)', r.status === 302 && stC.role === 'user' && stC.pages && stC.pages.items === 'View' && stC.pages.dashboard === 'None', { loc: r.loc, st: r.status, stC });
  await X.req('/api/admin', { action: 'accessSet', email: 'sujit@rcl.test', site: 'S1', module: 'store', role: 'admin' });
  r = await X.req('/api/admin', { action: 'storePagesSave', email: 'sujit@rcl.test', site: 'S1', pages: { items: 'View' } });
  const pgA = JSON.parse(sql('rcl_portal', "select pages::text from access where email = 'sujit@rcl.test' and site = 'S1' and module = 'store'") || '{}');
  ok('   a Store Admin has every page: his pages are not changed – only "Approves requirements" and "Store Purchase" are his to be given', r.status === 200 && pgA.items === 'View' && r.j.pages.approve === 'None' && r.j.pages.purchase === 'None', [r.j, pgA]);
  r = await A.req('/api/go?module=store&site=S1');
  const stA = JSON.parse(Buffer.from(((r.loc.split('#sso=')[1] || '').split('&')[0]).split('.')[1], 'base64url').toString());
  ok('   as Admin his ticket has no pages (every page)', stA.role === 'admin' && stA.pages === undefined, stA);
  await X.req('/api/admin', { action: 'storePagesSave', email: 'sujit@rcl.test', site: 'S1', pages: { purchase: 'Edit' } });
  r = await A.req('/api/go?module=store&site=S1');
  const stP = JSON.parse(Buffer.from(((r.loc.split('#sso=')[1] || '').split('&')[0]).split('.')[1], 'base64url').toString());
  ok('   a Store Admin given "Store Purchase": his ticket carries only that', stP.role === 'admin' && JSON.stringify(stP.pages) === JSON.stringify({ purchase: 'Edit' }), stP);
  await X.req('/api/admin', { action: 'accessSet', email: 'sujit@rcl.test', site: 'S1', module: 'store', role: '' });
  await X.req('/api/admin', { action: 'moduleSave', key: 'store', name: 'Store', url: 'https://store.example.com', status: 'off' });
  if (!storeWas) await X.req('/api/admin', { action: 'moduleDelete', key: 'store', confirm: 'store' });
  else sql('rcl_portal', "update modules set status = '" + storeWas.split('|')[0] + "', url = nullif('" + storeWas.split('|')[1] + "', '') where key = 'store'");
  // ---- sign out ----
  r = await A.req('/api/auth', { action: 'logout' });
  ok('sign out: the cookie is emptied and the sign-in is gone from the database', r.status === 200 && /Max-Age=0/.test(r.setCookie) && sql('rcl_portal', "select count(*) from sessions where email = 'sujit@rcl.test'") === '0', r.setCookie);
  // ---- the record ----
  const acts = sql('rcl_portal', 'select string_agg(distinct action, \',\') from audit');
  ok('the Activity record has the sign-ins, failures, the import, users, access, sites, modules', ['Login', 'Login failed', 'Import from Mechanical', 'User added', 'Access', 'Site added', 'Module added', 'Opened module', 'Password changed', 'Logout'].every(x => acts.includes(x)), acts);
  r = await X.req('/api/admin', { action: 'audit' });
  ok('   and the Super Admin can read it', r.status === 200 && r.j.rows.length > 10);
  // the signing key the server remembers was taken out of the database: the public keys still answer (no endless lookup)
  sql('rcl_portal', 'delete from public.signing_keys;');
  const tj = Date.now(); let jk = null;
  try { jk = await (await fetch(P + '/api/jwks', { signal: AbortSignal.timeout(10000) })).json(); } catch (e) { jk = null; }
  ok('public keys with the remembered key gone from the database: answered at once, with a new key', !!jk && jk.keys && jk.keys.length === 1 && Date.now() - tj < 5000, jk);
  out.push('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  console.log(out.join('\n')); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
