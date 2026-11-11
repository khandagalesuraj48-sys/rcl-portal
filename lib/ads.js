/* THE ADVERTISE CORNER – its rules, with no database in them (11-11-2026; sql/portal_step8_ads.sql):
 * what a post may be, and whether it shows NOW for a place (app / web), a site and a company.
 * The clock is India's (Asia/Kolkata) for everybody: a post "from 06:00 to 23:00" means those hours at the sites. */
'use strict';
const { fail } = require('./http');
const KINDS = ['festival', 'birthday', 'achievement', 'notice', 'campaign'], SIZES = ['strip', 'banner', 'card', 'full'];
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_BYTES = 25 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, PATH = /^[0-9]{4}\/[a-f0-9]{24}\.(jpg|png|webp|gif|mp4|webm)$/;
const realDate = s => DATE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const mediaOf = p => /\.(mp4|webm)$/.test(p) ? 'video' : 'image';
/* (12-11-2026, step 9) ONE SIZE: THE STRIP – wide and low on the web, as wide as the phone in the app. Its shape (width ÷ height)
 * is fixed in each place, so what the Super Admin sees while fitting is what everybody sees on any screen. */
const RATIO = { web: 12.8, app: 3.42 };      // 1920 × 150 · 1080 × 316
// how a post sits in the strip, for the web and for the app: x, y = the part kept in view (0 – 100 %), z = how much bigger (1 – 4)
function fitOf(f) {
  const num = (v, d, a, b) => { v = Number(v); return v >= a && v <= b ? Math.round(v * 100) / 100 : d; };
  const one = o => { o = o && typeof o === 'object' ? o : {}; return { x: num(o.x, 50, 0, 100), y: num(o.y, 50, 0, 100), z: num(o.z, 1, 1, 4) }; };
  f = f && typeof f === 'object' ? f : {};
  /* (12-11-2026, asked: "mi jr insta warun kahi vedio download krto ani tyana set krto … tya patticha size wadhwata yeil as banw … web
   * sathi ha option nko fkt android and ios app sathi") IN THE APP ONLY the strip of a post can be made higher: r = its shape there
   * (width ÷ height) – from the strip (3.42) to an upright video (0.56 = 9 : 16). The web's strip stays as it is. */
  const app = one(f.app); app.r = num(f.app && typeof f.app === 'object' ? f.app.r : undefined, RATIO.app, 0.56, RATIO.app);
  return { web: one(f.web), app };
}
const fitPlain = f => { f = fitOf(f); return ['web', 'app'].every(k => f[k].x === 50 && f[k].y === 50 && f[k].z === 1) && f.app.r === RATIO.app; };

// India's date, hour and day of the week (1 = Monday … 7 = Sunday) at [ms]
function india(ms) {
  const d = new Date((ms === undefined ? Date.now() : ms) + 330 * 60000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), day: d.getUTCDay() === 0 ? 7 : d.getUTCDay() };
}
// what the Super Admin typed → a row as the table keeps it; a wrong value is refused with the words for him
function clean(x) {
  x = x || {};
  const title = String(x.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) throw fail(400, 'Give the post a name.');
  const kind = String(x.kind || ''), size = 'strip';      // (step 9) one size only
  if (!KINDS.includes(kind)) throw fail(400, 'Choose the kind of post.');
  const path = String(x.path || ''), poster = String(x.poster || '');
  if (!PATH.test(path)) throw fail(400, 'Add the image or the video first.');
  if (poster && (!PATH.test(poster) || mediaOf(poster) !== 'image')) throw fail(400, 'The still picture of the video must be an image.');
  const onApp = x.onApp === true, onWeb = x.onWeb === true;
  if (!onApp && !onWeb) throw fail(400, 'Choose where it shows: App, Web or both.');
  const from = String(x.from || ''), to = String(x.to || '');
  if (!realDate(from) || !realDate(to)) throw fail(400, 'Give the period: from which date to which date.');
  if (to < from) throw fail(400, 'The period ends before it starts.');
  const days = Array.from(new Set(String(x.days || '').split('').filter(c => /[1-7]/.test(c)))).sort().join('');
  if (!days) throw fail(400, 'Choose at least one day of the week.');
  const tf = String(x.timeFrom || '00:00'), tt = String(x.timeTo || '23:59');
  if (!TIME.test(tf) || !TIME.test(tt)) throw fail(400, 'Give the hours as 06:00 and 23:00.');
  if (tt <= tf) throw fail(400, 'The hours end before they start.');
  const seconds = Math.round(Number(x.seconds));
  if (!(seconds >= 3 && seconds <= 60)) throw fail(400, 'A slide stays 3 to 60 seconds.');
  const sites = Array.from(new Set((Array.isArray(x.sites) ? x.sites : []).map(s => String(s || '').trim()).filter(Boolean))).slice(0, 200);
  return { title, kind, media: mediaOf(path), path, poster: poster || null, size, on_app: onApp, on_web: onWeb, date_from: from, date_to: to, days,
    time_from: tf, time_to: tt, seconds, sites, company: String(x.company || '').trim().slice(0, 120), active: x.active !== false, fit: fitOf(x.fit) };
}
// does this post show now? [where] = { platform: 'app' | 'web', site, company }, [at] = india()
function live(r, where, at) {
  if (!r || r.active === false) return false;
  if (where.platform === 'app' ? !r.on_app : !r.on_web) return false;
  if (at.date < String(r.date_from) || at.date > String(r.date_to)) return false;
  if (!String(r.days || '').includes(String(at.day))) return false;
  const tf = String(r.time_from || '00:00').slice(0, 5), tt = String(r.time_to || '23:59').slice(0, 5);
  if (at.time < tf || at.time > tt) return false;
  if (Array.isArray(r.sites) && r.sites.length && !r.sites.includes(where.site)) return false;
  if (r.company && r.company !== where.company) return false;
  return true;
}
module.exports = { KINDS, SIZES, TYPES, MAX_BYTES, PATH, RATIO, india, clean, live, mediaOf, fitOf, fitPlain };
