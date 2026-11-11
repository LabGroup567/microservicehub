const express = require('express');

const db = require('../db');
const { requireAuth, requireRole, requireVerified } = require('../auth');
const { fail, toId, str, notify, notifyRole } = require('../helpers');
const { ownedImageId, dropIfUnused } = require('../imageRefs');
const { releaseForJob } = require('../money');

const router = express.Router();

// ---------- Categories (public) ----------

router.get('/categories', async (req, res) => {
  const [categories] = await db.query(
    'SELECT id, name, description FROM categories ORDER BY name ASC'
  );
  res.json({ success: true, categories });
});

// ---------- Validation ----------

// Open work that nobody hires closes itself after this many days. The seeker can renew it.
const WORK_LIFE_DAYS = 30;

function readOffer(value) {
  if (value === undefined || value === null || value === '') return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 99999999) fail(400, 'Your offered price must be a positive amount.');
  return Math.round(price * 100) / 100;
}

function readWorkBody(body) {
  const categoryId = toId(body.category_id);
  const title = str(body.title, 150);
  const description = str(body.description, 3000);
  const location = str(body.location, 200);
  const budget = Number(body.budget);

  if (
    !categoryId ||
    !title ||
    !description ||
    !location ||
    body.budget === '' ||
    body.budget == null ||
    !Number.isFinite(budget) ||
    budget < 0 ||
    budget > 99999999
  ) {
    fail(400, 'Please fill in all fields correctly.');
  }

  return { categoryId, title, description, location, budget };
}

async function loadOwnedWork(workId, userId, conn = db) {
  const id = toId(workId);
  if (!id) fail(400, 'Invalid work ID.');

  const [rows] = await conn.query(
    'SELECT * FROM services WHERE id = ? AND seeker_id = ? LIMIT 1',
    [id, userId]
  );
  if (!rows.length) fail(404, 'Work request not found for this account.');
  return rows[0];
}

// ---------- Browse open work (providers) ----------

router.get('/services', requireAuth, async (req, res) => {
  const where = [`s.status = 'open'`, 's.is_hidden = 0', '(s.expires_at IS NULL OR s.expires_at > NOW())'];
  const params = [];

  const q = str(req.query.q, 100);
  if (q) {
    where.push('(s.title LIKE ? OR s.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const location = str(req.query.location, 100);
  if (location) {
    where.push('s.location LIKE ?');
    params.push(`%${location}%`);
  }

  const category = toId(req.query.category_id);
  if (category) {
    where.push('s.category_id = ?');
    params.push(category);
  }

  const min = Number(req.query.min_budget);
  if (req.query.min_budget !== undefined && req.query.min_budget !== '' && Number.isFinite(min)) {
    where.push('s.budget >= ?');
    params.push(min);
  }

  const max = Number(req.query.max_budget);
  if (req.query.max_budget !== undefined && req.query.max_budget !== '' && Number.isFinite(max)) {
    where.push('s.budget <= ?');
    params.push(max);
  }

  const sorts = {
    newest: 's.created_at DESC',
    budget_high: 's.budget DESC',
    budget_low: 's.budget ASC',
  };
  const orderBy = sorts[req.query.sort] || sorts.newest;

  const [services] = await db.query(
    `SELECT s.id, s.seeker_id, s.category_id, s.title, s.description,
            s.location, s.budget, s.status, s.created_at, s.image_id, s.expires_at,
            c.name AS category_name,
            u.full_name AS seeker_name,
            (SELECT COUNT(*) FROM applications a
              WHERE a.service_id = s.id AND a.provider_id = ?) AS already_applied
     FROM services s
     LEFT JOIN categories c ON c.id = s.category_id
     JOIN users u ON u.id = s.seeker_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}`,
    [req.user.id, ...params]
  );

  res.json({ success: true, services });
});

// ---------- Seeker: post, list, edit, cancel ----------

router.post('/services', requireAuth, requireRole('seeker'), requireVerified, async (req, res) => {
  const w = readWorkBody(req.body);

  const [cats] = await db.query('SELECT id FROM categories WHERE id = ?', [w.categoryId]);
  if (!cats.length) fail(400, 'Selected category does not exist.');
  const imageId = (await ownedImageId(req.body.image_id, req.user.id)) || null;

  const [result] = await db.query(
    `INSERT INTO services (seeker_id, category_id, title, description, location, budget, status, image_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, DATE_ADD(NOW(), INTERVAL ${WORK_LIFE_DAYS} DAY))`,
    [req.user.id, w.categoryId, w.title, w.description, w.location, w.budget, imageId]
  );

  // Tell every provider about the new request (in-app and phone push).
  const providersNotified = await notifyRole(
    'provider',
    'work_new',
    'New work available',
    `${w.title} · ${w.location} · BDT ${w.budget}`,
    `/work/${result.insertId}`,
    req.user.id
  );

  res.status(201).json({
    success: true,
    message: 'Work posted successfully!',
    service_id: result.insertId,
    providers_notified: providersNotified,
  });
});

router.get('/my-work', requireAuth, requireRole('seeker'), async (req, res) => {
  const [services] = await db.query(
    `SELECT s.id, s.category_id, s.title, s.description, s.location, s.budget,
            s.status, s.created_at, s.assigned_provider_id, s.image_id, s.expires_at,
            (s.status = 'open' AND s.expires_at IS NOT NULL AND s.expires_at <= NOW()) AS is_expired,
            c.name AS category_name,
            p.full_name AS provider_name,
            (SELECT COUNT(*) FROM applications a
              WHERE a.service_id = s.id AND a.status = 'pending') AS pending_applications,
            (SELECT COUNT(*) FROM applications a WHERE a.service_id = s.id) AS total_applications,
            (SELECT COUNT(*) FROM reviews r
              WHERE r.service_id = s.id AND r.reviewer_id = s.seeker_id) AS reviewed
     FROM services s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN users p ON p.id = s.assigned_provider_id
     WHERE s.seeker_id = ?
     ORDER BY s.created_at DESC`,
    [req.user.id]
  );

  res.json({ success: true, services });
});

router.put('/my-work/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const work = await loadOwnedWork(req.params.id, req.user.id);
  if (work.status !== 'open') fail(409, 'Only open work can be edited.');

  const w = readWorkBody(req.body);
  const imageId = await ownedImageId(req.body.image_id, req.user.id);

  await db.query(
    `UPDATE services
     SET category_id = ?, title = ?, description = ?, location = ?, budget = ?
     WHERE id = ?`,
    [w.categoryId, w.title, w.description, w.location, w.budget, work.id]
  );
  if (imageId !== undefined) {
    await db.query('UPDATE services SET image_id = ? WHERE id = ?', [imageId, work.id]);
    if (work.image_id && work.image_id !== imageId) await dropIfUnused(work.image_id);
  }

  res.json({ success: true, message: 'Work updated successfully.' });
});

// Open work expires after 30 days; the seeker renews it for another 30.
router.patch('/my-work/:id/renew', requireAuth, requireRole('seeker'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid work ID.');

  const [result] = await db.query(
    `UPDATE services SET expires_at = DATE_ADD(NOW(), INTERVAL ${WORK_LIFE_DAYS} DAY)
     WHERE id = ? AND seeker_id = ? AND status = 'open'`,
    [id, req.user.id]
  );
  if (!result.affectedRows) fail(404, 'Only your open work can be renewed.');

  res.json({ success: true, message: `Renewed for ${WORK_LIFE_DAYS} more days.` });
});

router.patch('/my-work/:id/cancel', requireAuth, requireRole('seeker'), async (req, res) => {
  const work = await loadOwnedWork(req.params.id, req.user.id);

  if (!['open', 'assigned', 'in_progress'].includes(work.status)) {
    fail(409, 'This work can no longer be cancelled.');
  }

  await db.query(`UPDATE services SET status = 'cancelled' WHERE id = ?`, [work.id]);

  const [apps] = await db.query(
    `SELECT provider_id FROM applications
     WHERE service_id = ? AND status IN ('pending', 'accepted')`,
    [work.id]
  );

  for (const app of apps) {
    await notify(
      app.provider_id,
      'work_cancelled',
      'Work was cancelled',
      `"${work.title}" was cancelled by the seeker.`,
      '/my-applications'
    );
  }

  res.json({ success: true, message: 'Work cancelled successfully.' });
});

// ---------- Work detail ----------

router.get('/work/:id', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid work ID.');

  const [rows] = await db.query(
    `SELECT s.*, c.name AS category_name,
            (s.status = 'open' AND s.expires_at IS NOT NULL AND s.expires_at <= NOW()) AS is_expired,
            u.full_name AS seeker_name, u.avatar_image_id AS seeker_avatar,
            p.full_name AS provider_name, p.avatar_image_id AS provider_avatar
     FROM services s
     LEFT JOIN categories c ON c.id = s.category_id
     JOIN users u ON u.id = s.seeker_id
     LEFT JOIN users p ON p.id = s.assigned_provider_id
     WHERE s.id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) fail(404, 'Work not found.');

  const work = rows[0];
  const isOwner = work.seeker_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const isAssigned = work.assigned_provider_id === req.user.id;

  const [mine] = await db.query(
    'SELECT id, status, message, offer_price FROM applications WHERE service_id = ? AND provider_id = ?',
    [id, req.user.id]
  );

  const canView =
    isOwner || isAdmin || isAssigned || mine.length ||
    (work.status === 'open' && !work.is_hidden);
  if (!canView) fail(404, 'Work not found.');

  const result = { work, my_application: mine[0] || null, applications: [] };

  if (isOwner || isAdmin) {
    const [applications] = await db.query(
      `SELECT a.id, a.provider_id, a.message, a.status, a.created_at, a.offer_price,
              u.full_name AS provider_name, u.avatar_image_id AS provider_avatar, u.nid_status,
              (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE provider_id = u.id) AS avg_rating,
              (SELECT COUNT(*) FROM reviews WHERE provider_id = u.id) AS review_count
       FROM applications a
       JOIN users u ON u.id = a.provider_id
       WHERE a.service_id = ?
       ORDER BY FIELD(a.status, 'accepted', 'pending', 'rejected'), a.created_at DESC`,
      [id]
    );
    result.applications = applications;
  }

  const [rev] = await db.query(
    'SELECT rating, comment FROM reviews WHERE service_id = ? LIMIT 1',
    [id]
  );
  result.review = rev[0] || null;

  res.json({ success: true, ...result });
});

// ---------- Applications ----------

router.post('/applications', requireAuth, requireRole('provider'), requireVerified, async (req, res) => {
  const serviceId = toId(req.body.service_id);
  const message = str(req.body.message, 1000);
  const offerPrice = readOffer(req.body.offer_price);

  if (!serviceId || message.length < 5) {
    fail(400, 'A valid service and a message of at least 5 characters are required.');
  }

  const [rows] = await db.query(
    `SELECT id, seeker_id, title FROM services
     WHERE id = ? AND status = 'open' AND is_hidden = 0
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [serviceId]
  );
  if (!rows.length) fail(404, 'Service not found or no longer open.');
  if (rows[0].seeker_id === req.user.id) fail(400, 'You cannot apply to your own request.');

  const [dup] = await db.query(
    'SELECT id FROM applications WHERE service_id = ? AND provider_id = ?',
    [serviceId, req.user.id]
  );
  if (dup.length) fail(409, 'You have already applied to this service.');

  let result;
  try {
    [result] = await db.query(
      `INSERT INTO applications (service_id, provider_id, message, offer_price, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [serviceId, req.user.id, message, offerPrice]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'You have already applied to this service.');
    throw error;
  }

  await notify(
    rows[0].seeker_id,
    'application_new',
    'New application received',
    `${req.user.full_name} applied to "${rows[0].title}"${offerPrice ? ` and offered BDT ${offerPrice}` : ''}.`,
    `/work/${serviceId}`
  );

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully!',
    application: { id: result.insertId, status: 'pending' },
  });
});

router.get('/my-applications', requireAuth, requireRole('provider'), async (req, res) => {
  const [applications] = await db.query(
    `SELECT a.id, a.service_id, a.message, a.status, a.created_at, a.offer_price,
            s.title AS service_title, s.location AS service_location,
            s.budget AS service_budget, s.status AS work_status,
            s.assigned_provider_id, s.seeker_id,
            c.name AS category_name,
            u.full_name AS seeker_name
     FROM applications a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN categories c ON c.id = s.category_id
     JOIN users u ON u.id = s.seeker_id
     WHERE a.provider_id = ?
     ORDER BY a.created_at DESC`,
    [req.user.id]
  );

  res.json({ success: true, applications });
});

router.delete('/applications/:id', requireAuth, requireRole('provider'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid application ID.');

  const [result] = await db.query(
    `DELETE FROM applications WHERE id = ? AND provider_id = ? AND status = 'pending'`,
    [id, req.user.id]
  );
  if (!result.affectedRows) fail(404, 'Pending application not found.');

  res.json({ success: true, message: 'Application withdrawn.' });
});

async function decideApplication(req, res, decision) {
  const appId = toId(req.params.id);
  if (!appId) fail(400, 'Invalid application ID.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT a.id, a.status, a.provider_id, a.service_id, a.offer_price,
              s.seeker_id, s.status AS work_status, s.title, s.budget,
              (s.expires_at IS NOT NULL AND s.expires_at <= NOW()) AS expired
       FROM applications a
       JOIN services s ON s.id = a.service_id
       WHERE a.id = ? FOR UPDATE`,
      [appId]
    );

    const app = rows[0];
    if (!app || app.seeker_id !== req.user.id) fail(404, 'Application not found.');
    if (app.status !== 'pending') fail(409, 'This application was already decided.');

    if (decision === 'accepted') {
      if (app.work_status !== 'open') fail(409, 'This work is no longer open.');
      if (app.expired) fail(409, 'This work has expired. Renew it first, then hire.');

      // Hiring an offer makes its price the agreed price, so payments use it.
      const agreed = app.offer_price != null ? Number(app.offer_price) : Number(app.budget);
      if (agreed !== Number(app.budget)) {
        await conn.query('UPDATE services SET budget = ? WHERE id = ?', [agreed, app.service_id]);
      }

      await conn.query(`UPDATE applications SET status = 'accepted' WHERE id = ?`, [appId]);
      await conn.query(
        `UPDATE services SET status = 'assigned', assigned_provider_id = ? WHERE id = ?`,
        [app.provider_id, app.service_id]
      );

      const [others] = await conn.query(
        `SELECT id, provider_id FROM applications
         WHERE service_id = ? AND id <> ? AND status = 'pending'`,
        [app.service_id, appId]
      );
      await conn.query(
        `UPDATE applications SET status = 'rejected'
         WHERE service_id = ? AND id <> ? AND status = 'pending'`,
        [app.service_id, appId]
      );

      await conn.commit();

      await notify(
        app.provider_id,
        'application_accepted',
        'Your application was accepted',
        `You got the work "${app.title}"${app.offer_price != null && Number(app.offer_price) !== Number(app.budget) ? ` at your price of BDT ${app.offer_price}` : ''}.`,
        '/my-applications'
      );
      for (const other of others) {
        await notify(
          other.provider_id,
          'application_rejected',
          'Application not selected',
          `"${app.title}" was given to another provider.`,
          '/my-applications'
        );
      }
    } else {
      await conn.query(`UPDATE applications SET status = 'rejected' WHERE id = ?`, [appId]);
      await conn.commit();

      await notify(
        app.provider_id,
        'application_rejected',
        'Application rejected',
        `Your application for "${app.title}" was rejected.`,
        '/my-applications'
      );
    }

    res.json({ success: true, message: `Application ${decision}.` });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

router.patch('/applications/:id/accept', requireAuth, requireRole('seeker'), (req, res) =>
  decideApplication(req, res, 'accepted')
);

router.patch('/applications/:id/reject', requireAuth, requireRole('seeker'), (req, res) =>
  decideApplication(req, res, 'rejected')
);

// ---------- Progress tracking ----------

router.patch('/work/:id/start', requireAuth, requireRole('provider'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid work ID.');

  const [rows] = await db.query(
    'SELECT id, seeker_id, title, status, assigned_provider_id FROM services WHERE id = ?',
    [id]
  );
  const work = rows[0];

  if (!work || work.assigned_provider_id !== req.user.id) fail(404, 'Work not found.');
  if (work.status !== 'assigned') fail(409, 'Work must be assigned before it can start.');

  await db.query(`UPDATE services SET status = 'in_progress' WHERE id = ?`, [id]);
  await notify(
    work.seeker_id,
    'work_started',
    'Work has started',
    `${req.user.full_name} started "${work.title}".`,
    `/work/${id}`
  );

  res.json({ success: true, message: 'Work marked as in progress.' });
});

router.patch('/work/:id/withdraw', requireAuth, requireRole('provider'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid work ID.');

  const [rows] = await db.query(
    'SELECT id, seeker_id, title, status, assigned_provider_id FROM services WHERE id = ?',
    [id]
  );
  const work = rows[0];

  if (!work || work.assigned_provider_id !== req.user.id) fail(404, 'Work not found.');
  if (!['assigned', 'in_progress'].includes(work.status)) {
    fail(409, 'You can no longer withdraw from this work.');
  }

  await db.query(
    `UPDATE services SET status = 'open', assigned_provider_id = NULL WHERE id = ?`,
    [id]
  );
  await db.query(
    `UPDATE applications SET status = 'rejected' WHERE service_id = ? AND provider_id = ?`,
    [id, req.user.id]
  );
  await notify(
    work.seeker_id,
    'work_withdrawn',
    'Provider withdrew',
    `${req.user.full_name} withdrew from "${work.title}". It is open again.`,
    `/work/${id}`
  );

  res.json({ success: true, message: 'You withdrew from this work.' });
});

router.patch('/work/:id/complete', requireAuth, requireRole('seeker'), async (req, res) => {
  const work = await loadOwnedWork(req.params.id, req.user.id);
  if (work.status !== 'in_progress') {
    fail(409, 'Only work that is in progress can be completed.');
  }

  await db.query(`UPDATE services SET status = 'completed' WHERE id = ?`, [work.id]);
  await releaseForJob({ serviceId: work.id });
  await notify(
    work.assigned_provider_id,
    'work_completed',
    'Work confirmed as complete',
    `"${work.title}" was marked complete.`,
    '/my-applications'
  );

  res.json({ success: true, message: 'Work marked as completed.' });
});

module.exports = router;
