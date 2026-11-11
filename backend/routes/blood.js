const express = require('express');

const db = require('../db');
const { requireAuth } = require('../auth');
const { fail, toId, str, notify } = require('../helpers');

const router = express.Router();

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const REST_DAYS = 90; // a donor can give blood again after about three months
const REQUEST_DAYS = 3; // a request disappears by itself after three days
const MAX_OPEN_REQUESTS = 3;
const MAX_REQUESTS_PER_DAY = 5;
const MAX_ALERTS = 100;

function readGroup(value, required = true) {
  const group = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!group) {
    if (required) fail(400, 'Choose a blood group.');
    return '';
  }
  if (!GROUPS.includes(group)) fail(400, 'That is not a blood group.');
  return group;
}

// A Bangladeshi mobile number, kept as 01XXXXXXXXX.
function readPhone(value) {
  const digits = String(value || '').replace(/[\s-]/g, '').replace(/^\+?88/, '');
  if (!/^01[3-9]\d{8}$/.test(digits)) fail(400, 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
  return digits;
}

function readDay(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Enter the date as year-month-day.');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) fail(400, 'The last donation date cannot be in the future.');
  return value;
}

// ---------- The emergency page: what is on offer, in one call ----------

router.get('/emergency', requireAuth, async (req, res) => {
  const count = async (sql, params = []) => Number((await db.query(sql, params))[0][0].c);

  res.json({
    success: true,
    ambulance: {
      total: await count("SELECT COUNT(*) AS c FROM ambulances WHERE status <> 'off'"),
      available: await count("SELECT COUNT(*) AS c FROM ambulances WHERE status = 'available'"),
    },
    doctor: { listings: await count('SELECT COUNT(*) AS c FROM doctors WHERE is_active = 1') },
    blood: {
      donors:
        (await count(`SELECT COUNT(*) AS c FROM blood_donors d JOIN users u ON u.id = d.user_id WHERE d.is_available = 1 AND u.is_banned = 0`)) +
        (await count('SELECT COUNT(*) AS c FROM blood_donors_managed WHERE is_available = 1')),
      open_requests: await count(`SELECT COUNT(*) AS c FROM blood_requests WHERE status = 'open' AND expires_at > NOW()`),
    },
  });
});

// ---------- Donors ----------

router.get('/blood/me', requireAuth, async (req, res) => {
  const [rows] = await db.query(
    'SELECT blood_group, area, is_available, share_phone, last_donated FROM blood_donors WHERE user_id = ?',
    [req.user.id]
  );
  res.json({ success: true, donor: rows[0] ? { ...rows[0], is_available: !!rows[0].is_available, share_phone: !!rows[0].share_phone } : null });
});

router.put('/blood/me', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') fail(403, 'Admins cannot register as donors.');

  const group = readGroup(req.body.blood_group);
  const area = str(req.body.area, 100);
  if (area.length < 2) fail(400, 'Tell us the area you live in, for example Mirpur, Dhaka.');
  const available = req.body.is_available === false ? 0 : 1;
  const sharePhone = req.body.share_phone ? 1 : 0;
  const lastDonated = readDay(req.body.last_donated);

  if (sharePhone && !req.user.phone) fail(400, 'Add a phone number to your profile first, or keep your number private.');

  await db.query(
    `INSERT INTO blood_donors (user_id, blood_group, area, is_available, share_phone, last_donated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE blood_group = VALUES(blood_group), area = VALUES(area), is_available = VALUES(is_available),
       share_phone = VALUES(share_phone), last_donated = VALUES(last_donated)`,
    [req.user.id, group, area, available, sharePhone, lastDonated]
  );
  res.json({ success: true, message: 'You are in the blood donor list. Thank you.' });
});

router.delete('/blood/me', requireAuth, async (req, res) => {
  await db.query('DELETE FROM blood_donors WHERE user_id = ?', [req.user.id]);
  res.json({ success: true, message: 'You were removed from the donor list.' });
});

// Find donors. A phone number is shown only when the donor chose to share it.
router.get('/blood/donors', requireAuth, async (req, res) => {
  const where = ['d.is_available = 1', 'u.is_banned = 0', 'd.user_id <> ?'];
  const params = [req.user.id];

  const group = readGroup(req.query.group, false);
  if (group) {
    where.push('d.blood_group = ?');
    params.push(group);
  }
  const area = str(req.query.area, 100);
  if (area) {
    where.push('d.area LIKE ?');
    params.push(`%${area}%`);
  }
  if (req.query.eligible === '1') where.push(`(d.last_donated IS NULL OR d.last_donated <= CURDATE() - INTERVAL ${REST_DAYS} DAY)`);

  const [rows] = await db.query(
    `SELECT u.id, u.full_name, u.avatar_image_id, d.blood_group, d.area, d.last_donated,
            (d.last_donated IS NULL OR d.last_donated <= CURDATE() - INTERVAL ${REST_DAYS} DAY) AS eligible_now,
            IF(d.share_phone = 1, u.phone, NULL) AS phone
     FROM blood_donors d JOIN users u ON u.id = d.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY eligible_now DESC, d.last_donated ASC
     LIMIT 100`,
    params
  );
  // Donors added by an admin are listed with the rest. They have no account, so their ids start with "m".
  const managedWhere = ['is_available = 1'];
  const managedParams = [];
  if (group) {
    managedWhere.push('blood_group = ?');
    managedParams.push(group);
  }
  if (area) {
    managedWhere.push('area LIKE ?');
    managedParams.push(`%${area}%`);
  }
  if (req.query.eligible === '1') managedWhere.push(`(last_donated IS NULL OR last_donated <= CURDATE() - INTERVAL ${REST_DAYS} DAY)`);
  const [managed] = await db.query(
    `SELECT CONCAT('m', id) AS id, full_name, NULL AS avatar_image_id, blood_group, area, last_donated,
            (last_donated IS NULL OR last_donated <= CURDATE() - INTERVAL ${REST_DAYS} DAY) AS eligible_now,
            IF(share_phone = 1, phone, NULL) AS phone
     FROM blood_donors_managed WHERE ${managedWhere.join(' AND ')} LIMIT 100`,
    managedParams
  );

  const donors = [...rows, ...managed]
    .map((r) => ({ ...r, eligible_now: !!r.eligible_now }))
    .sort((a, b) => Number(b.eligible_now) - Number(a.eligible_now));
  res.json({ success: true, donors });
});

// ---------- Requests ----------

router.post('/blood/requests', requireAuth, async (req, res) => {
  const group = readGroup(req.body.blood_group);
  const units = Math.round(Number(req.body.units) || 1);
  if (units < 1 || units > 10) fail(400, 'Units must be between 1 and 10.');
  const hospital = str(req.body.hospital, 150);
  const area = str(req.body.area, 100);
  const note = str(req.body.note, 300) || null;
  const phone = readPhone(req.body.contact_phone);
  const urgent = req.body.urgent ? 1 : 0;
  if (hospital.length < 3) fail(400, 'Write the hospital or place where blood is needed.');
  if (area.length < 2) fail(400, 'Write the area, for example Dhanmondi, Dhaka.');

  const [[open]] = await db.query(
    `SELECT COUNT(*) AS c FROM blood_requests WHERE requester_id = ? AND status = 'open' AND expires_at > NOW()`,
    [req.user.id]
  );
  if (open.c >= MAX_OPEN_REQUESTS) fail(429, 'You already have open requests. Close one before you post another.');
  const [[today]] = await db.query('SELECT COUNT(*) AS c FROM blood_requests WHERE requester_id = ? AND created_at > NOW() - INTERVAL 1 DAY', [
    req.user.id,
  ]);
  if (today.c >= MAX_REQUESTS_PER_DAY) fail(429, 'You have posted many requests today. Please try again tomorrow.');

  const [result] = await db.query(
    `INSERT INTO blood_requests (requester_id, blood_group, units, hospital, area, note, contact_phone, urgent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${REQUEST_DAYS} DAY))`,
    [req.user.id, group, units, hospital, area, note, phone, urgent]
  );

  // Tell donors of this blood group who can give blood now.
  const [donors] = await db.query(
    `SELECT d.user_id FROM blood_donors d JOIN users u ON u.id = d.user_id
     WHERE d.blood_group = ? AND d.is_available = 1 AND u.is_banned = 0 AND d.user_id <> ?
       AND (d.last_donated IS NULL OR d.last_donated <= CURDATE() - INTERVAL ${REST_DAYS} DAY)
     ORDER BY (d.area LIKE ?) DESC
     LIMIT ${MAX_ALERTS}`,
    [group, req.user.id, `%${area}%`]
  );
  for (const donor of donors) {
    await notify(
      donor.user_id,
      'blood_request',
      `${urgent ? 'Urgent: ' : ''}${group} blood needed`,
      `${units} ${units === 1 ? 'bag' : 'bags'} at ${hospital}, ${area}.`,
      '/blood?tab=requests'
    );
  }

  res.status(201).json({ success: true, id: result.insertId, alerted: donors.length, message: 'Your request is posted.' });
});

// Open requests. The requester's phone stays hidden until a donor says "I can donate".
router.get('/blood/requests', requireAuth, async (req, res) => {
  const where = [`r.status = 'open'`, 'r.expires_at > NOW()', 'u.is_banned = 0'];
  const params = [req.user.id];

  const group = readGroup(req.query.group, false);
  if (group) {
    where.push('r.blood_group = ?');
    params.push(group);
  }

  const [rows] = await db.query(
    `SELECT r.id, r.requester_id, r.blood_group, r.units, r.hospital, r.area, r.note, r.urgent, r.created_at,
            u.full_name AS requester_name,
            (SELECT COUNT(*) FROM blood_offers o WHERE o.request_id = r.id) AS offers,
            (SELECT COUNT(*) FROM blood_offers o WHERE o.request_id = r.id AND o.donor_id = ?) AS i_offered
     FROM blood_requests r JOIN users u ON u.id = r.requester_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.urgent DESC, r.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({
    success: true,
    requests: rows.map((r) => ({ ...r, urgent: !!r.urgent, offers: Number(r.offers), i_offered: Number(r.i_offered) > 0, mine: r.requester_id === req.user.id })),
  });
});

router.get('/blood/requests/mine', requireAuth, async (req, res) => {
  const [requests] = await db.query(
    `SELECT id, blood_group, units, hospital, area, note, contact_phone, urgent, status, created_at, expires_at,
            (expires_at <= NOW()) AS expired
     FROM blood_requests WHERE requester_id = ? ORDER BY created_at DESC LIMIT 30`,
    [req.user.id]
  );
  const ids = requests.map((r) => r.id);
  const offers = ids.length
    ? (
        await db.query(
          `SELECT o.request_id, o.created_at, u.id AS donor_id, u.full_name, u.phone
           FROM blood_offers o JOIN users u ON u.id = o.donor_id WHERE o.request_id IN (?) ORDER BY o.created_at ASC`,
          [ids]
        )
      )[0]
    : [];
  res.json({
    success: true,
    requests: requests.map((r) => ({
      ...r,
      urgent: !!r.urgent,
      expired: !!r.expired,
      offers: offers.filter((o) => o.request_id === r.id),
    })),
  });
});

// "I can donate": the donor agrees to share their name and number with the person who asked, and sees theirs.
router.post('/blood/requests/:id/offer', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  if (!req.user.phone) fail(400, 'Add your phone number to your profile first, so the family can call you.');

  const [rows] = await db.query(
    `SELECT id, requester_id, blood_group, hospital, area, contact_phone
     FROM blood_requests WHERE id = ? AND status = 'open' AND expires_at > NOW()`,
    [id]
  );
  if (!rows.length) fail(404, 'This request is no longer open.');
  const request = rows[0];
  if (request.requester_id === req.user.id) fail(400, 'You cannot offer to your own request.');

  const [dup] = await db.query('SELECT id FROM blood_offers WHERE request_id = ? AND donor_id = ?', [id, req.user.id]);
  if (dup.length) fail(409, 'You already offered to donate for this request.');

  await db.query('INSERT INTO blood_offers (request_id, donor_id) VALUES (?, ?)', [id, req.user.id]);
  await notify(
    request.requester_id,
    'blood_offer',
    `${req.user.full_name} can donate ${request.blood_group} blood`,
    `Call ${req.user.phone}. Their name and number are shared with you for this request only.`,
    '/blood?tab=requests'
  );

  res.status(201).json({
    success: true,
    message: 'Thank you. The family was told, and they will call you.',
    contact_phone: request.contact_phone,
    hospital: request.hospital,
    area: request.area,
  });
});

router.patch('/blood/requests/:id', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const status = req.body.status;
  if (!['fulfilled', 'closed'].includes(status)) fail(400, 'Choose fulfilled or closed.');

  const [result] = await db.query(`UPDATE blood_requests SET status = ? WHERE id = ? AND requester_id = ? AND status = 'open'`, [
    status,
    id,
    req.user.id,
  ]);
  if (!result.affectedRows) fail(404, 'Open request not found.');
  res.json({ success: true, message: status === 'fulfilled' ? 'Glad you found blood. The request is closed.' : 'The request is closed.' });
});

module.exports = router;
