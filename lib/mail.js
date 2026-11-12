/* E-MAIL from the Portal's server – only the sign-in codes (12-11-2026). Sent with Resend (https://resend.com) from the server:
 * the key (RESEND_API_KEY) and the sender (OTP_FROM, an address of the verified domain, e.g. no-reply@oneclicksolution.online) are
 * Vercel settings of the PORTAL's project – never in a file, never in the page, never in a log. Nothing else is ever mailed. */
'use strict';
const API = () => String(process.env.RESEND_URL || 'https://api.resend.com').replace(/\/+$/, '');
const FROM_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// '' when the mail can be sent; else what is missing (for the Super Admin's eyes – no value of a setting is ever shown)
function missing() {
  if (!String(process.env.RESEND_API_KEY || '').trim()) return 'RESEND_API_KEY is not set in the Portal\'s Vercel project.';
  if (!FROM_RE.test(String(process.env.OTP_FROM || '').trim())) return 'OTP_FROM (the sender\'s address, e.g. no-reply@<the verified domain>) is not set in the Portal\'s Vercel project.';
  return '';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// the letter of a code: what it is for, the code, how long it lives, the warning – English, Marathi, Hindi
function letter(code, what, minutes) {
  const login = what === 'login', title = login ? 'Your sign-in code' : 'Verify your e-mail';
  const lines = [login ? 'Use this code to sign in to RCL ERP.' : 'Use this code to confirm that this e-mail address is yours in RCL ERP.',
    login ? 'RCL ERP मध्ये sign in करण्यासाठी हा code वापरा.' : 'RCL ERP मध्ये हा e-mail तुमचाच आहे हे निश्चित करण्यासाठी हा code वापरा.',
    login ? 'RCL ERP में sign in करने के लिए यह code इस्तेमाल करें।' : 'RCL ERP में यह e-mail आपका ही है, यह पक्का करने के लिए यह code इस्तेमाल करें।'];
  const warn = ['It is valid for ' + minutes + ' minutes and works once. Never tell this code to anybody – nobody of RCL will ask for it. If you did not ask for it, ignore this e-mail.',
    'हा code ' + minutes + ' मिनिटे चालतो आणि एकदाच वापरता येतो. हा code कोणालाही सांगू नका – RCL मधून कोणीही तो मागणार नाही. तुम्ही मागितला नसेल तर हा e-mail सोडून द्या.',
    'यह code ' + minutes + ' मिनट चलता है और एक ही बार काम करता है। यह code किसी को न बताएँ – RCL से कोई इसे नहीं माँगेगा। आपने नहीं माँगा तो इस e-mail को छोड़ दें।'];
  const text = 'RCL ERP – ' + title + '\n\n' + code + '\n\n' + lines.join('\n') + '\n\n' + warn.join('\n') + '\n\nRachana Construction Limited · One Click Solution';
  const html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A1B44">' +
    '<p style="font-size:13px;letter-spacing:1px;color:#566589;margin:0 0 6px">RCL ERP · ONE CLICK SOLUTION</p><h1 style="font-size:22px;margin:0 0 14px">' + esc(title) + '</h1>' +
    '<p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#F1F5FD;border-radius:14px;padding:18px 0;text-align:center;margin:0 0 16px">' + esc(code) + '</p>' +
    lines.map(l => '<p style="font-size:15px;line-height:1.5;margin:0 0 4px">' + esc(l) + '</p>').join('') +
    '<div style="margin-top:16px;padding:12px 14px;background:#FFF6E5;border-radius:12px">' + warn.map(l => '<p style="font-size:13px;line-height:1.5;margin:0 0 4px;color:#7A4B00">' + esc(l) + '</p>').join('') + '</div>' +
    '<p style="font-size:12px;color:#8A94A8;margin:18px 0 0">Rachana Construction Limited</p></div>';
  return { subject: 'RCL ERP – ' + title + ': ' + code, text: text, html: html };
}
// sends one code; { ok } or { ok: false, why } – never throws, never writes the code or the key anywhere
async function sendCode(to, code, what, minutes) {
  const m = missing(); if (m) return { ok: false, why: 'not set up' };
  const l = letter(code, what, minutes);
  try {
    const r = await fetch(API() + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + String(process.env.RESEND_API_KEY).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'RCL ERP <' + String(process.env.OTP_FROM).trim() + '>', to: [to], subject: l.subject, text: l.text, html: l.html }), signal: AbortSignal.timeout(12000) });
    if (r.ok) return { ok: true };
    return { ok: false, why: 'mail service ' + r.status };
  } catch (e) { return { ok: false, why: 'mail service not reached' }; }
}
module.exports = { missing, sendCode, letter };
