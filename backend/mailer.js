const nodemailer = require('nodemailer');

// Read at call time so the address can change without restarting (and tests can set it).
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const FROM = process.env.MAIL_FROM || 'MicroServiceHub <no-reply@microservicehub.local>';

// Modes:
//   memory  - tests: messages are kept in `outbox`
//   smtp    - real delivery (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
//   console - development fallback: the email is printed in the server terminal
const outbox = [];
let transporter = null;

function mode() {
  if (process.env.MAIL_TRANSPORT === 'memory') return 'memory';
  return process.env.SMTP_HOST ? 'smtp' : 'console';
}

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Branded HTML wrapper used for every email. */
function template({ title, paragraphs, button }) {
  const body = paragraphs.map((text) => `<p style="margin:0 0 14px;line-height:1.6;color:#344054">${escapeHtml(text)}</p>`).join('');
  const action = button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#0b7a5b;color:#fff;font-weight:700;text-decoration:none">${escapeHtml(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#667085">If the button does not work, copy this link into your browser:<br>${escapeHtml(button.url)}</p>`
    : '';

  return `<div style="background:#f3f8f6;padding:28px 12px;font-family:Inter,Segoe UI,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d6e6df;border-radius:16px;overflow:hidden">
      <div style="background:#0a3a2d;padding:18px 24px;color:#fff;font-size:18px;font-weight:800">MicroService<span style="color:#f4d796">Hub</span></div>
      <div style="padding:26px 24px">
        <h2 style="margin:0 0 14px;color:#0a3a2d;font-size:20px">${escapeHtml(title)}</h2>
        ${body}${action}
        <p style="margin:18px 0 0;font-size:12px;color:#98a2b3">You received this because of activity on your MicroServiceHub account.</p>
      </div>
    </div>
  </div>`;
}

/** Sends one email. Never throws: a mail problem must not break the request. */
async function sendMail({ to, subject, title, paragraphs, button }) {
  const html = template({ title: title || subject, paragraphs, button });
  const text = [...paragraphs, button ? `${button.label}: ${button.url}` : ''].filter(Boolean).join('\n\n');
  const message = { from: FROM, to, subject, text, html };

  try {
    switch (mode()) {
      case 'memory':
        outbox.push({ ...message, link: button?.url || null });
        break;
      case 'smtp':
        await getTransporter().sendMail(message);
        break;
      default:
        console.log(`\n--- Email (SMTP is not configured, so it is printed here) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    }
    return true;
  } catch (error) {
    console.error('Email failed:', error.message);
    return false;
  }
}

const appLink = (path) => `${appUrl()}${path}`;

module.exports = { sendMail, outbox, mode, appLink };
