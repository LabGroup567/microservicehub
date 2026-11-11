// Usage: node scripts/create-admin.js <email> <password> ["Full Name"]
// Creates an admin account, or promotes an existing user to admin.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const db = require('../db');
const { ensureSchema } = require('../migrate');

async function main() {
  const [email, password, name] = process.argv.slice(2);

  if (!email || !password) {
    console.log('Usage: node scripts/create-admin.js <email> <password> ["Full Name"]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.');
    process.exit(1);
  }

  await ensureSchema();

  const normalized = email.trim().toLowerCase();
  const hash = await bcrypt.hash(password, 12);
  const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [normalized]);

  // The first admin ever created is the main admin. After that, this script only adds sub admins.
  const [[main]] = await db.query('SELECT COUNT(*) AS c FROM users WHERE is_main_admin = 1');
  const becomesMain = main.c === 0;
  const level = becomesMain ? 'full' : 'sub';

  if (rows.length) {
    await db.query(
      `UPDATE users SET role = 'admin', admin_level = ?, is_main_admin = IF(is_main_admin = 1, 1, ?),
         password_hash = ?, has_password = 1, is_banned = 0, email_verified = 1
       WHERE id = ?`,
      [level, becomesMain ? 1 : 0, hash, rows[0].id]
    );
    console.log(`Existing user ${normalized} promoted to admin and password updated.`);
  } else {
    await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, admin_level, is_main_admin, nid_status, email_verified)
       VALUES (?, ?, ?, 'admin', ?, ?, 'verified', 1)`,
      [name || 'Administrator', normalized, hash, level, becomesMain ? 1 : 0]
    );
    console.log(`Admin ${normalized} created.`);
  }

  console.log(becomesMain ? `${normalized} is the MAIN admin.` : `${normalized} is a sub admin (a main admin already exists).`);

  await db.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
