const express = require('express');

const db = require('../db');
const { requireAuth, requireRole, requireMainAdmin } = require('../auth');
const { fail, toId, str, notify } = require('../helpers');
const { sendMail, appLink } = require('../mailer');

const router = express.Router();

// Every route here is admin-only, enforced on the server.
router.use('/admin', requireAuth, requireRole('admin'));

// The main admin is the owner of the platform: nobody else can change it.
function assertNotMainAdmin(requester, target) {
  if (target.is_main_admin && target.id !== requester.id) {
    fail(403, 'The main admin cannot be changed.');
  }
}

router.get('/admin/stats', async (req, res) => {
  const count = async (sql) => (await db.query(sql))[0][0].c;

  const stats = {
    users: await count('SELECT COUNT(*) AS c FROM users'),
    seekers: await count(`SELECT COUNT(*) AS c FROM users WHERE role = 'seeker'`),
    providers: await count(`SELECT COUNT(*) AS c FROM users WHERE role = 'provider'`),
    banned: await count('SELECT COUNT(*) AS c FROM users WHERE is_banned = 1'),
    nid_pending: await count(
      `SELECT COUNT(*) AS c FROM users WHERE nid_status = 'pending' AND nid_number IS NOT NULL`
    ),
    kyc_pending: await count(`SELECT COUNT(*) AS c FROM users WHERE kyc_status = 'pending'`),
    payments_pending: await count(`SELECT COUNT(*) AS c FROM payments WHERE status = 'pending'`),
    escrow_held: await count(`SELECT COUNT(*) AS c FROM payments WHERE escrow_status IN ('held', 'disputed')`),
    disputes_open: await count(`SELECT COUNT(*) AS c FROM disputes WHERE status = 'open'`),
    refunds_due: await count(`SELECT COUNT(*) AS c FROM payments WHERE refund_status = 'due'`),
    fees_collected: await count(`SELECT COALESCE(SUM(fee_amount), 0) AS c FROM payments WHERE status = 'paid' AND gateway IS NOT NULL`),
    payouts_due: await count(`SELECT COUNT(*) AS c FROM payments WHERE payout_status = 'due'`),
    payouts_due_amount: await count(
      `SELECT COALESCE(SUM(amount), 0) AS c FROM payments WHERE payout_status = 'due'`
    ),
    payments_paid_total: await count(
      `SELECT COALESCE(SUM(amount), 0) AS c FROM payments WHERE status = 'paid'`
    ),
    work_total: await count('SELECT COUNT(*) AS c FROM services'),
    work_open: await count(`SELECT COUNT(*) AS c FROM services WHERE status = 'open'`),
    work_completed: await count(`SELECT COUNT(*) AS c FROM services WHERE status = 'completed'`),
    listings: await count('SELECT COUNT(*) AS c FROM provider_services'),
    bookings: await count('SELECT COUNT(*) AS c FROM bookings'),
    applications: await count('SELECT COUNT(*) AS c FROM applications'),
    reviews: await count('SELECT COUNT(*) AS c FROM reviews'),
    reports_open: await count(`SELECT COUNT(*) AS c FROM reports WHERE status = 'open'`),
    categories: await count('SELECT COUNT(*) AS c FROM categories'),
  };

  res.json({ success: true, stats });
});

// ---------- Dashboard charts and recent activity ----------

const DAYS = 14;

// Local calendar date as YYYY-MM-DD (toISOString would shift the day by the UTC offset).
const ymd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Fills in days with no rows so the charts always show a full range.
function lastDays(rows, valueKey = 'c') {
  const byDay = new Map(rows.map((row) => [ymd(new Date(row.d)), Number(row[valueKey])]));
  const result = [];

  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = ymd(date);
    result.push({ date: key, value: byDay.get(key) || 0 });
  }
  return result;
}

router.get('/admin/overview', async (req, res) => {
  const since = `>= CURDATE() - INTERVAL ${DAYS - 1} DAY`;

  const [signups] = await db.query(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users WHERE created_at ${since} GROUP BY d`
  );
  const [work] = await db.query(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM services WHERE created_at ${since} GROUP BY d`
  );
  const [bookings] = await db.query(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM bookings WHERE created_at ${since} GROUP BY d`
  );
  const [revenue] = await db.query(
    `SELECT DATE(paid_at) AS d, SUM(amount) AS c FROM payments
     WHERE status = 'paid' AND paid_at ${since} GROUP BY d`
  );

  const [categories] = await db.query(
    `SELECT c.name, COUNT(*) AS total
     FROM services s JOIN categories c ON c.id = s.category_id
     GROUP BY c.id, c.name ORDER BY total DESC LIMIT 6`
  );

  const [statuses] = await db.query('SELECT status, COUNT(*) AS total FROM services GROUP BY status');

  const [recentUsers] = await db.query(
    `SELECT id, full_name, email, role, kyc_status, created_at
     FROM users ORDER BY created_at DESC, id DESC LIMIT 6`
  );
  const [recentWork] = await db.query(
    `SELECT s.id, s.title, s.budget, s.status, s.created_at, u.full_name AS owner_name
     FROM services s JOIN users u ON u.id = s.seeker_id
     ORDER BY s.created_at DESC, s.id DESC LIMIT 6`
  );
  const [recentPayments] = await db.query(
    `SELECT p.id, p.amount, p.method, p.status, p.created_at, payer.full_name AS payer_name
     FROM payments p JOIN users payer ON payer.id = p.payer_id
     ORDER BY p.id DESC LIMIT 6`
  );

  res.json({
    success: true,
    charts: {
      signups: lastDays(signups),
      work: lastDays(work),
      bookings: lastDays(bookings),
      revenue: lastDays(revenue),
    },
    top_categories: categories,
    work_by_status: statuses,
    recent: { users: recentUsers, work: recentWork, payments: recentPayments },
  });
});

// ---------- Report: how each service type is doing, on screen and as a spreadsheet ----------

const REPORT_RANGES = [7, 30, 90, 365, 0]; // 0 means all time

async function buildReport(rawDays) {
  const asked = Number(rawDays);
  const days = REPORT_RANGES.includes(asked) ? asked : 30;

  const [rows] = await db.query(
    `SELECT c.id, c.name,
            COUNT(s.id) AS posted,
            COALESCE(SUM(s.status IN ('assigned', 'in_progress', 'completed')), 0) AS hired,
            COALESCE(SUM(s.status = 'completed'), 0) AS completed,
            COALESCE(SUM(s.status = 'cancelled'), 0) AS cancelled,
            COALESCE(SUM(s.status = 'open'), 0) AS still_open,
            COALESCE(ROUND(AVG(s.budget)), 0) AS avg_budget,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.budget END), 0) AS completed_value
     FROM categories c
     LEFT JOIN services s ON s.category_id = c.id AND (? = 0 OR s.created_at >= NOW() - INTERVAL ? DAY)
     GROUP BY c.id, c.name
     ORDER BY posted DESC, c.name`,
    [days, days]
  );

  const [bookings] = await db.query(
    `SELECT ps.category_id AS id, COUNT(*) AS bookings,
            COALESCE(SUM(b.status = 'completed'), 0) AS bookings_completed
     FROM bookings b JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE (? = 0 OR b.created_at >= NOW() - INTERVAL ? DAY)
     GROUP BY ps.category_id`,
    [days, days]
  );
  const bookingBy = new Map(bookings.map((row) => [row.id, row]));

  const categories = rows.map((row) => ({
    name: row.name,
    posted: Number(row.posted),
    hired: Number(row.hired),
    completed: Number(row.completed),
    cancelled: Number(row.cancelled),
    still_open: Number(row.still_open),
    avg_budget: Number(row.avg_budget),
    completed_value: Number(row.completed_value),
    bookings: Number(bookingBy.get(row.id)?.bookings || 0),
    bookings_completed: Number(bookingBy.get(row.id)?.bookings_completed || 0),
  }));

  const [[money]] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(fee_amount), 0) AS fees
     FROM payments
     WHERE status = 'paid' AND (? = 0 OR paid_at >= NOW() - INTERVAL ? DAY)`,
    [days, days]
  );
  const [[people]] = await db.query(
    `SELECT COUNT(*) AS signups FROM users WHERE role <> 'admin' AND (? = 0 OR created_at >= NOW() - INTERVAL ? DAY)`,
    [days, days]
  );

  const sum = (key) => categories.reduce((total, row) => total + row[key], 0);
  return {
    days,
    totals: {
      posted: sum('posted'),
      hired: sum('hired'),
      completed: sum('completed'),
      cancelled: sum('cancelled'),
      completed_value: sum('completed_value'),
      bookings: sum('bookings'),
      bookings_completed: sum('bookings_completed'),
      paid: Number(money.paid),
      fees: Number(money.fees),
      signups: Number(people.signups),
    },
    categories,
  };
}

// A spreadsheet opens "=cmd()" as a formula, so text that starts with such a sign is made harmless.
const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

router.get('/admin/report', async (req, res) => {
  res.json({ success: true, ...(await buildReport(req.query.days)) });
});

router.get('/admin/report.csv', async (req, res) => {
  const report = await buildReport(req.query.days);
  const header = ['Service type', 'Work posted', 'Hired', 'Completed', 'Cancelled', 'Still open', 'Average budget (BDT)', 'Completed value (BDT)', 'Bookings', 'Bookings completed'];
  const lines = [header, ...report.categories.map((c) => [c.name, c.posted, c.hired, c.completed, c.cancelled, c.still_open, c.avg_budget, c.completed_value, c.bookings, c.bookings_completed])];
  const t = report.totals;
  lines.push(['All service types', t.posted, t.hired, t.completed, t.cancelled, '', '', t.completed_value, t.bookings, t.bookings_completed]);

  const label = report.days === 0 ? 'all-time' : `last-${report.days}-days`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="microservicehub-report-${label}.csv"`);
  // The leading BOM lets Excel read the file as UTF-8.
  res.send('\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n');
});

router.get('/admin/payments', async (req, res) => {
  const status = ['pending', 'paid', 'failed', 'refunded'].includes(req.query.status)
    ? req.query.status
    : null;

  const [payments] = await db.query(
    `SELECT p.id, p.amount, p.method, p.status, p.trx_id, p.created_at, p.paid_at,
            p.gateway, p.payout_status, p.payout_at,
            p.fee_amount, p.discount_amount, p.promo_code, p.charged_amount, p.escrow_status, p.refund_status,
            COALESCE(s.title, ps.title) AS title,
            payer.full_name AS payer_name, payee.full_name AS payee_name,
            payee.bkash_number AS payee_bkash
     FROM payments p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
     JOIN users payer ON payer.id = p.payer_id
     JOIN users payee ON payee.id = p.payee_id
     ${status ? 'WHERE p.status = ?' : ''}
     ORDER BY p.id DESC LIMIT 200`,
    status ? [status] : []
  );

  res.json({ success: true, payments });
});

// ---------- Users ----------

router.get('/admin/users', async (req, res) => {
  const where = ['1 = 1'];
  const params = [];

  const q = str(req.query.q, 100);
  if (q) {
    where.push('(full_name LIKE ? OR email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  if (['seeker', 'provider', 'admin'].includes(req.query.role)) {
    where.push('role = ?');
    params.push(req.query.role);
  }

  const [users] = await db.query(
    `SELECT id, full_name, email, role, admin_level, is_main_admin, phone, nid_status, nid_number, is_banned, created_at
     FROM users WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC LIMIT 300`,
    params
  );

  res.json({ success: true, users });
});

router.patch('/admin/users/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid user ID.');

  const [rows] = await db.query('SELECT id, role, admin_level, is_main_admin FROM users WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'User not found.');

  const target = rows[0];
  assertNotMainAdmin(req.user, target);
  const isMain = !!req.user.is_main_admin;

  // Admin accounts are managed from the Admins tab by the main admin only.
  if (target.role === 'admin' && !isMain && target.id !== req.user.id) fail(403, 'Only the main admin can change another admin.');

  const updates = [];
  const params = [];

  if (req.body.is_banned !== undefined) {
    if (id === req.user.id) fail(400, 'You cannot suspend your own account.');
    updates.push('is_banned = ?');
    params.push(req.body.is_banned ? 1 : 0);
  }

  if (req.body.role !== undefined) {
    if (!isMain) fail(403, 'Only the main admin can change roles.');
    if (target.role === 'admin') fail(400, 'Use the Admins tab to change admin access.');
    if (!['seeker', 'provider'].includes(req.body.role)) fail(400, 'Invalid role. Use the Admins tab to grant admin access.');
    updates.push('role = ?');
    params.push(req.body.role);
  }

  if (req.body.nid_status !== undefined) {
    if (!['pending', 'verified', 'rejected'].includes(req.body.nid_status)) {
      fail(400, 'Invalid NID status.');
    }
    updates.push('nid_status = ?');
    params.push(req.body.nid_status);
  }

  if (!updates.length) fail(400, 'Nothing to update.');

  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);

  if (req.body.nid_status === 'verified' || req.body.nid_status === 'rejected') {
    await notify(
      id,
      'nid_status',
      `NID ${req.body.nid_status}`,
      req.body.nid_status === 'verified'
        ? 'Your identity has been verified.'
        : 'Your NID could not be verified. Please update it in your profile.',
      '/profile'
    );
  }

  res.json({ success: true, message: 'User updated.' });
});

// ---------- Categories ----------

router.get('/admin/categories', async (req, res) => {
  const [categories] = await db.query(
    `SELECT c.id, c.name, c.description,
            (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id) +
            (SELECT COUNT(*) FROM provider_services p WHERE p.category_id = c.id) AS usage_count
     FROM categories c ORDER BY c.name ASC`
  );
  res.json({ success: true, categories });
});

router.post('/admin/categories', requireMainAdmin, async (req, res) => {
  const name = str(req.body.name, 100);
  const description = str(req.body.description, 255) || null;
  if (!name) fail(400, 'Category name is required.');

  try {
    await db.query('INSERT INTO categories (name, description) VALUES (?, ?)', [name, description]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'A category with this name already exists.');
    throw error;
  }

  res.status(201).json({ success: true, message: 'Category created.' });
});

router.put('/admin/categories/:id', requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const name = str(req.body.name, 100);
  const description = str(req.body.description, 255) || null;
  if (!id || !name) fail(400, 'Category name is required.');

  try {
    const [result] = await db.query(
      'UPDATE categories SET name = ?, description = ? WHERE id = ?',
      [name, description, id]
    );
    if (!result.affectedRows) fail(404, 'Category not found.');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'A category with this name already exists.');
    throw error;
  }

  res.json({ success: true, message: 'Category updated.' });
});

router.delete('/admin/categories/:id', requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid category ID.');

  const [[usage]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM services WHERE category_id = ?) +
            (SELECT COUNT(*) FROM provider_services WHERE category_id = ?) AS total`,
    [id, id]
  );
  if (usage.total > 0) fail(409, 'This category is in use and cannot be deleted.');

  await db.query('DELETE FROM categories WHERE id = ?', [id]);
  res.json({ success: true, message: 'Category deleted.' });
});

// ---------- Work and service moderation ----------

router.get('/admin/work', async (req, res) => {
  const [work] = await db.query(
    `SELECT s.id, s.title, s.location, s.budget, s.status, s.is_hidden, s.created_at,
            u.full_name AS owner_name, c.name AS category_name
     FROM services s
     JOIN users u ON u.id = s.seeker_id
     LEFT JOIN categories c ON c.id = s.category_id
     ORDER BY s.created_at DESC LIMIT 300`
  );
  res.json({ success: true, work });
});

router.patch('/admin/work/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid work ID.');

  const [rows] = await db.query('SELECT seeker_id, title FROM services WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'Work not found.');

  const hidden = req.body.is_hidden ? 1 : 0;
  await db.query('UPDATE services SET is_hidden = ? WHERE id = ?', [hidden, id]);

  if (hidden) {
    await notify(
      rows[0].seeker_id,
      'moderation',
      'Your work post was hidden',
      `"${rows[0].title}" was hidden by a moderator.`,
      '/my-work'
    );
  }

  res.json({ success: true, message: hidden ? 'Work hidden.' : 'Work restored.' });
});

router.get('/admin/listings', async (req, res) => {
  const [listings] = await db.query(
    `SELECT ps.id, ps.title, ps.location, ps.price, ps.status, ps.is_hidden, ps.created_at,
            u.full_name AS owner_name, c.name AS category_name
     FROM provider_services ps
     JOIN users u ON u.id = ps.provider_id
     LEFT JOIN categories c ON c.id = ps.category_id
     ORDER BY ps.created_at DESC LIMIT 300`
  );
  res.json({ success: true, listings });
});

router.patch('/admin/listings/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid listing ID.');

  const [rows] = await db.query('SELECT provider_id, title FROM provider_services WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'Listing not found.');

  const hidden = req.body.is_hidden ? 1 : 0;
  await db.query('UPDATE provider_services SET is_hidden = ? WHERE id = ?', [hidden, id]);

  if (hidden) {
    await notify(
      rows[0].provider_id,
      'moderation',
      'Your service listing was hidden',
      `"${rows[0].title}" was hidden by a moderator.`,
      '/my-services'
    );
  }

  res.json({ success: true, message: hidden ? 'Listing hidden.' : 'Listing restored.' });
});

// ---------- Reports ----------

router.get('/admin/reports', async (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'open';

  const [reports] = await db.query(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
            u.full_name AS reporter_name,
            CASE r.target_type
              WHEN 'user' THEN (SELECT full_name FROM users WHERE id = r.target_id)
              WHEN 'work' THEN (SELECT title FROM services WHERE id = r.target_id)
              ELSE (SELECT title FROM provider_services WHERE id = r.target_id)
            END AS target_label
     FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC LIMIT 200`,
    [status]
  );

  res.json({ success: true, reports });
});

router.patch('/admin/reports/:id', async (req, res) => {
  const id = toId(req.params.id);
  const status = req.body.status;

  if (!id || !['resolved', 'dismissed', 'open'].includes(status)) {
    fail(400, 'Invalid request.');
  }

  const [result] = await db.query('UPDATE reports SET status = ? WHERE id = ?', [status, id]);
  if (!result.affectedRows) fail(404, 'Report not found.');

  res.json({ success: true, message: `Report ${status}.` });
});

module.exports = router;

// ---------- Admin team (main admin only) ----------

router.get('/admin/admins', requireMainAdmin, async (req, res) => {
  const [admins] = await db.query(
    `SELECT id, full_name, email, is_main_admin, is_banned, created_at
     FROM users WHERE role = 'admin'
     ORDER BY is_main_admin DESC, created_at ASC`
  );
  const [invites] = await db.query(
    `SELECT i.id, i.email, i.created_at, u.full_name AS invited_by
     FROM admin_invites i JOIN users u ON u.id = i.invited_by
     ORDER BY i.created_at DESC`
  );

  res.json({
    success: true,
    admins: admins.map((admin) => ({ ...admin, is_main_admin: !!admin.is_main_admin, is_banned: !!admin.is_banned })),
    invites,
  });
});

// Makes someone a sub admin. Registered users get access straight away; for an email
// that has no account yet, an invitation is saved and sent.
router.post('/admin/admins', requireMainAdmin, async (req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');

  const [rows] = await db.query('SELECT id, full_name, role, is_banned FROM users WHERE email = ?', [email]);
  const user = rows[0];

  if (user) {
    if (user.is_banned) fail(409, 'This account is suspended.');
    if (user.id === req.user.id) fail(400, 'You are already the main admin.');
    if (user.role === 'admin') fail(409, `${user.full_name} is already an admin.`);

    await db.query("UPDATE users SET role = 'admin', admin_level = 'sub' WHERE id = ?", [user.id]);
    await db.query('DELETE FROM admin_invites WHERE email = ?', [email]);
    await notify(
      user.id,
      'admin_access',
      'You are now a sub admin',
      'Open the Admin panel from the menu. Log in again if you do not see it.',
      '/admin'
    );

    return res.status(201).json({ success: true, message: `${user.full_name} is now a sub admin.` });
  }

  await db.query(
    `INSERT INTO admin_invites (email, invited_by) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE invited_by = VALUES(invited_by), created_at = NOW()`,
    [email, req.user.id]
  );

  await sendMail({
    to: email,
    subject: 'You are invited to help run MicroServiceHub',
    paragraphs: [
      `${req.user.full_name} invited you to join the MicroServiceHub team as a sub admin.`,
      'Create an account with this email address and verify it. Admin access is added automatically once your email is verified.',
    ],
    button: { label: 'Create your account', url: appLink('/register') },
  });

  res.status(201).json({
    success: true,
    invited: true,
    message: `Invitation sent to ${email}. They become a sub admin once they sign up and verify this email.`,
  });
});

router.delete('/admin/invites/:id', requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid invitation.');

  const [result] = await db.query('DELETE FROM admin_invites WHERE id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Invitation not found.');

  res.json({ success: true, message: 'Invitation cancelled.' });
});

// Removes sub admin access; the person becomes an ordinary seeker again.
router.delete('/admin/admins/:id', requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid admin ID.');
  if (id === req.user.id) fail(400, 'The main admin cannot remove their own access.');

  const [rows] = await db.query("SELECT id, is_main_admin FROM users WHERE id = ? AND role = 'admin'", [id]);
  if (!rows.length) fail(404, 'Admin not found.');
  assertNotMainAdmin(req.user, { id, is_main_admin: rows[0].is_main_admin });

  await db.query("UPDATE users SET role = 'seeker', admin_level = 'none' WHERE id = ?", [id]);
  await notify(id, 'admin_access', 'Admin access removed', 'You can still use MicroServiceHub as a seeker.', '/');

  res.json({ success: true, message: 'Admin access removed.' });
});

// ---------- Provider payouts for online payments (main admin) ----------

router.patch('/admin/payments/:id/payout', requireMainAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const note = str(req.body.note, 255) || null;
  if (!id) fail(400, 'Invalid payment.');

  const [rows] = await db.query(
    "SELECT id, payee_id, amount, payout_status, status FROM payments WHERE id = ? AND gateway IS NOT NULL",
    [id]
  );
  const payment = rows[0];
  if (!payment) fail(404, 'Online payment not found.');
  if (payment.status !== 'paid' || payment.payout_status !== 'due') fail(409, 'This payment has no payout waiting.');

  await db.query("UPDATE payments SET payout_status = 'paid_out', payout_at = NOW(), payout_note = ? WHERE id = ?", [note, id]);
  await notify(
    payment.payee_id,
    'payout_sent',
    'Your payout was sent',
    `BDT ${payment.amount} was sent to your bKash number.`,
    '/payments'
  );

  res.json({ success: true, message: 'Payout marked as sent.' });
});
