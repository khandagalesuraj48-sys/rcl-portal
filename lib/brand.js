/* THE BRAND – its rules, with no database in them (14-11-2026; sql/portal_step13_brand.sql).
 * The product ("Sketchline Lion": two parts of the name, a line under it), its logo, the opening screen's photo and one logo for each
 * client company are kept in the Portal and changed by the Super Admin – the web and the app ask for them; nothing is in the code
 * but the name and logo shown until the Portal answers (and while step 13 is not run). */
'use strict';
const { fail } = require('./http');
const DEFAULT = { first: 'Sketchline', second: 'Lion', line: 'Integrated Construction Management' };
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const NAME = /^(logo|photo|co-[A-Z0-9]{1,20})$/;
const MAX = { logo: 400 * 1024, photo: 1000 * 1024, co: 400 * 1024 };      // bytes of the picture itself
const one = (v, n) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// what the Super Admin typed → the row; a wrong value is refused with the words for him
function clean(x) {
  x = x || {};
  const first = one(x.first, 24), second = one(x.second, 24), line = one(x.line, 60);
  if (!first) throw fail(400, 'Type the name of the product (its first word).');
  return { first, second, line };
}
const nameOf = b => (b.first + ' ' + b.second).trim();
// a picture as it was sent: { name, mime, data (base64) } → checked
function file(x) {
  x = x || {};
  const name = String(x.name || ''), mime = String(x.mime || ''), data = String(x.data || '').replace(/\s+/g, '');
  if (!NAME.test(name)) throw fail(400, 'This picture has no place in the brand.');
  if (TYPES.indexOf(mime) < 0) throw fail(400, 'A logo or photo must be a PNG, JPG or WebP picture.');
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail(400, 'This picture could not be read – choose it again.');
  const bytes = Math.floor(data.length * 3 / 4), max = MAX[name.slice(0, 2) === 'co' ? 'co' : name];
  if (bytes > max) throw fail(400, 'This picture is ' + Math.ceil(bytes / 1024) + ' KB – at most ' + Math.round(max / 1024) + ' KB here. Choose a smaller one.');
  const head = Buffer.from(data.slice(0, 24), 'base64'), sig = head.toString('latin1');
  const ok = mime === 'image/png' ? sig.slice(1, 4) === 'PNG' : mime === 'image/jpeg' ? head[0] === 0xff && head[1] === 0xd8 : sig.slice(0, 4) === 'RIFF' && sig.slice(8, 12) === 'WEBP';
  if (!ok) throw fail(400, 'This file is not the kind of picture its name says – choose a PNG, JPG or WebP picture.');
  return { name, mime, data };
}
// what everybody is told: the name, the line and which pictures there are – each with a stamp, so a changed one is fetched again
function view(row, files) {
  const b = row && row.first ? { first: String(row.first), second: String(row.second || ''), line: String(row.line || '') } : Object.assign({}, DEFAULT);
  const v = t => String(Date.parse(t || '') || 0), f = {}, co = {};
  (files || []).forEach(x => { if (x.name === 'logo' || x.name === 'photo') f[x.name] = v(x.updated_at); else if (/^co-/.test(x.name)) co[x.name.slice(3)] = v(x.updated_at); });
  return { name: nameOf(b), first: b.first, second: b.second, line: b.line, logo: f.logo || '', photo: f.photo || '', companies: co };
}
module.exports = { DEFAULT, TYPES, NAME, MAX, clean, file, view, nameOf };
