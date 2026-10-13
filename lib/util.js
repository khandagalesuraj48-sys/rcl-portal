'use strict';
const crypto = require('crypto');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const lc = s => String(s === undefined || s === null ? '' : s).trim().toLowerCase();
const clean = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);
// a code the Super Admin writes down once: 16 letters / digits in 4 groups (no 0 / O / 1 / I) – the same as in Mechanical
function recoveryCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.randomBytes(16); let s = '';
  for (let i = 0; i < 16; i++) s += A[b[i] % A.length];
  return s.match(/.{4}/g).join('-');
}
const codeClean = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// a module's link: https only (http only for this computer, for tests)
const okUrl = u => /^https:\/\/[^\s"'<>]{4,300}$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s"'<>]*)?$/.test(u);
module.exports = { EMAIL, lc, clean, recoveryCode, codeClean, GSTIN, PAN, okUrl };
