/* VERSIONS AND THE "MAKE STABLE" BUTTON (asked 02-11-2026: "jewa stable war jaych asel tewa mala version wise button de je dable ki
 * auto app updet push hoil stable war web updet hoil mhanje prateklk weli code changes nko ani tula sarkhe nko sangahla").
 * A VERSION is one release of the app's repository (rcl-mobile – GitHub Releases), made by its BETA release (the workflow "beta" on
 * the branch beta): a pre-release ("Beta" – only the testers' phones take it) whose notes carry what is new (English, मराठी, हिंदी)
 * and, in its hidden line <!-- rcl:{…} -->, the exact commits of the web modules the testers have (web: { repo: commit }).
 * MAKE STABLE (the Super Admin only, one version at a time):
 *   1. every repository is checked first: its main must be able to move FORWARD to the tested commit (nothing else on main that the
 *      version does not have) – one that cannot: nothing is done, it is said which and why;
 *   2. each web repository's main is moved to the tested commit (the very code the testers used – nothing is built anew from other
 *      code) → Vercel deploys it as the live site by itself; the app's repository last;
 *   3. the release becomes the stable one ("latest" when it has the app) → every phone's update takes it;
 *   4. every phone is told at once (the app repository's workflow "tell" – Firebase; the key stays a GitHub secret).
 * NEW BETA VERSION (the Super Admin, after the changes are in the branches "beta"): the app's workflow "beta" is asked to run – it
 * writes down each web module's beta commit, builds the app when the app changed, and makes the pre-release (the testers' phones told).
 * Pressing it again does nothing more (what is there already is skipped). Every press is in the Activity (who, which version, what
 * moved). Settings (Vercel, never in a file): GITHUB_RELEASE_TOKEN (a fine-grained token: Contents read-write on the ERP's
 * repositories, Actions read-write on the app's), GITHUB_OWNER, RCL_WEB_REPOS, RCL_APP_REPO; GITHUB_API only for the test rig. */
'use strict';
const { fail } = require('./http');
const API = () => String(process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const OWNER = () => String(process.env.GITHUB_OWNER || 'khandagalesuraj48-sys').trim();
const APP = () => String(process.env.RCL_APP_REPO || 'rcl-mobile').trim();
const WEB = () => String(process.env.RCL_WEB_REPOS || 'rclerp,rcl-portal,rcl-store,rcl-purchase,rcl-engineering').split(',').map(x => x.trim()).filter(x => /^[A-Za-z0-9_.-]{1,100}$/.test(x));
const TOKEN = () => String(process.env.GITHUB_RELEASE_TOKEN || '').trim();
const SHA = /^[0-9a-f]{40}$/;
const NAMES = { rclerp: 'Mechanical', 'rcl-portal': 'Portal', 'rcl-store': 'Store', 'rcl-purchase': 'Purchase', 'rcl-engineering': 'Engineering', 'rcl-mobile': 'App' };

async function gh(method, path, body) {
  const t = TOKEN();
  const r = await fetch(API() + path, { method, headers: Object.assign({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rcl-portal' },
    t ? { Authorization: 'Bearer ' + t } : {}, body === undefined ? {} : { 'Content-Type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    .catch(() => { throw fail(503, 'GitHub could not be reached – try again in a moment.', 'github'); });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
  return { status: r.status, ok: r.ok, j };
}
// the release's notes → what is new (the three languages) and the hidden line
function parse(rel) {
  const b = String(rel.body || '');
  const nw = (b.match(/<!-- rcl-new -->\s*([\s\S]*?)\s*<!-- \/rcl-new -->/) || [])[1] || '';
  let meta = {}; const m = b.match(/<!-- rcl:(\{[\s\S]*?\}) -->/); if (m) { try { meta = JSON.parse(m[1]); } catch (e) { meta = {}; } }
  const web = {}; Object.keys(meta.web || {}).forEach(k => { if (WEB().indexOf(k) > -1 && SHA.test(String(meta.web[k]))) web[k] = String(meta.web[k]); });
  const appSha = SHA.test(String(rel.target_commitish || '')) ? String(rel.target_commitish) : SHA.test(String(meta.app || '')) ? String(meta.app) : '';
  const hasApk = (rel.assets || []).some(a => /\.apk$/.test(String(a.name || '')));
  return { new: nw, version: String(meta.version || ''), build: Number(meta.build) || 0, web, appSha, hasApk };
}
const view = (rel, latestId) => { const p = parse(rel);
  return { tag: rel.tag_name, name: rel.name, at: rel.published_at || rel.created_at, beta: !!rel.prerelease, stable: rel.id === latestId, version: p.version, build: p.build, new: p.new, app: p.hasApk,
    web: Object.keys(p.web).map(k => NAMES[k] || k) }; };

// the versions: the newest 30 (beta ones and stable ones); the stable one in use – the newest that is not beta – is marked
// (a version of the web only – no app in it – is stable without becoming GitHub's "latest": the phones' update always finds an app)
async function list() {
  const a = await gh('GET', '/repos/' + OWNER() + '/' + APP() + '/releases?per_page=30');
  if (!a.ok) throw fail(502, 'GitHub did not give the versions (' + a.status + ').', 'github');
  const rels = (a.j || []).filter(r => !r.draft);
  const st = rels.filter(r => !r.prerelease).map(r => ({ id: r.id, b: parse(r).build })).sort((x, y) => y.b - x.b)[0] || null;
  const stableBuild = st ? st.b : 0, rows = rels.map(r => view(r, st ? st.id : null));
  rows.forEach(r => { r.canMakeStable = r.beta && r.build > stableBuild; });
  return { versions: rows, stableBuild, token: !!TOKEN() };
}
// one repository: can main go forward to this commit? 'move' | 'already' | a reason it cannot
async function planOne(repo, sha) {
  const c = await gh('GET', '/repos/' + OWNER() + '/' + repo + '/compare/main...' + sha);
  if (c.status === 404) return { repo, sha, step: 'stop', why: 'the tested commit is not in ' + repo };
  if (!c.ok || !c.j) return { repo, sha, step: 'stop', why: 'GitHub did not compare ' + repo + ' (' + c.status + ')' };
  if (c.j.status === 'ahead') return { repo, sha, step: 'move', commits: c.j.ahead_by };
  if (c.j.status === 'identical' || c.j.status === 'behind') return { repo, sha, step: 'already' };
  return { repo, sha, step: 'stop', why: repo + '\'s main has changes this version does not have (' + c.j.status + ') – they must go through beta first' };
}
/* MAKE STABLE: tag → { ok, moved: [repo], already: [repo], app, told } (or nothing done and why) */
async function makeStable(tag, lock) {
  if (!TOKEN()) throw fail(400, 'The Portal has no GitHub key yet: GITHUB_RELEASE_TOKEN in Vercel (the Portal) – the one-time set-up says how.', 'token');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(String(tag || ''))) throw fail(400, 'Which version?');
  const r = await gh('GET', '/repos/' + OWNER() + '/' + APP() + '/releases/tags/' + encodeURIComponent(tag));
  if (!r.ok || !r.j) throw fail(404, 'Version ' + tag + ' is not there.', 'gone');
  const rel = r.j, p = parse(rel);
  const plan = await Promise.all(Object.keys(p.web).map(k => planOne(k, p.web[k])).concat(p.appSha ? [planOne(APP(), p.appSha)] : []));
  const stop = plan.filter(x => x.step === 'stop');
  if (stop.length) throw fail(409, 'Nothing was changed. ' + stop.map(x => x.why).join('; ') + '.', 'cannot');
  return lock(async () => {
    const moved = [], already = plan.filter(x => x.step === 'already').map(x => x.repo);
    // the web first (the new app may need the new servers), the app's own repository last
    for (const x of plan.filter(y => y.step === 'move' && y.repo !== APP()).concat(plan.filter(y => y.step === 'move' && y.repo === APP()))) {
      const u = await gh('PATCH', '/repos/' + OWNER() + '/' + x.repo + '/git/refs/heads/main', { sha: x.sha, force: false });
      if (!u.ok) throw fail(502, (moved.length ? 'Moved: ' + moved.join(', ') + '. Then ' : '') + x.repo + ' could not be moved (' + u.status + ') – press again in a minute (what is done is kept).', 'github');
      moved.push(x.repo);
    }
    // (the stable one in use – asked again even when it already is: the same answer). With an app in it: GitHub's "latest" – every
    // phone's update takes it; a version of the web only stays out of "latest" (the phones' update must always find an app there)
    const e = await gh('PATCH', '/repos/' + OWNER() + '/' + APP() + '/releases/' + rel.id, { prerelease: false, make_latest: p.hasApk ? 'true' : 'false' });
    if (!e.ok) throw fail(502, 'The web is live (' + (moved.join(', ') || 'nothing to move') + '), but the app\'s version could not be made stable (' + e.status + ') – press again.', 'github');
    const made = !!rel.prerelease;
    // the phones are told once – when this press made it stable (pressed again: not told twice)
    let told = false;
    if (p.hasApk && made) {
      const w = await gh('POST', '/repos/' + OWNER() + '/' + APP() + '/actions/workflows/tell.yml/dispatches', { ref: 'main', inputs: { version: p.version || String(rel.tag_name), build: String(p.build || ''), topic: 'rcl-app-update' } });
      told = w.ok;
    }
    return { ok: true, tag: rel.tag_name, version: p.version, build: p.build, moved: moved.map(x => NAMES[x] || x), already: already.map(x => NAMES[x] || x), app: p.hasApk, made: made, told: told };
  });
}
/* NEW BETA VERSION: the app's workflow "beta" (on its branch beta) is asked to run → { ok } – the version shows in the list when it
 * is made (about 10 – 15 minutes; it says on GitHub → Actions why if it is not) */
async function betaNew() {
  if (!TOKEN()) throw fail(400, 'The Portal has no GitHub key yet: GITHUB_RELEASE_TOKEN in Vercel (the Portal) – the one-time set-up says how.', 'token');
  const w = await gh('POST', '/repos/' + OWNER() + '/' + APP() + '/actions/workflows/beta.yml/dispatches', { ref: 'beta' });
  if (!w.ok) throw fail(502, 'GitHub did not start the beta build (' + w.status + (w.j && w.j.message ? ': ' + String(w.j.message).slice(0, 120) : '') + ').', 'github');
  return { ok: true };
}
module.exports = { list, makeStable, betaNew, parse, planOne, NAMES };
