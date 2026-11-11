const db = require('./db');
const { pushToUsers } = require('./push');
const { deliver } = require('./channels');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function str(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Loaded lazily: realtime.js depends on this file.
const realtime = () => require('./realtime');

async function notify(userId, type, title, body = '', link = '') {
  if (!userId) return;
  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, type, title, body, link]
  );
  realtime().emitToUser(userId, 'notification:new', { type, title, body, link });
  pushToUsers([userId], { title, body, link });
  await deliver(userId, { type, title, body, link });
}

/** Notifies every active user with a role (e.g. all providers). */
async function notifyRole(role, type, title, body = '', link = '', excludeId = 0) {
  const [users] = await db.query(
    'SELECT id FROM users WHERE role = ? AND is_banned = 0 AND id <> ?',
    [role, excludeId]
  );
  if (!users.length) return 0;

  await db.query(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES ?',
    [users.map((user) => [user.id, type, title, body, link])]
  );
  for (const user of users) {
    realtime().emitToUser(user.id, 'notification:new', { type, title, body, link });
  }
  pushToUsers(
    users.map((user) => user.id),
    { title, body, link }
  );
  return users.length;
}

// Two users may chat or share location when they share a work, application or booking.
async function canChat(a, b) {
  if (a.id === b.id) return false;
  if (a.role === 'admin' || b.role === 'admin') return true;

  const [rows] = await db.query(
    `SELECT 1 FROM applications ap
       JOIN services s ON s.id = ap.service_id
       WHERE (ap.provider_id = ? AND s.seeker_id = ?)
          OR (ap.provider_id = ? AND s.seeker_id = ?)
     UNION
     SELECT 1 FROM bookings bk
       JOIN provider_services ps ON ps.id = bk.provider_service_id
       WHERE (bk.customer_id = ? AND ps.provider_id = ?)
          OR (bk.customer_id = ? AND ps.provider_id = ?)
     LIMIT 1`,
    [a.id, b.id, b.id, a.id, a.id, b.id, b.id, a.id]
  );
  return rows.length > 0;
}

function publicUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    phone: user.phone || '',
    bio: user.bio || '',
    nid_status: user.nid_status,
    kyc_status: user.kyc_status || 'none',
    email_verified: !!user.email_verified,
    admin_level: user.admin_level || 'none',
    is_main_admin: !!user.is_main_admin,
    avatar_image_id: user.avatar_image_id || null,
  };
}

module.exports = { HttpError, fail, toId, str, notify, notifyRole, canChat, publicUser };
