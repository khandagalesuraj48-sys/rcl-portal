// Local server for tests: the page from public/, the endpoints from api/ – the way Vercel serves them.
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY and PORTAL_SECRET in the environment (never in a file of this repository).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const port = Number(process.env.PORT) || 3010;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const m = /^\/api\/([a-z][a-z-]*)$/.exec(p);
  if (m) { const f = path.join(__dirname, 'api', m[1] + '.js'); if (fs.existsSync(f)) return require(f)(req, res); res.statusCode = 404; return res.end('{"error":"Not found."}'); }
  const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('Portal on http://127.0.0.1:' + port));
