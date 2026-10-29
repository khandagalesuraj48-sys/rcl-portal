/* (29-10-2026) SPEAK INTO A BOX in a browser (the rig's Chromium; nothing of the live site): a page with boxes and this module's voice
 * script, a stand-in for the browser's speech recognition (it "hears" what the test says). The 🎙 in a box in use (not a password, a
 * date, a box only shown, data-novoice); words into a text box at the cursor, the number into a number box, the digits into a phone box;
 * the page sees it as typed (input, change); the language chips (kept); the microphone not allowed – what to do.   node test/voice.browser.test.js */
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const fs = require('fs'), path = require('path'), http = require('http');
// the voice script of this module's page (Mechanical, the Portal: the block inside the page between its two markers)
const V = (() => { const f = path.join(__dirname, '..', 'public', 'voice.js'); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const h = ['app/App.html', 'public/index.html'].map(x => path.join(__dirname, '..', x)).find(x => fs.existsSync(x) && fs.readFileSync(x, 'utf8').includes('/* (end of SPEAK INTO A BOX) */'));
  const a = fs.readFileSync(h, 'utf8'), i = a.indexOf('/* RCL ERP – SPEAK INTO A BOX'), j = a.indexOf('/* (end of SPEAK INTO A BOX) */'); return a.slice(i, j); })();
const page = `<!doctype html><html><head><meta charset="utf-8"></head><body style="padding:40px">
<input id="t" type="text" style="width:300px"> <input id="q" inputmode="decimal" style="width:80px"> <input id="n" type="number" style="width:200px"> <input id="ph" type="tel">
<input id="pw" type="password"> <input id="d" type="date"> <textarea id="ta"></textarea> <div data-novoice><input id="nv"></div> <input id="ro" readonly>
<script>window.__log=[];['t','q','n','ta'].forEach(i=>{const e=document.getElementById(i);e.addEventListener('input',()=>__log.push(i+':input:'+e.value));e.addEventListener('change',()=>__log.push(i+':change'));});
class FR { constructor(){ FR.last=this; } start(){ FR.started=(FR.started||0)+1; FR.langs=(FR.langs||[]).concat(this.lang); setTimeout(()=>{ const t=window.__say||''; if (window.__err) { this.onerror&&this.onerror({error:window.__err}); this.onend&&this.onend(); return; }
  const half=t.slice(0, Math.ceil(t.length/2)); this.onresult&&this.onresult({results:[[{transcript:half}]]}); setTimeout(()=>{ const r=[{transcript:t}]; r.isFinal=true; this.onresult&&this.onresult({results:[r]}); this.onend&&this.onend(); },60); },60); } abort(){ this.onend&&this.onend(); } stop(){} }
for (const k of ['SpeechRecognition','webkitSpeechRecognition']) Object.defineProperty(window, k, { value: FR, configurable: true, writable: true });</script><script>${V}</script></body></html>`;
const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(page); }).listen(Number(process.env.VPORT) || 3987);
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell' });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setViewport({ width: 1200, height: 700 });
  await p.goto('http://127.0.0.1:' + (Number(process.env.VPORT) || 3987) + '/', { waitUntil: 'load' });
  const vis = () => p.evaluate(() => { const x = document.getElementById('rclv_btn'); return !!x && getComputedStyle(x).display !== 'none'; });
  const talk = async (id, said) => { await p.evaluate(s => { window.__say = s; window.__err = ''; }, said); await p.focus('#' + id); await wait(100); await p.click('#rclv_btn'); await wait(400); return p.evaluate(i => document.getElementById(i).value, id); };
  await p.focus('#t'); await wait(100);
  ok('a text box in use: the 🎙 shows (inside its right end)', await vis());
  const r = await p.evaluate(() => { const a = document.getElementById('t').getBoundingClientRect(), b2 = document.getElementById('rclv_btn').getBoundingClientRect(); return [b2.left > a.left + a.width / 2, b2.right <= a.right + 1]; });
  ok('   inside the box, at its right end', r[0] && r[1], r);
  ok('a text box: the words said, typed in (input + change)', (await talk('t', 'सिमेंट बॅग')) === 'सिमेंट बॅग' && (await p.evaluate(() => __log.includes('t:input:सिमेंट बॅग') && __log.includes('t:change'))), await p.evaluate(() => __log));
  await p.evaluate(() => { const e = document.getElementById('t'); e.setSelectionRange(e.value.length, e.value.length); });
  ok('   said again: added after a space', (await talk('t', 'ACC कंपनी')) === 'सिमेंट बॅग ACC कंपनी');
  ok('a number box (inputmode decimal): "साडे तीन हजार" → 3500', (await talk('q', 'साडे तीन हजार')) === '3500');
  ok('   "बारा पॉइंट पाच" → 12.5 (the whole box: replaced)', (await talk('q', 'बारा पॉइंट पाच')) === '12.5');
  ok('   "डेढ़ सौ" → 150', (await talk('q', 'डेढ़ सौ')) === '150');
  ok('   "twenty five" → 25', (await talk('q', 'twenty five')) === '25');
  ok('a type=number box: "दीडशे बॅग" → 150', (await talk('n', 'दीडशे बॅग')) === '150');
  const before = await p.evaluate(() => document.getElementById('n').value);
  const v2 = await talk('n', 'सिमेंट');
  const tipTxt = await p.evaluate(() => document.getElementById('rclv_tip').innerText);
  ok('   no number in it: the box unchanged; "आकडा समजला नाही" with what was heard', v2 === before && /आकडा समजला नाही/.test(tipTxt) && /सिमेंट/.test(tipTxt), [v2, tipTxt]);
  ok('a phone box: the digits said one by one', (await talk('ph', 'नऊ आठ दोन शून्य एक')) === '98201');
  ok('a note (textarea): the words', (await talk('ta', 'पावसाच्या आधी हवे')) === 'पावसाच्या आधी हवे');
  for (const [id, what] of [['pw', 'a password'], ['d', 'a date'], ['nv', 'data-novoice'], ['ro', 'read only']]) { await p.focus('#' + id); await wait(150); ok('no 🎙 in ' + what, !(await vis())); }
  // the language: the chips; the one chosen is kept
  await p.evaluate(() => { window.__say = 'twelve'; }); await p.focus('#q'); await wait(100); await p.click('#rclv_btn'); await wait(30);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#rclv_tip [data-l]')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')));
  ok('while it listens: मराठी / हिंदी / English (मराठी first by itself)', JSON.stringify(chips) === JSON.stringify(['मराठी:true', 'हिंदी:false', 'English:false']), chips);
  await wait(400);
  await p.evaluate(() => { window.__say = 'fifteen'; }); await p.click('#rclv_btn'); await wait(20); await p.click('#rclv_tip [data-l="en"]'); await wait(500);
  const langs = await p.evaluate(() => [webkitSpeechRecognition.langs.slice(-2), localStorage.getItem('rcl-voice-lang'), document.getElementById('q').value]);
  ok('   English pressed: it listens again in en-IN, kept for the next time', langs[0][1] === 'en-IN' && langs[1] === 'en' && langs[2] === '15', langs);
  // the microphone not allowed
  await p.evaluate(() => { window.__err = 'not-allowed'; }); await p.focus('#t'); await wait(100); await p.click('#rclv_btn'); await wait(300);
  ok('the microphone not allowed: how to allow it (🔒 → Microphone → Allow)', /Microphone → Allow/.test(await p.evaluate(() => document.getElementById('rclv_tip').innerText)));
  ok('no fault on the page', errs.length === 0, errs);
  await p.setViewport({ width: 390, height: 800 }); await p.focus('#t'); await wait(150);
  ok('a phone\'s width: the 🎙 on the screen', await p.evaluate(() => { const x = document.getElementById('rclv_btn').getBoundingClientRect(); return x.left >= 0 && x.right <= innerWidth; }));
  await b.close(); srv.close();
  console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL stopped: ' + e.stack); process.exit(1); });
