// Availability calendar, referrals, promo codes, platform fee settings and disputes.
const express = require('express');

const db = require('../db');
const { requireAuth, requireRole, requireMainAdmin } = require('../auth');
const { fail, toId, str, notify, notifyRole } = require('../helpers');
const {
  getNumber, setSetting, normalizeCode, CODE_PATTERN,
  referralCodeFor, jobIsCompleted, releaseForJob, releasePayment, refundPayment,
} = require('../money');

const router = express.Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Availability calendar ----------

router.get('/availability/:providerId', requireAuth, async (req, res) => {
  const providerId = toId(req.params.providerId);
  if (!providerId) fail(400, 'Invalid provider.');

  const [off] = await db.query(
    "SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day FROM provider_days_off WHERE provider_id = ? AND day >= CURDATE() ORDER BY day",
    [providerId]
  );
  const [busy] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(b.preferred_date, '%Y-%m-%d') AS day
     FROM bookings b JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE ps.provider_id = ? AND b.status IN ('accepted', 'in_progress') AND b.preferred_date >= CURDATE()`,
    [providerId]
  );

  res.json({ success: true, days_off: off.map((row) => row.day), booked: busy.map((row) => row.day) });
});

router.put('/my-availability', requireAuth, requireRole('provider'), async (req, res) => {
  const days = Array.isArray(req.body.days) ? req.body.days : null;
  if (!days || days.length > 366) fail(400, 'Send a list of up to 366 days.');

  const clean = [...new Set(days)].filter((day) => typeof day === 'string' && DAY.test(day) && !Number.isNaN(Date.parse(day)));
  if (clean.length !== new Set(days).size) fail(400, 'Every day must look like 2026-12-31.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM provider_days_off WHERE provider_id = ? AND day >= CURDATE()', [req.user.id]);
    if (clean.length) {
      await conn.query('INSERT IGNORE INTO provider_days_off (provider_id, day) VALUES ?', [clean.map((day) => [req.user.id, day])]);
      await conn.query('DELETE FROM provider_days_off WHERE provider_id = ? AND day < CURDATE()', [req.user.id]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  res.json({ success: true, message: 'Availability saved.' });
});

// ---------- Referrals and personal promo codes ----------

router.get('/referrals/me', requireAuth, async (req, res) => {
  const code = await referralCodeFor(req.user.id);
  const [[invited]] = await db.query('SELECT COUNT(*) AS c FROM users WHERE referred_by = ?', [req.user.id]);
  const [promos] = await db.query(
    `SELECT code, kind, value, used_count, max_uses, active
     FROM promo_codes WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    [req.user.id]
  );

  res.json({
    success: true,
    referral_code: code,
    bonus: await getNumber('referral_bonus', 0),
    invited: invited.c,
    promos,
  });
});

// ---------- Admin: fee settings and promo codes ----------

router.get('/admin/settings', requireAuth, requireRole('admin'), async (req, res) => {
  res.json({
    success: true,
    settings: { fee_percent: await getNumber('fee_percent', 0), referral_bonus: await getNumber('referral_bonus', 0) },
  });
});

router.put('/admin/settings', requireAuth, requireMainAdmin, async (req, res) => {
  const fee = Number(req.body.fee_percent);
  const bonus = Number(req.body.referral_bonus);

  if (!Number.isFinite(fee) || fee < 0 || fee > 30) fail(400, 'The service fee must be between 0 and 30 percent.');
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 5000) fail(400, 'The referral bonus must be between 0 and 5000 BDT.');

  await setSetting('fee_percent', Math.round(fee * 100) / 100);
  await setSetting('referral_bonus', Math.round(bonus * 100) / 100);
  res.json({ success: true, message: 'Settings saved.' });
});

router.get('/admin/promos', requireAuth, requireRole('admin'), async (req, res) => {
  const [promos] = await db.query(
    `SELECT pc.id, pc.code, pc.kind, pc.value, pc.max_uses, pc.used_count, pc.active, pc.user_id,
            DATE_FORMAT(pc.expires_on, '%Y-%m-%d') AS expires_on, pc.created_at, u.full_name AS user_name
     FROM promo_codes pc LEFT JOIN users u ON u.id = pc.user_id
     ORDER BY pc.id DESC LIMIT 300`
  );
  res.json({ success: true, promos });
});

router.post('/admin/promos', requireAuth, requireMainAdmin, async (req, res) => {
  const code = normalizeCode(req.body.code);
  const kind = req.body.kind;
  const value = Number(req.body.value);
  const maxUses = req.body.max_uses === '' || req.body.max_uses == null ? null : Number(req.body.max_uses);
  const expires = req.body.expires_on ? str(req.body.expires_on, 10) : null;

  if (!CODE_PATTERN.test(code)) fail(400, 'Use 3 to 30 letters, numbers, - or _ for the code.');
  if (!['percent', 'fixed'].includes(kind)) fail(400, 'Choose percent or fixed.');
  if (!Number.isFinite(value) || value <= 0) fail(400, 'Enter a discount greater than zero.');
  if (kind === 'percent' && value > 100) fail(400, 'A percent discount cannot be more than 100.');
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) fail(400, 'Maximum uses must be a whole number, or empty for unlimited.');
  if (expires && (!DAY.test(expires) || Number.isNaN(Date.parse(expires)))) fail(400, 'The expiry date must look like 2026-12-31.');

  try {
    await db.query(
      'INSERT INTO promo_codes (code, kind, value, max_uses, expires_on, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [code, kind, value, maxUses, expires, req.user.id]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'That code already exists.');
    throw error;
  }

  res.status(201).json({ success: true, message: 'Promo code created.' });
});

router.patch('/admin/promos/:id/active', requireAuth, requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid promo code.');

  const [done] = await db.query('UPDATE promo_codes SET active = ? WHERE id = ?', [req.body.active ? 1 : 0, id]);
  if (!done.affectedRows) fail(404, 'Promo code not found.');
  res.json({ success: true, message: req.body.active ? 'Promo code turned on.' : 'Promo code turned off.' });
});

// ---------- Disputes ----------

async function loadJob(body) {
  const workId = toId(body.work_id);
  const bookingId = toId(body.booking_id);
  if (!workId === !bookingId) fail(400, 'Specify either work_id or booking_id.');

  if (workId) {
    const [rows] = await db.query(
      'SELECT id, seeker_id AS a, assigned_provider_id AS b, status, title FROM services WHERE id = ?',
      [workId]
    );
    const job = rows[0];
    if (!job || !job.b) fail(404, 'Work not found or nobody was hired.');
    return { ...job, kind: 'work', serviceId: workId, bookingId: null, ok: ['assigned', 'in_progress', 'completed'].includes(job.status) };
  }

  const [rows] = await db.query(
    `SELECT b.id, b.customer_id AS a, ps.provider_id AS b, b.status, ps.title
     FROM bookings b JOIN provider_services ps ON ps.id = b.provider_service_id WHERE b.id = ?`,
    [bookingId]
  );
  const job = rows[0];
  if (!job) fail(404, 'Booking not found.');
  return { ...job, kind: 'booking', serviceId: null, bookingId, ok: ['accepted', 'in_progress', 'completed'].includes(job.status) };
}

router.post('/disputes', requireAuth, requireRole('seeker', 'provider'), async (req, res) => {
  const job = await loadJob(req.body);
  if (job.a !== req.user.id && job.b !== req.user.id) fail(404, 'Not found.');
  if (!job.ok) fail(409, 'A dispute can be opened once the job has started.');

  const reason = str(req.body.reason, 1000);
  if (reason.length < 10) fail(400, 'Please explain the problem in at least 10 characters.');

  const column = job.kind === 'work' ? 'service_id' : 'booking_id';
  const target = job.kind === 'work' ? job.serviceId : job.bookingId;

  const [open] = await db.query(`SELECT id FROM disputes WHERE ${column} = ? AND status = 'open'`, [target]);
  if (open.length) fail(409, 'A dispute is already open for this job.');

  const against = job.a === req.user.id ? job.b : job.a;
  const [result] = await db.query(
    `INSERT INTO disputes (service_id, booking_id, opener_id, against_id, reason) VALUES (?, ?, ?, ?, ?)`,
    [job.serviceId, job.bookingId, req.user.id, against, reason]
  );

  // Money held for this job stays put until an admin decides.
  await db.query(
    `UPDATE payments SET escrow_status = 'disputed'
     WHERE ${column} = ? AND gateway IS NOT NULL AND status = 'paid' AND escrow_status = 'held'`,
    [target]
  );

  await notify(against, 'dispute', 'A dispute was opened', `${req.user.full_name} opened a dispute about "${job.title}". An admin will review it.`, '/disputes');
  await notifyRole('admin', 'dispute', 'New dispute', `"${job.title}" needs a decision.`, '/admin', req.user.id);

  res.status(201).json({ success: true, message: 'Dispute opened. An admin will review it and contact you.', dispute_id: result.insertId });
});

const DISPUTE_SELECT = `
  SELECT d.id, d.service_id, d.booking_id, d.reason, d.status, d.resolution_note, d.created_at, d.resolved_at,
         d.opener_id, d.against_id,
         COALESCE(s.title, ps.title) AS title,
         opener.full_name AS opener_name, against.full_name AS against_name,
         (SELECT p.id FROM payments p
           WHERE (p.service_id = d.service_id OR p.booking_id = d.booking_id) AND p.gateway IS NOT NULL
             AND p.status IN ('paid', 'refunded') ORDER BY p.id DESC LIMIT 1) AS payment_id,
         (SELECT p.escrow_status FROM payments p
           WHERE (p.service_id = d.service_id OR p.booking_id = d.booking_id) AND p.gateway IS NOT NULL
             AND p.status IN ('paid', 'refunded') ORDER BY p.id DESC LIMIT 1) AS escrow_status
  FROM disputes d
  LEFT JOIN services s ON s.id = d.service_id
  LEFT JOIN bookings b ON b.id = d.booking_id
  LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
  JOIN users opener ON opener.id = d.opener_id
  JOIN users against ON against.id = d.against_id`;

router.get('/disputes/mine', requireAuth, async (req, res) => {
  const [disputes] = await db.query(
    `${DISPUTE_SELECT} WHERE d.opener_id = ? OR d.against_id = ? ORDER BY d.id DESC LIMIT 100`,
    [req.user.id, req.user.id]
  );
  res.json({ success: true, disputes });
});

router.get('/admin/disputes', requireAuth, requireRole('admin'), async (req, res) => {
  const status = ['open', 'released', 'refunded', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  const [disputes] = await db.query(
    `${DISPUTE_SELECT} ${status ? 'WHERE d.status = ?' : ''} ORDER BY d.status = 'open' DESC, d.id DESC LIMIT 200`,
    status ? [status] : []
  );
  res.json({ success: true, disputes });
});

// release / refund move money, so only the main admin may choose them. Any admin may close a dispute.
router.patch('/admin/disputes/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = toId(req.params.id);
  const action = req.body.action;
  const note = str(req.body.note, 500);
  if (!id) fail(400, 'Invalid dispute.');
  if (!['release', 'refund', 'dismiss'].includes(action)) fail(400, 'Choose release, refund or dismiss.');
  if (!note) fail(400, 'Write a short note explaining your decision.');
  if (action !== 'dismiss' && !req.user.is_main_admin) fail(403, 'Only the main admin can release or refund money.');

  const [rows] = await db.query(`${DISPUTE_SELECT} WHERE d.id = ?`, [id]);
  const dispute = rows[0];
  if (!dispute) fail(404, 'Dispute not found.');
  if (dispute.status !== 'open') fail(409, 'This dispute is already closed.');

  const next = { release: 'released', refund: 'refunded', dismiss: 'dismissed' }[action];

  // Claim the dispute first so two admins cannot both act on it.
  const [claimed] = await db.query(
    "UPDATE disputes SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'open'",
    [next, note, req.user.id, id]
  );
  if (!claimed.affectedRows) fail(409, 'This dispute is already closed.');

  try {
    if (action === 'release') await releasePayment(dispute.payment_id);
    if (action === 'refund') await refundPayment(dispute.payment_id);
    if (action === 'dismiss' && dispute.escrow_status === 'disputed') {
      await db.query("UPDATE payments SET escrow_status = 'held' WHERE id = ?", [dispute.payment_id]);
      const job = { serviceId: dispute.service_id, bookingId: dispute.booking_id };
      if (await jobIsCompleted(job)) await releaseForJob(job);
    }
  } catch (error) {
    await db.query("UPDATE disputes SET status = 'open', resolution_note = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = ?", [id]);
    throw error;
  }

  const outcome = { release: 'The held payment was released to the provider.', refund: 'The held payment will be refunded to the seeker.', dismiss: 'The dispute was closed.' }[action];
  for (const userId of [dispute.opener_id, dispute.against_id]) {
    await notify(userId, 'dispute', 'Dispute decided', `"${dispute.title}": ${outcome} ${note}`, '/disputes');
  }

  res.json({ success: true, message: outcome });
});

// Money actions on one online payment, outside a dispute (for example a cancelled job).
router.patch('/admin/payments/:id/escrow', requireAuth, requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid payment.');
  if (!['release', 'refund'].includes(req.body.action)) fail(400, 'Choose release or refund.');

  if (req.body.action === 'release') await releasePayment(id);
  else await refundPayment(id);

  res.json({ success: true, message: req.body.action === 'release' ? 'Payment released to the provider.' : 'Refund approved.' });
});

router.patch('/admin/payments/:id/refund-sent', requireAuth, requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid payment.');

  const [done] = await db.query("UPDATE payments SET refund_status = 'sent' WHERE id = ? AND refund_status = 'due'", [id]);
  if (!done.affectedRows) fail(409, 'No refund is waiting for this payment.');
  res.json({ success: true, message: 'Refund marked as sent.' });
});

module.exports = router;
