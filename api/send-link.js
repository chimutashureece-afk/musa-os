// Vercel serverless function: sends Musa OS's own, branded sign-in email (instead of Firebase's
// plain one) through Resend, from your own domain — which is what keeps it out of spam.
//
// Vercel → Settings → Environment Variables:
//   FIREBASE_SERVICE_ACCOUNT  the whole JSON from Firebase → Project settings → Service accounts → Generate new private key
//   RESEND_API_KEY            from resend.com (free: 3,000 emails a month)
//   MAIL_FROM                 e.g.  Musa OS <hello@musaos.co.zw>   (a domain you've verified in Resend)
//   VITE_BRANDED_EMAIL = 1    tells the website to use this function
import admin from 'firebase-admin';
import crypto from 'node:crypto';

const OWNERS = ['chimutashureece@gmail.com', 'chimutashutanatswa13@gmail.com'];
const PER_HOUR = 5;

function app() {
  if (admin.apps.length) return admin.app();
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  return admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailHtml({ link, purpose, type, site }) {
  const owner = purpose === 'owner';
  const title = owner ? 'Your Musa OS console link' : 'Your Musa OS demo is ready';
  const lead = owner
    ? 'Tap the button to sign in to the Musa OS owner console on this device.'
    : `Tap the button to open your ${type === 'primary' ? 'primary' : 'secondary'} demo school. It’s yours for one day from when you open it — set up classes, enrol learners, take a register and see report cards.`;
  const button = owner ? 'Open the console' : 'Open my demo school';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f7f5;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#131b18">
<div style="display:none;max-height:0;overflow:hidden">${esc(lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f5;padding:32px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dfe5e2">
    <tr><td style="background:#032619;padding:22px 28px">
      <img src="${site}/icon-192.png" width="36" height="36" alt="" style="vertical-align:middle;border-radius:8px;background:#fff">
      <span style="vertical-align:middle;margin-left:10px;font-size:20px;font-weight:700;color:#ffffff">Musa<span style="color:#33bb68">OS</span></span>
    </td></tr>
    <tr><td style="padding:30px 28px 8px">
      <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#131b18">${esc(title)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5953">${esc(lead)}</p>
      <a href="${esc(link)}" style="display:inline-block;background:#0c532c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:10px">${esc(button)}</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#647570">The link works once and expires in an hour. If the button doesn’t work, copy this into your browser:<br><span style="word-break:break-all;color:#0c532c">${esc(link)}</span></p>
    </td></tr>
    <tr><td style="padding:22px 28px 26px;font-size:12px;line-height:1.6;color:#8f9f97;border-top:1px solid #edf1ef">
      You’re getting this because someone entered this address on ${esc(new URL(site).host)}. If it wasn’t you, ignore this email — nothing happens without the link.<br>
      Musa OS · School management from ECD to A-Level
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const emailText = ({ link, purpose }) =>
  `${purpose === 'owner' ? 'Sign in to the Musa OS console' : 'Your Musa OS demo is ready'}\n\nOpen this link (it works once and expires in an hour):\n${link}\n\nIf you didn't ask for this, ignore this email.\n— Musa OS`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return res.status(501).json({ error: 'Branded email is not configured on this deployment.' });
  }
  try {
    const { email, purpose, type, continueUrl } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
    if (!['demo', 'owner'].includes(purpose)) return res.status(400).json({ error: 'Unknown request.' });
    if (purpose === 'owner' && !OWNERS.includes(mail)) return res.status(403).json({ error: 'That email isn’t one of the Musa OS owners.' });

    // only send links back to this same site
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const site = `https://${host}`;
    const target = new URL(continueUrl || site);
    if (target.host !== host) return res.status(400).json({ error: 'Bad link address.' });

    // simple abuse guard: a few emails per address per hour
    const db = app().firestore();
    const key = crypto.createHash('sha256').update(mail).digest('hex').slice(0, 32);
    const ref = db.collection('mailLog').doc(key);
    const now = Date.now();
    const recent = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const times = (snap.exists ? snap.data().times || [] : []).filter((x) => now - x < 3600_000);
      if (times.length >= PER_HOUR) return null;
      t.set(ref, { times: [...times, now] });
      return times.length + 1;
    });
    if (recent === null) return res.status(429).json({ error: 'Too many emails to this address. Try again in an hour.' });

    const link = await app().auth().generateSignInWithEmailLink(mail, { url: target.toString(), handleCodeInApp: true });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [mail],
        subject: purpose === 'owner' ? 'Your Musa OS console link' : 'Your Musa OS demo school is ready',
        html: emailHtml({ link, purpose, type, site }),
        text: emailText({ link, purpose }),
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
      }),
    });
    if (!r.ok) { console.error('resend', r.status, await r.text()); return res.status(502).json({ error: 'The email service didn’t accept the message. Try again shortly.' }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    const code = e && e.code;
    if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') return res.status(400).json({ error: 'Add this site under Firebase → Authentication → Settings → Authorized domains.' });
    return res.status(500).json({ error: 'Could not send the email. Try again in a minute.' });
  }
}
