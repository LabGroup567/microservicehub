const db = require('./db');
const { sendMail, appLink } = require('./mailer');
const { sendSms } = require('./sms');

// Which in-app notifications are also sent by email or text message.
// New-work alerts are left out on purpose: they go to every provider and would be spam.
const EMAIL_TYPES = new Set([
  'application_new', 'application_accepted', 'application_rejected',
  'work_started', 'work_completed', 'work_cancelled', 'work_withdrawn',
  'booking_new', 'booking_status', 'payment_new', 'payment_status',
  'review_new', 'kyc_status', 'nid_status', 'moderation', 'admin_access', 'payout_sent',
]);

// Texts cost money, so only the moments a person really should not miss.
const SMS_TYPES = new Set([
  'application_accepted', 'booking_new', 'booking_status',
  'payment_new', 'payment_status', 'kyc_status', 'call_missed', 'payout_sent',
]);

// Simple per-user caps so a bug or abuse cannot flood inboxes or burn SMS credit.
const EMAIL_PER_HOUR = 20;
const SMS_PER_DAY = 10;
const sent = new Map(); // "email:5" -> [timestamps]

function underLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (sent.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    sent.set(key, recent);
    return false;
  }
  sent.set(key, [...recent, now]);
  return true;
}

/**
 * Sends the email and/or text version of a notification, following the user's
 * preferences. Never throws: delivery problems must not break the action itself.
 */
async function deliver(userId, { type, title, body, link }) {
  try {
    const wantsEmail = EMAIL_TYPES.has(type);
    const wantsSms = SMS_TYPES.has(type);
    if (!wantsEmail && !wantsSms) return;

    const [rows] = await db.query(
      `SELECT full_name, email, email_verified, phone, notify_email, notify_sms
       FROM users WHERE id = ? AND is_banned = 0`,
      [userId]
    );
    const user = rows[0];
    if (!user) return;

    if (wantsEmail && user.notify_email && user.email_verified && underLimit(`email:${userId}`, EMAIL_PER_HOUR, 3600e3)) {
      await sendMail({
        to: user.email,
        subject: title,
        paragraphs: [`Hi ${user.full_name},`, body || title],
        button: link ? { label: 'Open MicroServiceHub', url: appLink(link) } : undefined,
      });
    }

    if (wantsSms && user.notify_sms && user.phone && underLimit(`sms:${userId}`, SMS_PER_DAY, 86400e3)) {
      await sendSms(user.phone, `MicroServiceHub: ${title}${body ? `. ${body}` : ''}`);
    }
  } catch (error) {
    console.error('Notification delivery failed:', error.message);
  }
}

module.exports = { deliver, EMAIL_TYPES, SMS_TYPES };
