const crypto = require('crypto');
const db = require('./db');

const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Creates a single-use token (for password reset or email verification).
 * Only a hash is stored, so a database leak does not expose working links.
 * Older unused tokens of the same type are cancelled.
 */
async function createToken(userId, type, ttlMinutes) {
  const raw = crypto.randomBytes(32).toString('hex');

  await db.query('DELETE FROM auth_tokens WHERE user_id = ? AND type = ? AND used_at IS NULL', [userId, type]);
  await db.query(
    `INSERT INTO auth_tokens (user_id, type, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, type, hash(raw), ttlMinutes]
  );

  return raw;
}

/** Returns the user id if the token is valid, and burns it so it cannot be used twice. */
async function consumeToken(raw, type) {
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 128) return null;

  const tokenHash = hash(raw);
  const [rows] = await db.query(
    `SELECT id, user_id FROM auth_tokens
     WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash, type]
  );
  if (!rows.length) return null;

  // The UPDATE only succeeds for the first caller, which makes the token single-use.
  const [result] = await db.query('UPDATE auth_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [rows[0].id]);
  return result.affectedRows ? rows[0].user_id : null;
}

async function recentlyIssued(userId, type, seconds) {
  const [rows] = await db.query(
    `SELECT 1 FROM auth_tokens
     WHERE user_id = ? AND type = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND) LIMIT 1`,
    [userId, type, seconds]
  );
  return rows.length > 0;
}

module.exports = { createToken, consumeToken, recentlyIssued };
