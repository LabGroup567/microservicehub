const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

// Make sure a signing secret exists; generate one on first run.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const secret = crypto.randomBytes(48).toString('hex');
  const envPath = path.join(__dirname, '.env');

  try {
    fs.appendFileSync(envPath, `\nJWT_SECRET=${secret}\n`);
  } catch (error) {
    console.warn('Could not persist JWT_SECRET:', error.message);
  }

  process.env.JWT_SECRET = secret;
  return secret;
}

const SECRET = loadSecret();

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, {
    expiresIn: '7d',
  });
}

// Returns the user for a valid token, or null (also null when banned).
async function authenticateToken(token) {
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return null;
  }

  const [rows] = await db.query(
    `SELECT id, full_name, email, role, phone, bio, nid_status, kyc_status, email_verified, admin_level, is_main_admin, is_banned, avatar_image_id
     FROM users WHERE id = ? LIMIT 1`,
    [payload.sub]
  );

  return rows.length && !rows[0].is_banned ? rows[0] : null;
}

// Loads the current user from the DB on every request so bans and
// role changes take effect immediately.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ success: false, message: 'Please log in.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please log in again.',
    });
  }

  const [rows] = await db.query(
    `SELECT id, full_name, email, role, phone, bio, nid_status, kyc_status, email_verified, admin_level, is_main_admin, is_banned, avatar_image_id
     FROM users WHERE id = ? LIMIT 1`,
    [payload.sub]
  );

  if (!rows.length) {
    return res.status(401).json({ success: false, message: 'Account not found.' });
  }

  if (rows[0].is_banned) {
    return res.status(403).json({
      success: false,
      message: 'This account has been suspended.',
    });
  }

  req.user = rows[0];
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to do this.',
      });
    }
    next();
  };
}

// Everyone except admins must have a verified NID before creating work, listings,
// bookings or applications. Set REQUIRE_KYC=false in .env to switch this off.
function requireVerified(req, res, next) {
  const enforced = process.env.REQUIRE_KYC !== 'false';

  if (enforced && req.user.role !== 'admin' && req.user.kyc_status !== 'verified') {
    return res.status(403).json({
      success: false,
      code: 'kyc_required',
      message: 'Verify your identity (NID) first. Open your profile and choose Identity verification.',
    });
  }
  next();
}

// Sub admins moderate; only the main admin manages admins, categories and roles.
function requireMainAdmin(req, res, next) {
  if (req.user.role !== 'admin' || !req.user.is_main_admin) {
    return res.status(403).json({
      success: false,
      message: 'Only the main admin can do this.',
    });
  }
  next();
}

module.exports = { signToken, requireAuth, requireRole, requireVerified, requireMainAdmin, authenticateToken };
