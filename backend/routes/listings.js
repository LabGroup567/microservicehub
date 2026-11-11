const express = require('express');

const db = require('../db');
const { requireAuth, requireRole, requireVerified } = require('../auth');
const { fail, toId, str, notify } = require('../helpers');
const { ownedImageId, dropIfUnused } = require('../imageRefs');
const { releaseForJob } = require('../money');

const router = express.Router();

function readListingBody(body) {
  const categoryId = toId(body.category_id);
  const title = str(body.title, 150);
  const description = str(body.description, 3000);
  const location = str(body.location, 200);
  const price = Number(body.price);

  if (
    !categoryId ||
    !title ||
    !description ||
    !location ||
    body.price === '' ||
    body.price == null ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 99999999
  ) {
    fail(400, 'Please fill in all fields correctly.');
  }

  const credential = str(body.credential, 80) || null;
  return { categoryId, title, description, location, price, credential };
}

// Ambulances and doctors are added and removed by the admins only (see routes/emergency.js).
const ADMIN_ONLY_CATEGORIES = ['Ambulance', 'Online Doctor'];

async function checkCredential(categoryId) {
  const [rows] = await db.query('SELECT name FROM categories WHERE id = ?', [categoryId]);
  if (!rows.length) fail(400, 'Selected category does not exist.');
  if (ADMIN_ONLY_CATEGORIES.includes(rows[0].name)) {
    fail(403, `${rows[0].name} services are added by the admin team, so they cannot be listed here. Choose another service type.`);
  }
}

// ---------- Browse provider listings (seekers) ----------

router.get('/provider-services', requireAuth, async (req, res) => {
  const where = [`ps.status = 'active'`, 'ps.is_hidden = 0', 'u.is_banned = 0', "(c.name IS NULL OR c.name NOT IN ('Ambulance', 'Online Doctor'))"];
  const params = [];

  const q = str(req.query.q, 100);
  if (q) {
    where.push('(ps.title LIKE ? OR ps.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const location = str(req.query.location, 100);
  if (location) {
    where.push('ps.location LIKE ?');
    params.push(`%${location}%`);
  }

  const category = toId(req.query.category_id);
  if (category) {
    where.push('ps.category_id = ?');
    params.push(category);
  }

  const max = Number(req.query.max_price);
  if (req.query.max_price !== undefined && req.query.max_price !== '' && Number.isFinite(max)) {
    where.push('ps.price <= ?');
    params.push(max);
  }

  if (req.query.verified === '1') where.push("u.kyc_status = 'verified'");

  const day = typeof req.query.available_on === 'string' ? req.query.available_on : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    where.push('NOT EXISTS (SELECT 1 FROM provider_days_off d WHERE d.provider_id = ps.provider_id AND d.day = ?)');
    params.push(day);
  }

  const minPrice = Number(req.query.min_price);
  if (req.query.min_price !== undefined && req.query.min_price !== '' && Number.isFinite(minPrice)) {
    where.push('ps.price >= ?');
    params.push(minPrice);
  }

  const minRating = Number(req.query.min_rating);
  const having = Number.isFinite(minRating) && minRating > 0 ? 'HAVING avg_rating >= ?' : '';
  if (having) params.push(minRating);

  const sorts = {
    newest: 'ps.created_at DESC',
    price_low: 'ps.price ASC',
    price_high: 'ps.price DESC',
    rating: 'avg_rating IS NULL, avg_rating DESC, review_count DESC',
  };
  const orderBy = sorts[req.query.sort] || sorts.newest;

  const [services] = await db.query(
    `SELECT ps.id, ps.provider_id, ps.category_id, ps.title, ps.description,
            ps.location, ps.price, ps.status, ps.created_at, ps.image_id, ps.credential,
            u.full_name AS provider_name, u.nid_status,
            c.name AS category_name,
            (SELECT COUNT(*) FROM favorites fv WHERE fv.user_id = ? AND fv.provider_id = u.id) AS is_favorite,
            (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE provider_id = u.id) AS avg_rating,
            (SELECT COUNT(*) FROM reviews WHERE provider_id = u.id) AS review_count
     FROM provider_services ps
     JOIN users u ON u.id = ps.provider_id
     LEFT JOIN categories c ON c.id = ps.category_id
     WHERE ${where.join(' AND ')}
     ${having}
     ORDER BY ${orderBy}`,
    [req.user.id, ...params]
  );

  res.json({ success: true, services });
});

// ---------- Provider: manage own listings ----------

router.get('/my-listings', requireAuth, requireRole('provider'), async (req, res) => {
  const [listings] = await db.query(
    `SELECT ps.*, c.name AS category_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.provider_service_id = ps.id) AS booking_count
     FROM provider_services ps
     LEFT JOIN categories c ON c.id = ps.category_id
     WHERE ps.provider_id = ?
     ORDER BY ps.created_at DESC`,
    [req.user.id]
  );

  res.json({ success: true, listings });
});

router.post('/my-listings', requireAuth, requireRole('provider'), requireVerified, async (req, res) => {
  const l = readListingBody(req.body);

  await checkCredential(l.categoryId);

  const imageId = (await ownedImageId(req.body.image_id, req.user.id)) || null;

  const [result] = await db.query(
    `INSERT INTO provider_services (provider_id, category_id, title, description, location, price, status, image_id, credential)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [req.user.id, l.categoryId, l.title, l.description, l.location, l.price, imageId, l.credential]
  );

  res.status(201).json({
    success: true,
    message: 'Service listing created.',
    id: result.insertId,
  });
});

async function loadOwnListing(id, userId) {
  const listingId = toId(id);
  if (!listingId) fail(400, 'Invalid listing ID.');

  const [rows] = await db.query(
    'SELECT * FROM provider_services WHERE id = ? AND provider_id = ?',
    [listingId, userId]
  );
  if (!rows.length) fail(404, 'Listing not found.');
  return rows[0];
}

router.put('/my-listings/:id', requireAuth, requireRole('provider'), async (req, res) => {
  const listing = await loadOwnListing(req.params.id, req.user.id);
  const l = readListingBody(req.body);
  await checkCredential(l.categoryId);
  const imageId = await ownedImageId(req.body.image_id, req.user.id);

  await db.query(
    `UPDATE provider_services
     SET category_id = ?, title = ?, description = ?, location = ?, price = ?, credential = ?
     WHERE id = ?`,
    [l.categoryId, l.title, l.description, l.location, l.price, l.credential, listing.id]
  );
  if (imageId !== undefined) {
    await db.query('UPDATE provider_services SET image_id = ? WHERE id = ?', [imageId, listing.id]);
    if (listing.image_id && listing.image_id !== imageId) await dropIfUnused(listing.image_id);
  }

  res.json({ success: true, message: 'Listing updated.' });
});

router.patch('/my-listings/:id/status', requireAuth, requireRole('provider'), async (req, res) => {
  const listing = await loadOwnListing(req.params.id, req.user.id);
  const status = req.body.status;

  if (!['active', 'inactive'].includes(status)) fail(400, 'Invalid status.');
  if (status === 'active' && listing.is_hidden) {
    fail(403, 'This listing was removed by a moderator.');
  }

  await db.query('UPDATE provider_services SET status = ? WHERE id = ?', [status, listing.id]);
  res.json({ success: true, message: `Listing is now ${status}.` });
});

// ---------- Bookings ----------

const ACTIVE_BOOKING = ['pending', 'accepted', 'in_progress'];

router.post('/bookings', requireAuth, requireRole('seeker'), requireVerified, async (req, res) => {
  const listingId = toId(req.body.provider_service_id);
  const date = typeof req.body.preferred_date === 'string' ? req.body.preferred_date : '';
  const message = str(req.body.message, 1000);

  if (!listingId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !message) {
    fail(400, 'Please provide a valid service, date and message.');
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) fail(400, 'Preferred date cannot be in the past.');

  const [rows] = await db.query(
    `SELECT ps.id, ps.provider_id, ps.title
     FROM provider_services ps
     JOIN users u ON u.id = ps.provider_id
     WHERE ps.id = ? AND ps.status = 'active' AND ps.is_hidden = 0 AND u.is_banned = 0`,
    [listingId]
  );
  if (!rows.length) fail(404, 'Provider service not found or inactive.');

  const [off] = await db.query('SELECT 1 FROM provider_days_off WHERE provider_id = ? AND day = ?', [rows[0].provider_id, date]);
  if (off.length) fail(409, 'The provider is not available on that date. Please pick another day.');

  const [dup] = await db.query(
    `SELECT id FROM bookings
     WHERE customer_id = ? AND provider_service_id = ? AND status IN (?)`,
    [req.user.id, listingId, ACTIVE_BOOKING]
  );
  if (dup.length) fail(409, 'You already have an active booking for this service.');

  const [result] = await db.query(
    `INSERT INTO bookings (customer_id, provider_service_id, preferred_date, message, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [req.user.id, listingId, date, message]
  );

  await notify(
    rows[0].provider_id,
    'booking_new',
    'New booking request',
    `${req.user.full_name} requested "${rows[0].title}".`,
    '/provider-bookings'
  );

  res.status(201).json({
    success: true,
    message: 'Booking request submitted successfully!',
    booking_id: result.insertId,
  });
});

const BOOKING_SELECT = `
  SELECT b.id, b.customer_id, b.provider_service_id, b.preferred_date, b.message,
         b.status, b.created_at,
         ps.title AS service_title, ps.location AS service_location,
         ps.price AS service_price, ps.provider_id,
         p.full_name AS provider_name,
         c.full_name AS customer_name,
         (SELECT COUNT(*) FROM reviews r
           WHERE r.booking_id = b.id AND r.reviewer_id = b.customer_id) AS reviewed
  FROM bookings b
  JOIN provider_services ps ON ps.id = b.provider_service_id
  JOIN users p ON p.id = ps.provider_id
  JOIN users c ON c.id = b.customer_id`;

router.get('/bookings/mine', requireAuth, requireRole('seeker'), async (req, res) => {
  const [bookings] = await db.query(
    `${BOOKING_SELECT} WHERE b.customer_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, bookings });
});

router.get('/bookings/incoming', requireAuth, requireRole('provider'), async (req, res) => {
  const [bookings] = await db.query(
    `${BOOKING_SELECT} WHERE ps.provider_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, bookings });
});

// Allowed moves: who can take a booking from one status to another.
const TRANSITIONS = {
  provider: {
    pending: ['accepted', 'rejected'],
    accepted: ['in_progress', 'cancelled'],
    in_progress: ['cancelled'],
  },
  seeker: {
    pending: ['cancelled'],
    accepted: ['cancelled'],
    in_progress: ['completed'],
  },
};

router.patch('/bookings/:id/status', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  const next = req.body.status;
  if (!id) fail(400, 'Invalid booking ID.');

  const [rows] = await db.query(
    `SELECT b.id, b.status, b.customer_id, ps.provider_id, ps.title
     FROM bookings b
     JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE b.id = ?`,
    [id]
  );
  const booking = rows[0];
  if (!booking) fail(404, 'Booking not found.');

  let actor = null;
  if (booking.customer_id === req.user.id) actor = 'seeker';
  else if (booking.provider_id === req.user.id) actor = 'provider';
  if (!actor) fail(404, 'Booking not found.');

  const allowed = (TRANSITIONS[actor][booking.status] || []);
  if (!allowed.includes(next)) {
    fail(409, `You cannot change a ${booking.status} booking to ${next}.`);
  }

  await db.query('UPDATE bookings SET status = ? WHERE id = ?', [next, id]);
  if (next === 'completed') await releaseForJob({ bookingId: id });

  const other = actor === 'seeker' ? booking.provider_id : booking.customer_id;
  await notify(
    other,
    'booking_status',
    `Booking ${next.replace('_', ' ')}`,
    `"${booking.title}" is now ${next.replace('_', ' ')}.`,
    actor === 'seeker' ? '/provider-bookings' : '/my-bookings'
  );

  res.json({ success: true, message: `Booking ${next.replace('_', ' ')}.` });
});

// ---------- Provider overview and earnings ----------

router.get('/provider/overview', requireAuth, requireRole('provider'), async (req, res) => {
  const id = req.user.id;

  const [[bookingStats]] = await db.query(
    `SELECT
       COALESCE(SUM(b.status = 'pending'), 0) AS pending_bookings,
       COALESCE(SUM(b.status IN ('accepted', 'in_progress')), 0) AS active_bookings,
       COALESCE(SUM(b.status = 'completed'), 0) AS completed_bookings,
       COALESCE(SUM(CASE WHEN b.status = 'completed' THEN ps.price END), 0) AS booking_earnings
     FROM bookings b
     JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE ps.provider_id = ?`,
    [id]
  );

  const [[workStats]] = await db.query(
    `SELECT
       COALESCE(SUM(status IN ('assigned', 'in_progress')), 0) AS active_jobs,
       COALESCE(SUM(status = 'completed'), 0) AS completed_jobs,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN budget END), 0) AS job_earnings
     FROM services WHERE assigned_provider_id = ?`,
    [id]
  );

  const [[appStats]] = await db.query(
    `SELECT COALESCE(SUM(status = 'pending'), 0) AS pending_applications,
            COUNT(*) AS total_applications
     FROM applications WHERE provider_id = ?`,
    [id]
  );

  const [[rating]] = await db.query(
    `SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS avg_rating
     FROM reviews WHERE provider_id = ?`,
    [id]
  );

  const [[paid]] = await db.query(
    `SELECT COALESCE(SUM(status = 'paid'), 0) AS paid_count,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS received,
            COALESCE(SUM(status = 'pending'), 0) AS payments_to_confirm
     FROM payments WHERE payee_id = ?`,
    [id]
  );

  const [[listings]] = await db.query(
    `SELECT COUNT(*) AS total FROM provider_services WHERE provider_id = ?`,
    [id]
  );

  res.json({
    success: true,
    overview: {
      ...bookingStats,
      ...workStats,
      ...appStats,
      ...rating,
      ...paid,
      listings: listings.total,
      total_earnings:
        Number(bookingStats.booking_earnings) + Number(workStats.job_earnings),
    },
  });
});

router.get('/seeker/overview', requireAuth, requireRole('seeker'), async (req, res) => {
  const id = req.user.id;

  const [[work]] = await db.query(
    `SELECT COUNT(*) AS total_work,
            COALESCE(SUM(status = 'open'), 0) AS open_work,
            COALESCE(SUM(status IN ('assigned', 'in_progress')), 0) AS active_work,
            COALESCE(SUM(status = 'completed'), 0) AS completed_work
     FROM services WHERE seeker_id = ?`,
    [id]
  );

  const [[apps]] = await db.query(
    `SELECT COUNT(*) AS pending_applications
     FROM applications a JOIN services s ON s.id = a.service_id
     WHERE s.seeker_id = ? AND a.status = 'pending'`,
    [id]
  );

  const [[bookings]] = await db.query(
    `SELECT COUNT(*) AS total_bookings,
            COALESCE(SUM(status IN ('pending', 'accepted', 'in_progress')), 0) AS active_bookings
     FROM bookings WHERE customer_id = ?`,
    [id]
  );

  res.json({ success: true, overview: { ...work, ...apps, ...bookings } });
});

module.exports = router;
