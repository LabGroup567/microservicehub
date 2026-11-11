const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, str, notify, canChat } = require('../helpers');
const { emitToUser } = require('../realtime');

const router = express.Router();

// ==========================================================
// Reviews and ratings
// ==========================================================

router.post('/reviews', requireAuth, requireRole('seeker'), async (req, res) => {
  const serviceId = toId(req.body.service_id);
  const bookingId = toId(req.body.booking_id);
  const comment = str(req.body.comment, 1000) || null;
  // Reviews are written. A star rating is optional and the app no longer asks for one.
  const hasRating = req.body.rating !== undefined && req.body.rating !== null && req.body.rating !== '';
  const rating = hasRating ? Number(req.body.rating) : null;

  if (!serviceId === !bookingId) fail(400, 'Review either a work or a booking.');
  if (hasRating && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    fail(400, 'Rating must be between 1 and 5.');
  }
  if (!hasRating && (!comment || comment.length < 5)) {
    fail(400, 'Please write a short review (at least 5 characters).');
  }

  let providerId;
  let label;

  if (serviceId) {
    const [rows] = await db.query(
      `SELECT assigned_provider_id, title FROM services
       WHERE id = ? AND seeker_id = ? AND status = 'completed'`,
      [serviceId, req.user.id]
    );
    if (!rows.length || !rows[0].assigned_provider_id) {
      fail(409, 'You can only review completed work you posted.');
    }
    providerId = rows[0].assigned_provider_id;
    label = rows[0].title;
  } else {
    const [rows] = await db.query(
      `SELECT ps.provider_id, ps.title
       FROM bookings b JOIN provider_services ps ON ps.id = b.provider_service_id
       WHERE b.id = ? AND b.customer_id = ? AND b.status = 'completed'`,
      [bookingId, req.user.id]
    );
    if (!rows.length) fail(409, 'You can only review your completed bookings.');
    providerId = rows[0].provider_id;
    label = rows[0].title;
  }

  try {
    await db.query(
      `INSERT INTO reviews (reviewer_id, provider_id, service_id, booking_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, providerId, serviceId, bookingId, rating, comment]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'You already reviewed this.');
    throw error;
  }

  await notify(
    providerId,
    'review_new',
    'New review',
    `${req.user.full_name} reviewed "${label}".`,
    '/profile'
  );

  res.status(201).json({ success: true, message: 'Thanks for your review!' });
});

router.get('/providers/:id/reviews', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid provider ID.');

  const [users] = await db.query(
    `SELECT id, full_name, bio, nid_status, created_at, avatar_image_id FROM users
     WHERE id = ? AND role = 'provider'`,
    [id]
  );
  if (!users.length) fail(404, 'Provider not found.');

  const [[stats]] = await db.query(
    `SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS avg_rating
     FROM reviews WHERE provider_id = ?`,
    [id]
  );

  const [reviews] = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
     FROM reviews r JOIN users u ON u.id = r.reviewer_id
     WHERE r.provider_id = ?
     ORDER BY r.created_at DESC LIMIT 50`,
    [id]
  );

  res.json({ success: true, provider: { ...users[0], ...stats }, reviews });
});

// ==========================================================
// Notifications
// ==========================================================

router.get('/notifications', requireAuth, async (req, res) => {
  const [notifications] = await db.query(
    `SELECT id, type, title, body, link, is_read, created_at
     FROM notifications WHERE user_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 60`,
    [req.user.id]
  );
  res.json({ success: true, notifications });
});

router.patch('/notifications/read-all', requireAuth, async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ success: true });
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid notification ID.');

  await db.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [
    id,
    req.user.id,
  ]);
  res.json({ success: true });
});

// Lightweight counters polled by the navbar.
router.get('/counters', requireAuth, async (req, res) => {
  const [[n]] = await db.query(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0',
    [req.user.id]
  );
  const [[m]] = await db.query(
    'SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND is_read = 0',
    [req.user.id]
  );
  res.json({ success: true, notifications: n.c, messages: m.c });
});

// ==========================================================
// Chat between seekers and providers
// ==========================================================

async function loadPeer(id) {
  const peerId = toId(id);
  if (!peerId) fail(400, 'Invalid user.');

  const [rows] = await db.query(
    'SELECT id, full_name, role, is_banned, phone, phone_visible, avatar_image_id FROM users WHERE id = ?',
    [peerId]
  );
  if (!rows.length || rows[0].is_banned) fail(404, 'User not found.');
  return rows[0];
}

router.get('/chat/conversations', requireAuth, async (req, res) => {
  const me = req.user.id;

  const [conversations] = await db.query(
    `SELECT u.id AS user_id, u.full_name, u.role, u.avatar_image_id,
            m.body AS last_message, m.created_at AS last_at, m.sender_id AS last_sender_id,
            (SELECT COUNT(*) FROM messages x
              WHERE x.sender_id = u.id AND x.receiver_id = ? AND x.is_read = 0) AS unread
     FROM (
       SELECT IF(sender_id = ?, receiver_id, sender_id) AS peer_id, MAX(id) AS last_id
       FROM messages
       WHERE sender_id = ? OR receiver_id = ?
       GROUP BY peer_id
     ) t
     JOIN messages m ON m.id = t.last_id
     JOIN users u ON u.id = t.peer_id
     ORDER BY m.id DESC`,
    [me, me, me, me]
  );

  res.json({ success: true, conversations });
});

router.get('/chat/:userId', requireAuth, async (req, res) => {
  const peer = await loadPeer(req.params.userId);

  const [messages] = await db.query(
    `SELECT id, sender_id, receiver_id, body, created_at
     FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY id ASC LIMIT 300`,
    [req.user.id, peer.id, peer.id, req.user.id]
  );

  const allowed = messages.length > 0 || (await canChat(req.user, peer));
  if (!allowed) fail(403, 'You can chat after working together or applying.');

  await db.query(
    'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
    [peer.id, req.user.id]
  );

  res.json({
    success: true,
    peer: {
      id: peer.id,
      full_name: peer.full_name,
      role: peer.role,
      avatar_image_id: peer.avatar_image_id || null,
      // Phone numbers are shared only when their owner opted in.
      phone: peer.phone_visible ? peer.phone : null,
    },
    messages,
  });
});

// Keeps a single account from flooding someone (or the support team) with messages.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 40,
  keyGenerator: (req) => `user-${req.user.id}`,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, message: 'You are sending messages too quickly. Please wait a moment.' },
});

// The people users can message for help. Emails are never shown.
router.get('/support/team', requireAuth, async (req, res) => {
  const [team] = await db.query(
    `SELECT id, full_name, admin_level FROM users
     WHERE role = 'admin' AND is_banned = 0 AND id <> ?
     ORDER BY FIELD(admin_level, 'sub', 'full'), full_name ASC`,
    [req.user.id]
  );
  res.json({ success: true, team });
});

router.post('/chat/:userId', requireAuth, sendLimiter, async (req, res) => {
  const peer = await loadPeer(req.params.userId);
  const body = str(req.body.body, 2000);

  if (!body) fail(400, 'Message cannot be empty.');
  if (!(await canChat(req.user, peer))) {
    const [existing] = await db.query(
      `SELECT 1 FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) LIMIT 1`,
      [req.user.id, peer.id, peer.id, req.user.id]
    );
    if (!existing.length) fail(403, 'You can chat after working together or applying.');
  }

  const [result] = await db.query(
    'INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)',
    [req.user.id, peer.id, body]
  );

  const message = {
    id: result.insertId,
    sender_id: req.user.id,
    receiver_id: peer.id,
    body,
    created_at: new Date().toISOString(),
  };

  // Deliver instantly to the receiver and the sender's other open tabs.
  emitToUser(peer.id, 'message:new', message);
  emitToUser(req.user.id, 'message:new', message);

  res.status(201).json({ success: true, id: result.insertId, message });
});

// ==========================================================
// Reports
// ==========================================================

router.post('/reports', requireAuth, async (req, res) => {
  const type = req.body.target_type;
  const targetId = toId(req.body.target_id);
  const reason = str(req.body.reason, 500);

  if (!['user', 'work', 'listing'].includes(type) || !targetId) {
    fail(400, 'Invalid report target.');
  }
  if (reason.length < 5) fail(400, 'Please describe the problem (at least 5 characters).');

  const tables = { user: 'users', work: 'services', listing: 'provider_services' };
  const [target] = await db.query(`SELECT id FROM ${tables[type]} WHERE id = ?`, [targetId]);
  if (!target.length) fail(404, 'The reported item no longer exists.');
  if (type === 'user' && targetId === req.user.id) fail(400, 'You cannot report yourself.');

  const [dup] = await db.query(
    `SELECT id FROM reports
     WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`,
    [req.user.id, type, targetId]
  );
  if (dup.length) fail(409, 'You already reported this. Our team will review it.');

  await db.query(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)',
    [req.user.id, type, targetId, reason]
  );

  res.status(201).json({ success: true, message: 'Report submitted. Thank you.' });
});

module.exports = router;
