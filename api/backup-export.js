/* (with Mechanical's update-157) the Portal's data for the backup – only for Mechanical's backup, asked with BACKUP_EXPORT_SECRET
 * (lib/bkexport.js). Into the Portal's own numbered Google Sheets: users (passwords and recovery codes "(hidden)"), access, sites,
 * companies, modules and the Super Admin's record (Activity). Sign-ins, counters and signing keys are never given. */
'use strict';
const { handler, readBody, send, fail } = require('../lib/http');
const { allowed, make } = require('../lib/bkexport');
const TABLES = {
  users: { title: 'Users', key: 'email', hide: ['password_hash', 'recovery_hash'], cols: ['email', 'name', 'active', 'is_super', 'start_item', 'last_login_at', 'created_at', 'updated_at'] },
  access: { title: 'Access', key: 'email,site,module' },
  sites: { title: 'Sites', key: 'code' },
  companies: { title: 'Companies', key: 'id' },
  modules: { title: 'Modules', key: 'key' },
  audit: { title: 'Activity', key: 'id', since: 'at' },
};
const run = make(TABLES, { site: false, usageStep: 'sql/portal_step4_usage.sql' });      // (update-158) usage: Sites → Storage
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  allowed(req);
  const c = { url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: String(process.env.SUPABASE_SECRET_KEY || '') };
  if (!c.url || !c.key) throw fail(500, 'The Portal server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel.');
  send(res, 200, await run(c, await readBody(req)));
});
module.exports.TABLES = TABLES;
