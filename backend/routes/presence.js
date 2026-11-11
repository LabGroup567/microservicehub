const express = require('express');

const db = require('../db');
const { requireAuth, requireRole, requireVerified } = require('../auth');
const { fail, toId } = require('../helpers');

const router = express.Router();

// A provider who turns on "Available now" shows up on the map. Their exact spot is never stored:
// it is rounded to a grid of about 500 m. While their app is open they are "live" (updated in the last
// 15 minutes). After they close it they stay on the map as "last seen" for up to 3 hours, then drop off.
const LIVE_MINUTES = 15;
const KEEP_MINUTES = 180;
const GRID = 0.005;

const round = (value) => Math.round(value / GRID) * GRID;
const toCoord = (value, limit) => {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A provider says where they are right now (called every minute or so while the page is open).
router.put('/presence', requireAuth, requireRole('provider'), requireVerified, async (req, res) => {
  const lat = toCoord(req.body.lat, 90);
  const lng = toCoord(req.body.lng, 180);
  if (lat === null || lng === null) fail(400, 'Your location could not be read. Please try again.');

  await db.query(
    `INSERT INTO provider_presence (provider_id, lat, lng) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), updated_at = NOW()`,
    [req.user.id, round(lat).toFixed(5), round(lng).toFixed(5)]
  );
  res.json({ success: true, message: 'You are shown as available.' });
});

router.delete('/presence', requireAuth, requireRole('provider'), async (req, res) => {
  await db.query('DELETE FROM provider_presence WHERE provider_id = ?', [req.user.id]);
  res.json({ success: true, message: 'You are no longer shown on the map.' });
});

router.get('/presence/me', requireAuth, requireRole('provider'), async (req, res) => {
  const [rows] = await db.query(
    'SELECT updated_at, TIMESTAMPDIFF(MINUTE, updated_at, NOW()) AS minutes_ago FROM provider_presence WHERE provider_id = ?',
    [req.user.id]
  );
  const minutes = rows.length ? Number(rows[0].minutes_ago) : null;
  res.json({
    success: true,
    on: rows.length > 0,
    fresh: minutes !== null && minutes <= LIVE_MINUTES,
    visible: minutes !== null && minutes <= KEEP_MINUTES,
    updated_at: rows[0]?.updated_at || null,
  });
});

// Seekers (and admins) see who is available right now. Sorted by distance when the caller shares their own position.
router.get('/nearby-providers', requireAuth, async (req, res) => {
  if (!['seeker', 'admin'].includes(req.user.role)) fail(403, 'Only seekers can look for nearby providers.');

  const lat = req.query.lat === undefined ? null : toCoord(req.query.lat, 90);
  const lng = req.query.lng === undefined ? null : toCoord(req.query.lng, 180);
  const here = lat !== null && lng !== null;
  const radius = Math.min(200, Math.max(1, Number(req.query.radius_km) || 25));
  const categoryId = toId(req.query.category_id);

  // Old rows are no use to anyone: clear them out so a spot is not kept longer than it needs to be.
  await db.query('DELETE FROM provider_presence WHERE updated_at < NOW() - INTERVAL 12 HOUR');

  const where = [`pp.updated_at > NOW() - INTERVAL ${KEEP_MINUTES} MINUTE`, `u.role = 'provider'`, 'u.is_banned = 0', `u.kyc_status = 'verified'`];
  const params = [];
  if (categoryId) {
    where.push(`EXISTS (SELECT 1 FROM provider_services ps WHERE ps.provider_id = u.id AND ps.category_id = ? AND ps.status = 'active' AND ps.is_hidden = 0)`);
    params.push(categoryId);
  }

  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.avatar_image_id, pp.lat, pp.lng,
            TIMESTAMPDIFF(MINUTE, pp.updated_at, NOW()) AS minutes_ago,
            (SELECT GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR '|')
               FROM provider_services ps JOIN categories c ON c.id = ps.category_id
              WHERE ps.provider_id = u.id AND ps.status = 'active' AND ps.is_hidden = 0) AS categories,
            (SELECT COUNT(*) FROM reviews r WHERE r.provider_id = u.id) AS review_count
     FROM provider_presence pp
     JOIN users u ON u.id = pp.provider_id
     WHERE ${where.join(' AND ')}
     LIMIT 300`,
    params
  );

  let providers = rows.map((row) => ({
    id: row.id,
    full_name: row.full_name,
    avatar_image_id: row.avatar_image_id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    minutes_ago: Number(row.minutes_ago),
    live: Number(row.minutes_ago) <= LIVE_MINUTES,
    categories: row.categories ? String(row.categories).split('|').slice(0, 4) : [],
    review_count: Number(row.review_count),
    distance_km: here ? Math.round(distanceKm(lat, lng, Number(row.lat), Number(row.lng)) * 10) / 10 : null,
  }));

  if (here) {
    providers = providers.filter((p) => p.distance_km <= radius).sort((a, b) => a.distance_km - b.distance_km);
  } else {
    providers.sort((a, b) => Number(b.live) - Number(a.live) || a.minutes_ago - b.minutes_ago);
  }

  res.json({ success: true, live_minutes: LIVE_MINUTES, keep_minutes: KEEP_MINUTES, providers: providers.slice(0, 100) });
});

module.exports = router;
