// Contact form, saved providers and the provider earnings summary.
const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, str, notifyRole } = require('../helpers');

const router = express.Router();

// ---------- Contact us (public) ----------

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You sent a few messages already. Please try again later.' },
});

router.post('/contact', contactLimiter, async (req, res) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 150).toLowerCase();
  const message = str(req.body.message, 2000);

  if (!name) fail(400, 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Please enter a valid email address.');
  if (message.length < 10) fail(400, 'Please write a little more (at least 10 characters).');

  await db.query('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)', [name, email, message]);
  await notifyRole('admin', 'contact', 'New contact message', `${name}: ${message.slice(0, 120)}`, '/admin');

  res.status(201).json({ success: true, message: 'Thank you! We received your message and will reply by email.' });
});

router.get('/admin/contact', requireAuth, requireRole('admin'), async (req, res) => {
  const [messages] = await db.query(
    'SELECT id, name, email, message, handled, created_at FROM contact_messages ORDER BY handled ASC, id DESC LIMIT 200'
  );
  res.json({ success: true, messages });
});

router.patch('/admin/contact/:id/handled', requireAuth, requireRole('admin'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid message.');

  const [done] = await db.query('UPDATE contact_messages SET handled = ? WHERE id = ?', [req.body.handled ? 1 : 0, id]);
  if (!done.affectedRows) fail(404, 'Message not found.');
  res.json({ success: true, message: req.body.handled ? 'Marked as handled.' : 'Marked as new.' });
});

// ---------- Saved providers ----------

// Real numbers for the home page and the public landing page. Cached for a minute so a busy page costs almost nothing.
let publicStats = { at: 0, value: null };

router.get('/public-stats', async (req, res) => {
  if (!publicStats.value || Date.now() - publicStats.at > 60 * 1000) {
    const count = async (sql) => Number((await db.query(sql))[0][0].c);
    publicStats = {
      at: Date.now(),
      value: {
        open_work: await count(`SELECT COUNT(*) AS c FROM services WHERE status = 'open' AND is_hidden = 0 AND (expires_at IS NULL OR expires_at > NOW())`),
        service_types: await count('SELECT COUNT(*) AS c FROM categories'),
        verified_providers: await count(`SELECT COUNT(*) AS c FROM users WHERE role = 'provider' AND kyc_status = 'verified' AND is_banned = 0`),
        completed_jobs: await count(`SELECT (SELECT COUNT(*) FROM services WHERE status = 'completed') + (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS c`),
      },
    };
  }
  res.json({ success: true, stats: publicStats.value });
});

router.get('/favorites', requireAuth, requireRole('seeker'), async (req, res) => {
  const [providers] = await db.query(
    `SELECT u.id, u.full_name, u.kyc_status, u.avatar_image_id, f.created_at AS saved_at,
            (SELECT COUNT(*) FROM provider_services ps
              WHERE ps.provider_id = u.id AND ps.status = 'active' AND ps.is_hidden = 0) AS listing_count,
            (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE provider_id = u.id) AS avg_rating,
            (SELECT COUNT(*) FROM reviews WHERE provider_id = u.id) AS review_count
     FROM favorites f JOIN users u ON u.id = f.provider_id
     WHERE f.user_id = ? AND u.is_banned = 0
     ORDER BY f.created_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json({ success: true, providers });
});

router.put('/favorites/:providerId', requireAuth, requireRole('seeker'), async (req, res) => {
  const providerId = toId(req.params.providerId);
  if (!providerId) fail(400, 'Invalid provider.');

  const [rows] = await db.query("SELECT id FROM users WHERE id = ? AND role = 'provider' AND is_banned = 0", [providerId]);
  if (!rows.length) fail(404, 'Provider not found.');

  const [[count]] = await db.query('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?', [req.user.id]);
  if (count.c >= 200) fail(409, 'You can save up to 200 providers.');

  await db.query('INSERT IGNORE INTO favorites (user_id, provider_id) VALUES (?, ?)', [req.user.id, providerId]);
  res.json({ success: true, message: 'Provider saved.' });
});

router.delete('/favorites/:providerId', requireAuth, requireRole('seeker'), async (req, res) => {
  const providerId = toId(req.params.providerId);
  if (!providerId) fail(400, 'Invalid provider.');

  await db.query('DELETE FROM favorites WHERE user_id = ? AND provider_id = ?', [req.user.id, providerId]);
  res.json({ success: true, message: 'Removed from saved providers.' });
});

// ---------- Provider earnings ----------

router.get('/provider/earnings', requireAuth, requireRole('provider'), async (req, res) => {
  const id = req.user.id;

  const [[totals]] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'paid' AND escrow_status IN ('none', 'released') THEN amount END), 0) AS received,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS to_confirm,
       COALESCE(SUM(CASE WHEN status = 'paid' AND escrow_status IN ('held', 'disputed') THEN amount END), 0) AS in_escrow,
       COALESCE(SUM(CASE WHEN payout_status = 'due' THEN amount END), 0) AS payout_due,
       COALESCE(SUM(CASE WHEN payout_status = 'paid_out' THEN amount END), 0) AS paid_out,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
     FROM payments WHERE payee_id = ?`,
    [id]
  );

  const [byMonth] = await db.query(
    `SELECT DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m') AS month, SUM(amount) AS total
     FROM payments
     WHERE payee_id = ? AND status = 'paid' AND escrow_status IN ('none', 'released')
       AND COALESCE(paid_at, created_at) >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
     GROUP BY month`,
    [id]
  );

  // Always six months, oldest first, with zeros where nothing came in.
  const lookup = new Map(byMonth.map((row) => [row.month, Number(row.total)]));
  const months = [];
  const now = new Date();
  for (let back = 5; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, label: date.toLocaleDateString('en-GB', { month: 'short' }), total: lookup.get(key) || 0 });
  }

  const [recent] = await db.query(
    `SELECT p.id, p.amount, p.method, p.status, p.gateway, p.escrow_status, p.payout_status,
            COALESCE(p.paid_at, p.created_at) AS happened_at,
            COALESCE(s.title, ps.title) AS title, payer.full_name AS payer_name
     FROM payments p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
     JOIN users payer ON payer.id = p.payer_id
     WHERE p.payee_id = ? AND p.status IN ('paid', 'pending', 'refunded')
     ORDER BY p.id DESC LIMIT 20`,
    [id]
  );

  res.json({
    success: true,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)])),
    months,
    recent,
  });
});

module.exports = router;
