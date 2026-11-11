const express = require('express');

const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// One call for the "Explore services" screen: every service type with how much is on offer,
// what people have been booking lately, and how many bookings this seeker has going.
router.get('/explore', requireAuth, async (req, res) => {
  const [categories] = await db.query(
    `SELECT c.id, c.name, c.description,
            (SELECT COUNT(*) FROM provider_services ps JOIN users u ON u.id = ps.provider_id
              WHERE ps.category_id = c.id AND ps.status = 'active' AND ps.is_hidden = 0 AND u.is_banned = 0) AS listings,
            (SELECT COUNT(*) FROM services s
              WHERE s.category_id = c.id AND s.status = 'open' AND s.is_hidden = 0
                AND (s.expires_at IS NULL OR s.expires_at > NOW())) AS open_work
     FROM categories c
     ORDER BY listings DESC, open_work DESC, c.name ASC`
  );

  const [popular] = await db.query(
    `SELECT ps.id, ps.provider_id, ps.title, ps.description, ps.price, ps.location, ps.image_id,
            c.name AS category_name, u.full_name AS provider_name,
            (SELECT COUNT(*) FROM bookings b
              WHERE b.provider_service_id = ps.id AND b.created_at >= NOW() - INTERVAL 30 DAY) AS recent_bookings
     FROM provider_services ps
     JOIN users u ON u.id = ps.provider_id
     LEFT JOIN categories c ON c.id = ps.category_id
     WHERE ps.status = 'active' AND ps.is_hidden = 0 AND u.is_banned = 0
       AND (c.name IS NULL OR c.name NOT IN ('Ambulance', 'Online Doctor'))
     ORDER BY recent_bookings DESC, ps.created_at DESC
     LIMIT 8`
  );

  let activeBookings = 0;
  if (req.user.role === 'seeker') {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS c FROM bookings WHERE customer_id = ? AND status IN ('pending', 'accepted')`,
      [req.user.id]
    );
    activeBookings = Number(row.c);
  }

  // Ambulances and doctors are run by the admins, so their tiles count those instead of provider listings.
  const [[amb]] = await db.query("SELECT COUNT(*) AS c FROM ambulances WHERE status <> 'off'");
  const [[docs]] = await db.query("SELECT COUNT(*) AS c FROM doctors WHERE is_active = 1");
  const adminRun = { Ambulance: Number(amb.c), 'Online Doctor': Number(docs.c) };

  res.json({
    success: true,
    categories: categories.map((c) => ({ ...c, listings: c.name in adminRun ? adminRun[c.name] : Number(c.listings), open_work: Number(c.open_work), admin_run: c.name in adminRun })),
    popular: popular.map((p) => ({ ...p, price: Number(p.price), recent_bookings: Number(p.recent_bookings) })),
    my_active_bookings: activeBookings,
  });
});

module.exports = router;
