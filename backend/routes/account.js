const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { fail, str, publicUser } = require('../helpers');
const { ownedImageId, dropIfUnused } = require('../imageRefs');
const { sendVerificationEmail } = require('./recovery');
const { smsAvailable, toInternational } = require('../sms');
const { applyAdminInvite } = require('../adminInvites');
const { applyReferral } = require('../money');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again later.' },
});

const USER_COLUMNS = `id, full_name, email, role, phone, bio, nid_status, kyc_status, email_verified, admin_level, is_main_admin, is_banned, avatar_image_id`;

function session(user, message) {
  return {
    success: true,
    message,
    token: signToken(user),
    user: publicUser(user),
  };
}

// ---------- Register ----------

router.post('/register', authLimiter, async (req, res) => {
  const fullName = str(req.body.full_name, 100);
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role || 'seeker';
  const phone = str(req.body.phone, 20) || null;

  if (!fullName || !email || !password) {
    fail(400, 'Name, email and password are required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'Please enter a valid email address.');
  }
  if (password.length < 8) {
    fail(400, 'Password must be at least 8 characters.');
  }
  if (!['seeker', 'provider'].includes(role)) {
    fail(400, 'Invalid user role.');
  }

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) fail(409, 'This email is already registered.');

  const hash = await bcrypt.hash(password, 12);
  const [result] = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, phone)
     VALUES (?, ?, ?, ?, ?)`,
    [fullName, email, hash, role, phone]
  );

  const [rows] = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
    [result.insertId]
  );

  await sendVerificationEmail(rows[0]);
  await applyReferral(rows[0].id, req.body.referral_code);

  res.status(201).json(session(rows[0], 'Registration successful!'));
});

// ---------- Login ----------

router.post('/login', authLimiter, async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password) fail(400, 'Email and password are required.');

  const [rows] = await db.query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ? LIMIT 1`,
    [email]
  );

  const user = rows[0];
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) fail(401, 'Invalid email or password.');
  if (user.is_banned) fail(403, 'This account has been suspended.');

  res.json(session(user, 'Login successful!'));
});

// ---------- Google login ----------

router.post('/auth/google', authLimiter, async (req, res) => {
  const credential = req.body.credential;

  if (!credential || typeof credential !== 'string') {
    fail(400, 'Google credential is required.');
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    fail(500, 'Google login is not configured on the server.');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    fail(401, 'Google sign-in failed. Please try again.');
  }

  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    fail(401, 'Google account could not be verified.');
  }

  const googleId = payload.sub;
  const email = payload.email.trim().toLowerCase();

  let [rows] = await db.query(
    `SELECT ${USER_COLUMNS}, google_id FROM users WHERE google_id = ? LIMIT 1`,
    [googleId]
  );

  if (!rows.length) {
    [rows] = await db.query(
      `SELECT ${USER_COLUMNS}, google_id FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (rows.length) {
      if (rows[0].google_id) fail(409, 'This email is linked to another Google account.');
      await db.query('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?', [
        googleId,
        rows[0].id,
      ]);
    } else {
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const [result] = await db.query(
        `INSERT INTO users (full_name, email, password_hash, role, google_id, has_password, email_verified)
         VALUES (?, ?, ?, 'seeker', ?, 0, 1)`,
        [payload.name || email.split('@')[0], email, hash, googleId]
      );
      [rows] = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
        [result.insertId]
      );
    }
  }

  if (rows[0].is_banned) fail(403, 'This account has been suspended.');

  // Google has verified this email, so a pending admin invite for it can be applied now.
  if (await applyAdminInvite(rows[0].id)) {
    [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [rows[0].id]);
  }

  res.json(session(rows[0], 'Google login successful!'));
});

// ---------- Profile ----------

router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await db.query(
    `SELECT nid_number, has_password, created_at, kyc_status, phone_visible, notify_email, notify_sms FROM users WHERE id = ?`,
    [req.user.id]
  );

  const [[rating]] = await db.query(
    `SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS avg_rating
     FROM reviews WHERE provider_id = ?`,
    [req.user.id]
  );

  res.json({
    success: true,
    user: {
      ...publicUser(req.user),
      nid_number: rows[0].nid_number || '',
      kyc_status: rows[0].kyc_status,
      phone_visible: !!rows[0].phone_visible,
      notify_email: !!rows[0].notify_email,
      notify_sms: !!rows[0].notify_sms,
      has_password: !!rows[0].has_password,
      member_since: rows[0].created_at,
      review_count: rating.review_count,
      avg_rating: rating.avg_rating,
    },
  });
});

router.put('/me', requireAuth, async (req, res) => {
  const fullName = str(req.body.full_name, 100);
  const phone = str(req.body.phone, 20) || null;
  const bio = str(req.body.bio, 500) || null;
  const phoneVisible = req.body.phone_visible ? 1 : 0;
  const nidProvided = req.body.nid_number !== undefined;
  const nidInput = str(req.body.nid_number, 30) || null;

  if (!fullName) fail(400, 'Name is required.');
  if (nidProvided && nidInput && !/^[0-9]{10,17}$/.test(nidInput)) {
    fail(400, 'NID number must be 10 to 17 digits.');
  }

  const [[current]] = await db.query(
    'SELECT nid_number, nid_status FROM users WHERE id = ?',
    [req.user.id]
  );

  // Only touch the NID when the client sent it; changing it needs re-verification.
  const nid = nidProvided ? nidInput : current.nid_number || null;
  const nidChanged = nid !== (current.nid_number || null);
  const nidStatus = nidChanged ? 'pending' : current.nid_status;

  await db.query(
    `UPDATE users SET full_name = ?, phone = ?, bio = ?, nid_number = ?, nid_status = ?, phone_visible = ?
     WHERE id = ?`,
    [fullName, phone, bio, nid, nidStatus, phoneVisible, req.user.id]
  );

  const [rows] = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
    [req.user.id]
  );

  res.json({
    success: true,
    message: 'Profile updated.',
    user: publicUser(rows[0]),
  });
});

// Profile photo: upload it first (POST /images), then set it here. Send image_id null to go back to the default.
router.put('/me/avatar', requireAuth, async (req, res) => {
  const imageId = await ownedImageId(req.body.image_id, req.user.id);
  if (imageId === undefined) fail(400, 'Choose a photo first.');

  const [[before]] = await db.query('SELECT avatar_image_id FROM users WHERE id = ?', [req.user.id]);
  await db.query('UPDATE users SET avatar_image_id = ? WHERE id = ?', [imageId, req.user.id]);
  if (before.avatar_image_id && before.avatar_image_id !== imageId) await dropIfUnused(before.avatar_image_id);

  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [req.user.id]);
  res.json({ success: true, message: imageId ? 'Profile photo updated.' : 'Profile photo removed.', user: publicUser(rows[0]) });
});

router.put('/me/preferences', requireAuth, async (req, res) => {
  const email = req.body.notify_email ? 1 : 0;
  const sms = req.body.notify_sms ? 1 : 0;

  if (sms) {
    if (!smsAvailable()) fail(409, 'Text messages are not set up on this site yet.');
    if (!toInternational(req.user.phone)) {
      fail(400, 'Add a valid Bangladeshi mobile number (01XXXXXXXXX) to your profile first.');
    }
  }

  await db.query('UPDATE users SET notify_email = ?, notify_sms = ? WHERE id = ?', [email, sms, req.user.id]);
  res.json({ success: true, message: 'Notification settings saved.' });
});

router.put('/me/role', requireAuth, async (req, res) => {
  const role = req.body.role;

  if (!['seeker', 'provider'].includes(role) || req.user.role === 'admin') {
    fail(400, 'Invalid role.');
  }
  if (role === req.user.role) fail(400, 'You already have this role.');

  const id = req.user.id;
  const [[usage]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM services WHERE seeker_id = ?) +
       (SELECT COUNT(*) FROM applications WHERE provider_id = ?) +
       (SELECT COUNT(*) FROM bookings WHERE customer_id = ?) +
       (SELECT COUNT(*) FROM provider_services WHERE provider_id = ?) AS total`,
    [id, id, id, id]
  );

  if (usage.total > 0) {
    fail(409, 'You can only switch roles before posting work, applying or booking.');
  }

  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);

  res.json(session(rows[0], 'Role updated.'));
});

router.put('/me/password', requireAuth, async (req, res) => {
  const current = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const next = typeof req.body.new_password === 'string' ? req.body.new_password : '';

  if (next.length < 8) fail(400, 'New password must be at least 8 characters.');

  const [[row]] = await db.query(
    'SELECT password_hash, has_password FROM users WHERE id = ?',
    [req.user.id]
  );

  // Accounts created through Google have no known password yet.
  if (row.has_password) {
    const ok = await bcrypt.compare(current, row.password_hash);
    if (!ok) fail(400, 'Current password is incorrect.');
  }

  const hash = await bcrypt.hash(next, 12);
  await db.query('UPDATE users SET password_hash = ?, has_password = 1 WHERE id = ?', [
    hash,
    req.user.id,
  ]);

  res.json({ success: true, message: 'Password changed successfully.' });
});

module.exports = router;
