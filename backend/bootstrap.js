const bcrypt = require('bcryptjs');
const db = require('./db');

/**
 * On a fresh deployment there is no way to run `npm run create-admin`. If no admin exists and
 * INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD are set, the main admin is created from them.
 * Remove both variables afterwards; they are ignored once an admin exists.
 */
async function ensureInitialAdmin() {
  const email = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  if (!email || !password) return false;

  const [[existing]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
  if (existing.c) return false;

  if (password.length < 10) {
    console.warn('INITIAL_ADMIN_PASSWORD is too short (use at least 10 characters). No admin was created.');
    return false;
  }

  const hash = await bcrypt.hash(password, 12);
  const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);

  if (rows.length) {
    await db.query(
      `UPDATE users SET role = 'admin', admin_level = 'full', is_main_admin = 1, password_hash = ?,
         has_password = 1, is_banned = 0, email_verified = 1 WHERE id = ?`,
      [hash, rows[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, admin_level, is_main_admin, nid_status, email_verified)
       VALUES (?, ?, ?, 'admin', 'full', 1, 'verified', 1)`,
      [process.env.INITIAL_ADMIN_NAME || 'Main Admin', email, hash]
    );
  }

  console.log(`Main admin created for ${email}. Remove INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD from the environment now.`);
  return true;
}

module.exports = { ensureInitialAdmin };
