const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { requireAuth } = require('../auth');
const { fail, str } = require('../helpers');
const { sendMail, appLink } = require('../mailer');
const { createToken, consumeToken, recentlyIssued } = require('../tokens');
const { applyAdminInvite } = require('../adminInvites');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again later.' },
});

/** Emails a verification link. Used after registering and by "resend". */
async function sendVerificationEmail(user) {
  const token = await createToken(user.id, 'verify', 60 * 24);

  return sendMail({
    to: user.email,
    subject: 'Verify your email address',
    paragraphs: [
      `Hi ${user.full_name},`,
      'Welcome to MicroServiceHub. Please confirm your email address so we can reach you about your work, bookings and payments.',
      'This link works for 24 hours.',
    ],
    button: { label: 'Verify my email', url: appLink(`/verify-email?token=${token}`) },
  });
}

// ---------- Forgot and reset password ----------

router.post('/forgot-password', limiter, async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  if (!email) fail(400, 'Enter your email address.');

  const [rows] = await db.query(
    'SELECT id, full_name, email, is_banned FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const user = rows[0];

  // Only send when the account exists, and not more than once a minute.
  if (user && !user.is_banned && !(await recentlyIssued(user.id, 'reset', 60))) {
    const token = await createToken(user.id, 'reset', 60);

    await sendMail({
      to: user.email,
      subject: 'Reset your password',
      paragraphs: [
        `Hi ${user.full_name},`,
        'We received a request to reset your MicroServiceHub password. This link works for one hour and can be used once.',
        'If you did not ask for this, you can ignore this email. Your password stays the same.',
      ],
      button: { label: 'Choose a new password', url: appLink(`/reset-password?token=${token}`) },
    });
  }

  // The same answer whether or not the email is registered, so nobody can probe for accounts.
  res.json({
    success: true,
    message: 'If that email is registered, we have sent a link to reset the password.',
  });
});

router.post('/reset-password', limiter, async (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < 8) fail(400, 'Password must be at least 8 characters.');

  const userId = await consumeToken(req.body.token, 'reset');
  if (!userId) fail(400, 'This reset link is invalid or has expired. Please request a new one.');

  const hashValue = await bcrypt.hash(password, 12);
  await db.query(
    'UPDATE users SET password_hash = ?, has_password = 1, email_verified = 1 WHERE id = ?',
    [hashValue, userId]
  );
  await db.query("DELETE FROM auth_tokens WHERE user_id = ? AND type = 'reset'", [userId]);
  await applyAdminInvite(userId);

  const [[user]] = await db.query('SELECT full_name, email FROM users WHERE id = ?', [userId]);
  await sendMail({
    to: user.email,
    subject: 'Your password was changed',
    paragraphs: [
      `Hi ${user.full_name},`,
      'Your MicroServiceHub password was just changed. If this was not you, reset it again right away and contact support.',
    ],
  });

  res.json({ success: true, message: 'Password updated. You can log in now.' });
});

// ---------- Email verification ----------

router.post('/verify-email', limiter, async (req, res) => {
  const userId = await consumeToken(req.body.token, 'verify');
  if (!userId) fail(400, 'This verification link is invalid or has expired.');

  await db.query('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
  await applyAdminInvite(userId);
  res.json({ success: true, message: 'Email verified. Thank you!' });
});

router.post('/me/resend-verification', requireAuth, limiter, async (req, res) => {
  const [[row]] = await db.query('SELECT email_verified FROM users WHERE id = ?', [req.user.id]);
  if (row.email_verified) fail(409, 'Your email is already verified.');
  if (await recentlyIssued(req.user.id, 'verify', 60)) fail(429, 'We just sent one. Please wait a minute and try again.');

  await sendVerificationEmail(req.user);
  res.json({ success: true, message: 'Verification email sent.' });
});

module.exports = router;
module.exports.sendVerificationEmail = sendVerificationEmail;
