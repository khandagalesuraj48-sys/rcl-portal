/* GET /api/jwks – the Portal's PUBLIC key(s). A module checks a ticket's signature with it. Nothing secret is here. */
'use strict';
const { handler, send } = require('../lib/http');
const keys = require('../lib/keys');
module.exports = handler(async (req, res) => {
  const k = await keys.jwks();
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(k));
  void send;
});
