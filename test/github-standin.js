/* A STAND-IN FOR GITHUB on the local test rig (the "Make stable" button's calls) – nothing reaches GitHub.
 * Each repository has a straight line of commits and its main points at one of them; releases of the app's repository.
 *   GH_PORT (3063) · GH_TOKEN (the key it accepts) · POST /__setup { repos: { name: { commits: [sha…], main: i } }, releases: […], latest: id }
 *   GET /__state (refs, releases, the workflows asked to run) */
'use strict';
const http = require('http');
const PORT = Number(process.env.GH_PORT || 3063), TOKEN = String(process.env.GH_TOKEN || 'rig-github-token');
let S = { repos: {}, releases: [], latest: null, dispatches: [], calls: [] };
const json = (res, st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
http.createServer((req, res) => {
  let body = ''; req.on('data', d => { body += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
    if (p === '/__setup') { const x = JSON.parse(body || '{}'); S = { repos: x.repos || {}, releases: x.releases || [], latest: x.latest || null, dispatches: [], calls: [] }; return json(res, 200, { ok: true }); }
    if (p === '/__state') return json(res, 200, S);
    S.calls.push(m + ' ' + p);
    const write = m !== 'GET';
    if (write && String(req.headers.authorization || '') !== 'Bearer ' + TOKEN) return json(res, 401, { message: 'Bad credentials' });
    let a;
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/releases$/)) && m === 'GET') return json(res, 200, S.releases.slice().reverse());
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/releases\/latest$/))) { const r = S.releases.find(x => x.id === S.latest); return r ? json(res, 200, r) : json(res, 404, { message: 'Not Found' }); }
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/releases\/tags\/(.+)$/))) { const r = S.releases.find(x => x.tag_name === decodeURIComponent(a[2])); return r ? json(res, 200, r) : json(res, 404, { message: 'Not Found' }); }
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/releases\/(\d+)$/)) && m === 'PATCH') {
      const r = S.releases.find(x => x.id === Number(a[2])); if (!r) return json(res, 404, { message: 'Not Found' });
      const x = JSON.parse(body || '{}'); if (x.prerelease !== undefined) r.prerelease = x.prerelease; if (x.make_latest === 'true') S.latest = r.id;
      return json(res, 200, r);
    }
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/compare\/main\.\.\.([0-9a-f]{40})$/))) {
      const R = S.repos[a[1]]; if (!R) return json(res, 404, { message: 'Not Found' });
      const i = R.commits.indexOf(a[2]); if (i < 0) return json(res, 404, { message: 'Not Found' });
      if (R.diverged) return json(res, 200, { status: 'diverged', ahead_by: 1, behind_by: 1 });
      return json(res, 200, i > R.main ? { status: 'ahead', ahead_by: i - R.main, behind_by: 0 } : i === R.main ? { status: 'identical', ahead_by: 0, behind_by: 0 } : { status: 'behind', ahead_by: 0, behind_by: R.main - i });
    }
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/git\/refs\/heads\/main$/)) && m === 'PATCH') {
      const R = S.repos[a[1]], x = JSON.parse(body || '{}'); if (!R) return json(res, 404, { message: 'Not Found' });
      const i = R.commits.indexOf(x.sha); if (i < 0) return json(res, 422, { message: 'Object does not exist' });
      if (i < R.main || R.diverged) return json(res, 422, { message: 'Update is not a fast forward' });
      if (R.fail) return json(res, 500, { message: 'rig: refused on purpose' });
      R.main = i; return json(res, 200, { ref: 'refs/heads/main', object: { sha: x.sha } });
    }
    if ((a = p.match(/^\/repos\/[^/]+\/([^/]+)\/actions\/workflows\/([^/]+)\/dispatches$/)) && m === 'POST') { S.dispatches.push({ repo: a[1], workflow: a[2], body: JSON.parse(body || '{}') }); return json(res, 204); }
    json(res, 404, { message: 'Not Found' });
  });
}).listen(PORT, '127.0.0.1', () => console.log('github stand-in on ' + PORT));
