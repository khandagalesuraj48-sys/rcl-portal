/* THE BETA CHANNEL (asked 02-11-2026: "ethun pudhe je kahi asel agodr testing hoil as like beta version … mi kahi user la testing
 * sathi deu shakel nantr … other la pn app web stable deu shakel … je cuurent chalu aahe te bighdnar nahi").
 * A TESTER (users.tester – ticked by the Super Admin) opens the BETA copy of every module that has one (modules.beta_url): the web
 * through /api/go, the app through the module links of its sign-in (the same list). Everybody else opens the stable copy, as today.
 * The beta copies work on the same (live) data – what a tester saves is real. Without the Portal's step 7 (the two columns): nobody is
 * a tester and no module has a beta link – everything as before. */
'use strict';
const { db, enc } = require('./db');
const noCol = (e, col) => new RegExp('42703|' + col).test(String((e && e.message) || e));
async function isTester(email) {
  try { const r = ((await db('GET', 'users?select=tester&email=eq.' + enc(email))) || [])[0]; return !!(r && r.tester); }
  catch (e) { if (noCol(e, 'tester')) return false; throw e; }
}
async function modules() {
  try { return await db('GET', 'modules?select=key,name,url,beta_url,status,sort&order=sort.asc,key.asc'); }
  catch (e) { if (noCol(e, 'beta_url')) return db('GET', 'modules?select=key,name,url,status,sort&order=sort.asc,key.asc'); throw e; }
}
// the address a person opens a module at: a tester the beta copy (when the module has one), everybody else the stable one
const urlFor = (m, tester) => (tester && m.beta_url ? m.beta_url : m.url);
// step 7 there? (the Super Admin's pages say what to run when it is not)
async function step7() { try { await db('GET', 'users?select=tester&limit=1'); await db('GET', 'modules?select=beta_url&limit=1'); return true; } catch (e) { if (noCol(e, 'tester') || noCol(e, 'beta_url')) return false; throw e; } }
const STEP7 = 'The beta channel needs the Portal\'s database step 7 first: run sql/portal_step7_beta.sql once in the Portal\'s Supabase → SQL Editor, then try again.';
module.exports = { isTester, modules, urlFor, step7, STEP7 };
