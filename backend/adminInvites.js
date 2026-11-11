const db = require('./db');
const { notify } = require('./helpers');

/**
 * Turns a pending admin invite into sub admin access. Call it only once the person has
 * proven they own the email (verified link, Google sign-in or password reset); otherwise
 * anyone could register with an invited address and become an admin.
 */
async function applyAdminInvite(userId) {
  const [rows] = await db.query('SELECT id, email, role, is_banned FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user || user.is_banned) return false;

  const [invites] = await db.query('SELECT id FROM admin_invites WHERE email = ?', [user.email.toLowerCase()]);
  if (!invites.length) return false;

  if (user.role !== 'admin') {
    await db.query("UPDATE users SET role = 'admin', admin_level = 'sub' WHERE id = ?", [userId]);
    await notify(
      userId,
      'admin_access',
      'You are now a sub admin',
      'Open the Admin panel from the menu. Log in again if you do not see it.',
      '/admin'
    );
  }

  await db.query('DELETE FROM admin_invites WHERE id = ?', [invites[0].id]);
  return true;
}

module.exports = { applyAdminInvite };
