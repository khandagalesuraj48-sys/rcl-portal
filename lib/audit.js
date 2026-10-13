/* The record of who did what in the Portal (sign-ins, users, access, sites …). It never stops the action it records. */
'use strict';
const { db } = require('./db');
async function audit(actor, action, target, detail) {
  try { await db('POST', 'audit', [{ actor: actor || '', action: action, target: target || '', detail: detail || null }], 'return=minimal'); }
  catch (e) { console.error('[audit] ' + String((e && e.message) || e)); }
}
module.exports = { audit };
