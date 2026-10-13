/* Small helpers every endpoint uses: read the body, answer in JSON, refuse requests from other web pages. */
'use strict';

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || ''; } }
const fail = (status, message, code) => new HttpError(status, message, code);

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || '{}')); } catch (e) { return Promise.reject(fail(400, 'Bad request.')); }
  }
  return new Promise((resolve, reject) => {
    let b = ''; req.setEncoding('utf8');
    req.on('data', d => { b += d; if (b.length > 200000) { reject(fail(413, 'Too much data.')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(fail(400, 'Bad request.')); } });
    req.on('error', reject);
  });
}
function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(obj));
}
function redirect(res, location, headers) {
  res.statusCode = 302; res.setHeader('Location', location); res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end();
}
// a change may come only from the Portal's own page: our header is required (a form on another site cannot set it) and,
// when the browser names the page it came from, that must be this site
function sameSite(req) {
  if (String(req.headers['x-rcl'] || '') !== '1') throw fail(403, 'Refused: this request did not come from the Portal page.');
  const origin = String(req.headers.origin || ''); if (!origin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  let oh = ''; try { oh = new URL(origin).host; } catch (e) { oh = ''; }
  // ONE ADDRESS: the Portal is also served under the main address (<main>/portal) – that page is this site too
  if (oh !== host && oh !== publicHost()) throw fail(403, 'Refused: this request came from another web page.');
}
// the Portal's own public address (PUBLIC_URL, e.g. https://oneclicksolution-erp.vercel.app/portal) – '' when not set
const publicUrl = () => { const u = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) ? u : ''; };
const publicHost = () => { try { return publicUrl() ? new URL(publicUrl()).host : ''; } catch (e) { return ''; } };
const query = req => new URL(req.url || '/', 'http://x').searchParams;
const origin = req => (String(req.headers['x-forwarded-proto'] || '') === 'https' || process.env.VERCEL ? 'https' : 'http') + '://' + String(req.headers['x-forwarded-host'] || req.headers.host || '');
// one endpoint = one function; every error becomes a clear answer (the details of a fault go to the server's log only)
const handler = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code || undefined });
    console.error('[portal] ' + String((e && e.stack) || e));
    send(res, 500, { error: 'The Portal hit a fault – please try again. If it stays, tell the Super Admin.' });
  }
};
module.exports = { HttpError, fail, readBody, send, redirect, sameSite, query, origin, publicUrl, handler };
