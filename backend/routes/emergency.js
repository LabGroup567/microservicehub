const crypto = require('crypto');
const express = require('express');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, str, notify, notifyRole } = require('../helpers');

const router = express.Router();

// Ambulances, doctors and blood-bank moderation belong to the admins only. Everyone else can use them.
const adminOnly = [requireAuth, requireRole('admin')];
const notAdmin = (req) => {
  if (req.user.role === 'admin') fail(403, 'Admins manage this service. Use a normal account to request it.');
};

// A Bangladeshi mobile number, kept as 01XXXXXXXXX.
function readPhone(value, message = 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).') {
  const digits = String(value || '').replace(/[\s-]/g, '').replace(/^\+?88/, '');
  if (!/^01[3-9]\d{8}$/.test(digits)) fail(400, message);
  return digits;
}

const STALE_SECONDS = 120; // a position older than this is shown as "last seen"
const ACTIVE_LIMIT = 1; // one ambulance at a time for one person
const MAX_PENDING_CHECKUPS = 3;

function readCoords(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    fail(400, 'Send a valid latitude and longitude.');
  }
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function readAmbulance(body) {
  const name = str(body.name, 100);
  const driver = str(body.driver_name, 100);
  const area = str(body.area, 100);
  const vehicle = str(body.vehicle_no, 40) || null;
  if (name.length < 2) fail(400, 'Give the ambulance a name, for example "City Care Ambulance 1".');
  if (driver.length < 2) fail(400, 'Enter the driver name.');
  if (area.length < 2) fail(400, 'Enter the area it serves, for example Mirpur, Dhaka.');
  return { name, driver, phone: readPhone(body.phone), vehicle, area };
}

const publicAmbulance = (a) => ({
  id: a.id,
  name: a.name,
  area: a.area,
  vehicle_no: a.vehicle_no,
  status: a.status,
  has_location: a.lat != null,
});

// ======================================================================
// Ambulances: people choose one, and the one they chose shows live on a map.
// ======================================================================

router.get('/ambulances', requireAuth, async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name, area, vehicle_no, status, lat FROM ambulances WHERE status <> 'off'
     ORDER BY (status = 'available') DESC, name ASC`
  );
  res.json({ success: true, ambulances: rows.map(publicAmbulance) });
});

// The request joined with the ambulance. The live position is only given to the person who chose it, or an admin.
async function loadRequest(id, user) {
  const requestId = toId(id);
  if (!requestId) fail(400, 'Invalid request.');
  const [rows] = await db.query(
    `SELECT r.id, r.ambulance_id, r.user_id, r.pickup, r.phone AS patient_phone, r.note, r.status, r.created_at, r.closed_at,
            a.name AS ambulance_name, a.driver_name, a.phone AS driver_phone, a.vehicle_no, a.area, a.lat, a.lng, a.location_at,
            TIMESTAMPDIFF(SECOND, a.location_at, NOW()) AS location_age,
            u.full_name AS user_name
     FROM ambulance_requests r
     JOIN ambulances a ON a.id = r.ambulance_id
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [requestId]
  );
  const row = rows[0];
  if (!row || (row.user_id !== user.id && user.role !== 'admin')) fail(404, 'Ambulance request not found.');
  return row;
}

function shapeRequest(r) {
  const live = r.status === 'active';
  return {
    id: r.id,
    status: r.status,
    pickup: r.pickup,
    patient_phone: r.patient_phone,
    note: r.note,
    created_at: r.created_at,
    user_name: r.user_name,
    ambulance: {
      id: r.ambulance_id,
      name: r.ambulance_name,
      driver_name: live ? r.driver_name : null,
      phone: live ? r.driver_phone : null,
      vehicle_no: r.vehicle_no,
      area: r.area,
    },
    // The position is only shared while the request is active.
    location:
      live && r.lat != null
        ? { lat: Number(r.lat), lng: Number(r.lng), updated_at: r.location_at, age_seconds: r.location_age == null ? null : Number(r.location_age), live: r.location_age != null && Number(r.location_age) <= STALE_SECONDS }
        : null,
  };
}

router.post('/ambulances/:id/request', requireAuth, async (req, res) => {
  notAdmin(req);
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid ambulance.');
  const pickup = str(req.body.pickup, 255);
  const note = str(req.body.note, 300) || null;
  if (pickup.length < 5) fail(400, 'Write the address where the ambulance should come, for example House 5, Road 3, Mirpur.');
  const phone = readPhone(req.body.phone, 'Enter a phone number the driver can call (01XXXXXXXXX).');

  const [[mine]] = await db.query(`SELECT COUNT(*) AS c FROM ambulance_requests WHERE user_id = ? AND status = 'active'`, [req.user.id]);
  if (mine.c >= ACTIVE_LIMIT) fail(409, 'You already have an ambulance on the way. Cancel it first to choose another.');

  const conn = await db.getConnection();
  let requestId;
  let ambulance;
  try {
    await conn.beginTransaction();
    const [taken] = await conn.query(`UPDATE ambulances SET status = 'busy' WHERE id = ? AND status = 'available'`, [id]);
    if (!taken.affectedRows) fail(409, 'This ambulance is not available now. Please choose another one.');
    const [made] = await conn.query('INSERT INTO ambulance_requests (ambulance_id, user_id, pickup, phone, note) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, pickup, phone, note]);
    requestId = made.insertId;
    [[ambulance]] = await conn.query('SELECT name FROM ambulances WHERE id = ?', [id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await notifyRole('admin', 'ambulance_request', `Ambulance chosen: ${ambulance.name}`, `${req.user.full_name} (${phone}) at ${pickup}.`, '/admin?tab=emergency');

  res.status(201).json({ success: true, id: requestId, message: 'Ambulance chosen. You can follow it on the map now.' });
});

router.get('/ambulances/requests/mine', requireAuth, async (req, res) => {
  const [rows] = await db.query(`SELECT id FROM ambulance_requests WHERE user_id = ? ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, [req.user.id]);
  if (!rows.length) return res.json({ success: true, request: null });
  res.json({ success: true, request: shapeRequest(await loadRequest(rows[0].id, req.user)) });
});

router.get('/ambulances/requests/:id', requireAuth, async (req, res) => {
  res.json({ success: true, request: shapeRequest(await loadRequest(req.params.id, req.user)) });
});

// The person cancels, or an admin marks the trip finished. The ambulance becomes free again.
router.patch('/ambulances/requests/:id', requireAuth, async (req, res) => {
  const request = await loadRequest(req.params.id, req.user);
  const status = req.body.status;
  const isAdmin = req.user.role === 'admin';
  if (!['cancelled', 'completed'].includes(status)) fail(400, 'Choose cancelled or completed.');
  if (status === 'completed' && !isAdmin) fail(403, 'Only an admin can mark the trip as completed.');
  if (request.status !== 'active') fail(409, 'This ambulance request is already closed.');

  await db.query(`UPDATE ambulance_requests SET status = ?, closed_at = NOW() WHERE id = ? AND status = 'active'`, [status, request.id]);
  await db.query(`UPDATE ambulances SET status = 'available' WHERE id = ? AND status = 'busy'`, [request.ambulance_id]);

  if (isAdmin && request.user_id !== req.user.id) {
    await notify(request.user_id, 'ambulance_status', status === 'completed' ? 'Ambulance trip completed' : 'Ambulance request cancelled', `${request.ambulance_name} is no longer assigned to you.`, '/emergency/ambulances');
  }
  res.json({ success: true, message: status === 'completed' ? 'Trip marked as completed.' : 'Ambulance request cancelled.' });
});

// ---- admin: manage ambulances ----

router.get('/admin/ambulances', adminOnly, async (req, res) => {
  const [rows] = await db.query(
    `SELECT a.*, TIMESTAMPDIFF(SECOND, a.location_at, NOW()) AS location_age,
            (SELECT r.id FROM ambulance_requests r WHERE r.ambulance_id = a.id AND r.status = 'active' LIMIT 1) AS active_request_id
     FROM ambulances a ORDER BY a.created_at DESC`
  );
  res.json({
    success: true,
    ambulances: rows.map((a) => ({
      id: a.id,
      name: a.name,
      driver_name: a.driver_name,
      phone: a.phone,
      vehicle_no: a.vehicle_no,
      area: a.area,
      status: a.status,
      track_token: a.track_token,
      location: a.lat == null ? null : { lat: Number(a.lat), lng: Number(a.lng), updated_at: a.location_at, age_seconds: a.location_age == null ? null : Number(a.location_age), live: a.location_age != null && Number(a.location_age) <= STALE_SECONDS },
      active_request_id: a.active_request_id,
    })),
  });
});

router.post('/admin/ambulances', adminOnly, async (req, res) => {
  const a = readAmbulance(req.body);
  const token = crypto.randomBytes(16).toString('hex');
  const [result] = await db.query(
    'INSERT INTO ambulances (name, driver_name, phone, vehicle_no, area, track_token) VALUES (?, ?, ?, ?, ?, ?)',
    [a.name, a.driver, a.phone, a.vehicle, a.area, token]
  );
  res.status(201).json({ success: true, id: result.insertId, message: 'Ambulance added.' });
});

router.put('/admin/ambulances/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid ambulance.');
  const a = readAmbulance(req.body);
  const status = ['available', 'off'].includes(req.body.status) ? req.body.status : null;

  const [rows] = await db.query('SELECT status FROM ambulances WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'Ambulance not found.');
  // A busy ambulance stays busy until its trip ends.
  const next = rows[0].status === 'busy' ? 'busy' : status || rows[0].status;

  await db.query('UPDATE ambulances SET name = ?, driver_name = ?, phone = ?, vehicle_no = ?, area = ?, status = ? WHERE id = ?', [a.name, a.driver, a.phone, a.vehicle, a.area, next, id]);
  res.json({ success: true, message: 'Ambulance updated.' });
});

router.patch('/admin/ambulances/:id/location', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid ambulance.');
  const { lat, lng } = readCoords(req.body);
  const [result] = await db.query('UPDATE ambulances SET lat = ?, lng = ?, location_at = NOW() WHERE id = ?', [lat, lng, id]);
  if (!result.affectedRows) fail(404, 'Ambulance not found.');
  res.json({ success: true, message: 'Position saved.' });
});

router.post('/admin/ambulances/:id/token', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid ambulance.');
  const token = crypto.randomBytes(16).toString('hex');
  const [result] = await db.query('UPDATE ambulances SET track_token = ? WHERE id = ?', [token, id]);
  if (!result.affectedRows) fail(404, 'Ambulance not found.');
  res.json({ success: true, track_token: token, message: 'New driver link created. The old link stops working.' });
});

router.delete('/admin/ambulances/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid ambulance.');
  const [rows] = await db.query('SELECT name FROM ambulances WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'Ambulance not found.');

  const [waiting] = await db.query(`SELECT user_id FROM ambulance_requests WHERE ambulance_id = ? AND status = 'active'`, [id]);
  await db.query('DELETE FROM ambulances WHERE id = ?', [id]);
  for (const w of waiting) {
    await notify(w.user_id, 'ambulance_status', 'Your ambulance was removed', `${rows[0].name} is no longer available. Please choose another ambulance, or call 999.`, '/emergency/ambulances');
  }
  res.json({ success: true, message: 'Ambulance removed.' });
});

router.get('/admin/ambulance-requests', adminOnly, async (req, res) => {
  const onlyActive = req.query.status !== 'all';
  const [rows] = await db.query(
    `SELECT r.id FROM ambulance_requests r ${onlyActive ? `WHERE r.status = 'active'` : ''} ORDER BY r.id DESC LIMIT 50`
  );
  const requests = [];
  for (const { id } of rows) requests.push(shapeRequest(await loadRequest(id, req.user)));
  res.json({ success: true, requests });
});

// ---- the driver's phone: no login, just a secret link made by an admin ----

router.get('/ambulance-track/:token', async (req, res) => {
  const [rows] = await db.query('SELECT name, driver_name, vehicle_no FROM ambulances WHERE track_token = ?', [str(req.params.token, 40)]);
  if (!rows.length) fail(404, 'This tracking link is not valid any more. Ask the admin for a new one.');
  res.json({ success: true, ambulance: rows[0] });
});

router.post('/ambulance-track/:token', async (req, res) => {
  const { lat, lng } = readCoords(req.body);
  const [result] = await db.query('UPDATE ambulances SET lat = ?, lng = ?, location_at = NOW() WHERE track_token = ?', [lat, lng, str(req.params.token, 40)]);
  if (!result.affectedRows) fail(404, 'This tracking link is not valid any more. Ask the admin for a new one.');
  res.json({ success: true });
});

// ======================================================================
// Doctors: the admins talk to each doctor personally; people ask for a checkup, an admin approves
// it and sends the meeting link.
// ======================================================================

function readDoctor(body) {
  const name = str(body.full_name, 100);
  const specialty = str(body.specialty, 100);
  const regNo = str(body.reg_no, 60);
  const fee = Number(body.fee);
  if (name.length < 3) fail(400, 'Enter the doctor name.');
  if (specialty.length < 3) fail(400, 'Enter the specialty, for example Medicine or Child specialist.');
  if (regNo.length < 3) fail(400, 'Enter the doctor registration number (BMDC).');
  if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) fail(400, 'Enter the fee in BDT (0 if free).');
  const phone = body.phone ? readPhone(body.phone) : null;
  return { name, specialty, regNo, fee, qualification: str(body.qualification, 150) || null, bio: str(body.bio, 300) || null, phone };
}

router.get('/doctors', requireAuth, async (req, res) => {
  const [doctors] = await db.query('SELECT id, full_name, specialty, qualification, reg_no, fee, bio FROM doctors WHERE is_active = 1 ORDER BY full_name ASC');
  res.json({ success: true, doctors: doctors.map((d) => ({ ...d, fee: Number(d.fee) })) });
});

router.get('/admin/doctors', adminOnly, async (req, res) => {
  const [doctors] = await db.query('SELECT * FROM doctors ORDER BY created_at DESC');
  res.json({ success: true, doctors: doctors.map((d) => ({ ...d, fee: Number(d.fee), is_active: !!d.is_active })) });
});

router.post('/admin/doctors', adminOnly, async (req, res) => {
  const d = readDoctor(req.body);
  const [result] = await db.query('INSERT INTO doctors (full_name, specialty, qualification, reg_no, fee, bio, phone) VALUES (?, ?, ?, ?, ?, ?, ?)', [d.name, d.specialty, d.qualification, d.regNo, d.fee, d.bio, d.phone]);
  res.status(201).json({ success: true, id: result.insertId, message: 'Doctor added.' });
});

router.put('/admin/doctors/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid doctor.');
  const d = readDoctor(req.body);
  const active = req.body.is_active === false ? 0 : 1;
  const [result] = await db.query(
    'UPDATE doctors SET full_name = ?, specialty = ?, qualification = ?, reg_no = ?, fee = ?, bio = ?, phone = ?, is_active = ? WHERE id = ?',
    [d.name, d.specialty, d.qualification, d.regNo, d.fee, d.bio, d.phone, active, id]
  );
  if (!result.affectedRows) fail(404, 'Doctor not found.');
  res.json({ success: true, message: 'Doctor updated.' });
});

router.delete('/admin/doctors/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid doctor.');
  const [result] = await db.query('DELETE FROM doctors WHERE id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Doctor not found.');
  res.json({ success: true, message: 'Doctor removed.' });
});

// ---- checkup requests ----

router.post('/checkups', requireAuth, async (req, res) => {
  notAdmin(req);
  const doctorId = toId(req.body.doctor_id);
  const reason = str(req.body.reason, 500);
  const when = str(req.body.preferred_time, 100) || null;
  if (!doctorId) fail(400, 'Choose a doctor.');
  if (reason.length < 5) fail(400, 'Tell the doctor briefly what the problem is.');

  const [doctors] = await db.query('SELECT full_name FROM doctors WHERE id = ? AND is_active = 1', [doctorId]);
  if (!doctors.length) fail(404, 'This doctor is not available.');

  const [[pending]] = await db.query(`SELECT COUNT(*) AS c FROM checkups WHERE user_id = ? AND status = 'pending'`, [req.user.id]);
  if (pending.c >= MAX_PENDING_CHECKUPS) fail(429, 'You already have checkup requests waiting. Please wait for an answer.');

  const [result] = await db.query('INSERT INTO checkups (user_id, doctor_id, reason, preferred_time) VALUES (?, ?, ?, ?)', [req.user.id, doctorId, reason, when]);
  await notifyRole('admin', 'checkup_request', `Checkup request for ${doctors[0].full_name}`, `${req.user.full_name}: ${reason.slice(0, 120)}`, '/admin?tab=emergency');

  res.status(201).json({ success: true, id: result.insertId, message: 'Request sent. An admin will approve it and send you the meeting link.' });
});

const checkupSelect = `SELECT c.id, c.user_id, c.doctor_id, c.reason, c.preferred_time, c.status, c.meeting_link, c.meeting_time, c.admin_note, c.created_at, c.decided_at,
       d.full_name AS doctor_name, d.specialty, u.full_name AS user_name, u.phone AS user_phone
  FROM checkups c JOIN doctors d ON d.id = c.doctor_id JOIN users u ON u.id = c.user_id`;

router.get('/checkups/mine', requireAuth, async (req, res) => {
  const [rows] = await db.query(`${checkupSelect} WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 30`, [req.user.id]);
  // The meeting link is only for the person it was approved for.
  res.json({ success: true, checkups: rows.map(({ user_phone, user_name, ...c }) => ({ ...c, meeting_link: c.status === 'approved' ? c.meeting_link : null })) });
});

router.patch('/checkups/:id/cancel', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const [result] = await db.query(`UPDATE checkups SET status = 'cancelled', decided_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('pending', 'approved')`, [id, req.user.id]);
  if (!result.affectedRows) fail(404, 'Checkup request not found.');
  res.json({ success: true, message: 'Checkup request cancelled.' });
});

router.get('/admin/checkups', adminOnly, async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled', 'completed'].includes(req.query.status) ? req.query.status : 'pending';
  const [rows] = await db.query(`${checkupSelect} WHERE c.status = ? ORDER BY c.id DESC LIMIT 100`, [status]);
  res.json({ success: true, checkups: rows });
});

// The meeting link must be a real web address.
function readLink(value) {
  const link = str(value, 500);
  let url;
  try {
    url = new URL(link);
  } catch {
    fail(400, 'Paste the full meeting link, for example https://meet.google.com/abc-defg-hij.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail(400, 'The meeting link must start with http:// or https://.');
  return url.toString();
}

router.patch('/admin/checkups/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const action = req.body.status;
  if (!['approved', 'rejected', 'completed'].includes(action)) fail(400, 'Choose approved, rejected or completed.');

  const [rows] = await db.query(`${checkupSelect} WHERE c.id = ?`, [id]);
  const c = rows[0];
  if (!c) fail(404, 'Checkup request not found.');

  if (action === 'approved') {
    // An admin can also fix the link or time of a checkup that is already approved.
    if (!['pending', 'approved'].includes(c.status)) fail(409, 'This request was already answered.');
    const link = readLink(req.body.meeting_link);
    const time = str(req.body.meeting_time, 100) || c.preferred_time || null;
    await db.query(`UPDATE checkups SET status = 'approved', meeting_link = ?, meeting_time = ?, admin_note = ?, decided_at = NOW() WHERE id = ?`, [link, time, str(req.body.admin_note, 300) || null, id]);
    await notify(c.user_id, 'checkup_status', `Checkup ${c.status === 'approved' ? 'updated' : 'approved'}: ${c.doctor_name}`, `${time ? `Time: ${time}. ` : ''}Open your checkups to join the meeting.`, '/emergency/doctors');
    return res.json({ success: true, message: 'Approved. The meeting link was sent to the patient.' });
  }

  if (action === 'rejected') {
    if (c.status !== 'pending') fail(409, 'This request was already answered.');
    const note = str(req.body.admin_note, 300);
    if (!note) fail(400, 'Tell the patient why, so they can ask again or call a helpline.');
    await db.query(`UPDATE checkups SET status = 'rejected', admin_note = ?, decided_at = NOW() WHERE id = ?`, [note, id]);
    await notify(c.user_id, 'checkup_status', `Checkup not approved: ${c.doctor_name}`, note, '/emergency/doctors');
    return res.json({ success: true, message: 'The patient was told.' });
  }

  if (c.status !== 'approved') fail(409, 'Only an approved checkup can be completed.');
  await db.query(`UPDATE checkups SET status = 'completed', decided_at = NOW() WHERE id = ?`, [id]);
  res.json({ success: true, message: 'Checkup marked as completed.' });
});

router.delete('/admin/checkups/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const [result] = await db.query('DELETE FROM checkups WHERE id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Checkup request not found.');
  res.json({ success: true, message: 'Checkup request deleted.' });
});

// ======================================================================
// Blood bank moderation: anyone can add themselves or ask for blood; admins see and clean it up.
// ======================================================================

router.get('/admin/blood', adminOnly, async (req, res) => {
  const [donors] = await db.query(
    `SELECT u.id AS user_id, u.full_name, u.phone, d.blood_group, d.area, d.is_available, d.last_donated
     FROM blood_donors d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 200`
  );
  const [requests] = await db.query(
    `SELECT r.id, r.blood_group, r.units, r.hospital, r.area, r.contact_phone, r.note, r.urgent, r.status, r.created_at, r.expires_at,
            (r.expires_at <= NOW()) AS expired, u.full_name AS requester_name,
            (SELECT COUNT(*) FROM blood_offers o WHERE o.request_id = r.id) AS offers
     FROM blood_requests r JOIN users u ON u.id = r.requester_id ORDER BY r.created_at DESC LIMIT 100`
  );
  const [managed] = await db.query('SELECT id, full_name, phone, blood_group, area, is_available, share_phone, last_donated FROM blood_donors_managed ORDER BY created_at DESC LIMIT 200');
  res.json({
    success: true,
    managed: managed.map((d) => ({ ...d, is_available: !!d.is_available, share_phone: !!d.share_phone })),
    donors: donors.map((d) => ({ ...d, is_available: !!d.is_available })),
    requests: requests.map((r) => ({ ...r, urgent: !!r.urgent, expired: !!r.expired, offers: Number(r.offers) })),
  });
});

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function readGroup(value) {
  const group = str(value, 4).toUpperCase();
  if (!BLOOD_GROUPS.includes(group)) fail(400, 'Choose a blood group.');
  return group;
}

function readArea(value) {
  const area = str(value, 100);
  if (area.length < 2) fail(400, 'Enter the area, for example Mirpur, Dhaka.');
  return area;
}

function readDay(value) {
  const day = str(value, 10) || null;
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || Date.parse(day) > Date.now())) fail(400, 'The last donation date cannot be in the future.');
  return day;
}

function readManagedDonor(body) {
  const name = str(body.full_name, 100);
  if (name.length < 2) fail(400, 'Enter the donor name.');
  return {
    name,
    group: readGroup(body.blood_group),
    area: readArea(body.area),
    day: readDay(body.last_donated),
    phone: readPhone(body.phone),
    available: body.is_available === false ? 0 : 1,
    share: body.share_phone === false ? 0 : 1,
  };
}

// An admin adds a donor who has no account (someone who phoned or walked in).
router.post('/admin/blood/managed', adminOnly, async (req, res) => {
  const d = readManagedDonor(req.body);
  const [result] = await db.query(
    'INSERT INTO blood_donors_managed (full_name, phone, blood_group, area, is_available, share_phone, last_donated, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [d.name, d.phone, d.group, d.area, d.available, d.share, d.day, req.user.id]
  );
  res.status(201).json({ success: true, id: result.insertId, message: 'Donor added to the blood bank.' });
});

router.put('/admin/blood/managed/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid donor.');
  const d = readManagedDonor(req.body);
  const [result] = await db.query(
    'UPDATE blood_donors_managed SET full_name = ?, phone = ?, blood_group = ?, area = ?, is_available = ?, share_phone = ?, last_donated = ? WHERE id = ?',
    [d.name, d.phone, d.group, d.area, d.available, d.share, d.day, id]
  );
  if (!result.affectedRows) fail(404, 'Donor not found.');
  res.json({ success: true, message: 'Donor updated.' });
});

// An admin can correct a registered donor's details too (the person keeps their own phone and privacy choice).
router.put('/admin/blood/donors/:userId', adminOnly, async (req, res) => {
  const id = toId(req.params.userId);
  if (!id) fail(400, 'Invalid donor.');
  const [result] = await db.query('UPDATE blood_donors SET blood_group = ?, area = ?, is_available = ?, last_donated = ? WHERE user_id = ?', [
    readGroup(req.body.blood_group),
    readArea(req.body.area),
    req.body.is_available === false ? 0 : 1,
    readDay(req.body.last_donated),
    id,
  ]);
  if (!result.affectedRows) fail(404, 'Donor not found.');
  res.json({ success: true, message: 'Donor updated.' });
});

// An admin can edit any blood request, reopen it, close it, or delete it.
router.put('/admin/blood/requests/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const units = Math.round(Number(req.body.units) || 1);
  if (units < 1 || units > 10) fail(400, 'Units must be between 1 and 10.');
  const hospital = str(req.body.hospital, 150);
  if (hospital.length < 3) fail(400, 'Write the hospital or place where blood is needed.');
  const status = ['open', 'fulfilled', 'closed'].includes(req.body.status) ? req.body.status : null;
  if (!status) fail(400, 'Choose open, fulfilled or closed.');

  // Reopening gives it a fresh three days.
  const [result] = await db.query(
    `UPDATE blood_requests
     SET expires_at = IF(? = 'open' AND (status <> 'open' OR expires_at <= NOW()), DATE_ADD(NOW(), INTERVAL 3 DAY), expires_at),
         blood_group = ?, units = ?, hospital = ?, area = ?, contact_phone = ?, note = ?, urgent = ?, status = ?
     WHERE id = ?`,
    [status, readGroup(req.body.blood_group), units, hospital, readArea(req.body.area), readPhone(req.body.contact_phone), str(req.body.note, 300) || null, req.body.urgent ? 1 : 0, status, id]
  );
  if (!result.affectedRows) fail(404, 'Request not found.');
  res.json({ success: true, message: 'Request updated.' });
});

router.delete('/admin/blood/requests/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const [result] = await db.query('DELETE FROM blood_requests WHERE id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Request not found.');
  res.json({ success: true, message: 'Request deleted.' });
});

router.delete('/admin/blood/managed/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid donor.');
  const [result] = await db.query('DELETE FROM blood_donors_managed WHERE id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Donor not found.');
  res.json({ success: true, message: 'Donor removed.' });
});

router.delete('/admin/blood/donors/:userId', adminOnly, async (req, res) => {
  const id = toId(req.params.userId);
  if (!id) fail(400, 'Invalid donor.');
  const [result] = await db.query('DELETE FROM blood_donors WHERE user_id = ?', [id]);
  if (!result.affectedRows) fail(404, 'Donor not found.');
  res.json({ success: true, message: 'Donor removed from the list.' });
});

router.patch('/admin/blood/requests/:id', adminOnly, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid request.');
  const [result] = await db.query(`UPDATE blood_requests SET status = 'closed' WHERE id = ? AND status = 'open'`, [id]);
  if (!result.affectedRows) fail(404, 'Open request not found.');
  res.json({ success: true, message: 'Request closed.' });
});

module.exports = router;
