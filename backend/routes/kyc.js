const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { HttpError, fail, toId, str, notify } = require('../helpers');

const router = express.Router();

// KYC documents live outside any public folder and are served only to
// their owner or an admin.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'kyc'); // only read for old submissions

const DOC_TYPES = ['nid_front', 'nid_back', 'selfie', 'birth_certificate'];

// People 18 and over verify with a National ID. People under 18 (down to the minimum age) use a birth certificate.
const ADULT_AGE = 18;
const MIN_AGE = 13;
const REQUIRED = {
  nid: ['nid_front', 'nid_back', 'selfie'],
  birth_certificate: ['birth_certificate', 'selfie'],
};

/** Age in whole years today. */
function ageFromDob(dob) {
  const born = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}
const MAX_BYTES = 3 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 3 },
}).fields(DOC_TYPES.map((name) => ({ name, maxCount: 1 })));

// Do not trust the client's file type: check the real image signature.
function imageExtension(buffer) {
  if (buffer.length > 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (error) => {
      if (!error) return resolve();

      reject(
        new HttpError(
          400,
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Each photo must be 3 MB or smaller.'
            : 'Could not read the uploaded photos.'
        )
      );
    });
  });
}

// ---------- My KYC ----------

router.get('/kyc/me', requireAuth, async (req, res) => {
  const [[row]] = await db.query(
    `SELECT kyc_status, kyc_reason, kyc_full_name, kyc_dob, nid_number, nid_status, kyc_submitted_at,
            kyc_method, birth_cert_number
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  const [docs] = await db.query('SELECT doc_type FROM kyc_documents WHERE user_id = ?', [req.user.id]);

  res.json({
    success: true,
    kyc: {
      status: row.kyc_status,
      reason: row.kyc_reason || '',
      full_name: row.kyc_full_name || '',
      dob: row.kyc_dob ? new Date(row.kyc_dob).toISOString().slice(0, 10) : '',
      method: row.kyc_method,
      nid_number: row.nid_number || '',
      birth_cert_number: row.birth_cert_number || '',
      nid_status: row.nid_status,
      submitted_at: row.kyc_submitted_at,
      documents: docs.map((doc) => doc.doc_type),
    },
  });
});

router.post('/kyc', requireAuth, requireRole('seeker', 'provider'), async (req, res) => {
  await runUpload(req, res);

  const [[current]] = await db.query('SELECT kyc_status FROM users WHERE id = ?', [req.user.id]);
  if (['pending', 'verified'].includes(current.kyc_status)) {
    fail(409, current.kyc_status === 'verified' ? 'You are already verified.' : 'Your verification is under review.');
  }

  const method = req.body.method === 'birth_certificate' ? 'birth_certificate' : 'nid';
  const fullName = str(req.body.full_name, 100);
  const idNumber = str(req.body.id_number || req.body.nid_number, 30);
  const dob = str(req.body.dob, 10);
  const label = method === 'nid' ? 'NID' : 'birth certificate';

  if (!fullName) fail(400, `Enter your full name as written on your ${label}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || Date.parse(dob) > Date.now()) fail(400, 'Enter your date of birth.');
  if (!/^[0-9]{10,17}$/.test(idNumber)) fail(400, `The ${label} number must be 10 to 17 digits.`);

  const age = ageFromDob(dob);
  if (age > 100) fail(400, 'Enter your real date of birth.');
  if (age < MIN_AGE) fail(400, `You must be at least ${MIN_AGE} years old to use MicroServiceHub.`);
  if (method === 'nid' && age < ADULT_AGE) fail(400, 'If you are under 18, verify with your birth certificate instead of an NID.');
  if (method === 'birth_certificate' && age >= ADULT_AGE) fail(400, 'A birth certificate is only for people under 18. Please verify with your NID.');

  const required = REQUIRED[method];

  const [existingDocs] = await db.query('SELECT doc_type FROM kyc_documents WHERE user_id = ?', [req.user.id]);
  const have = new Set(existingDocs.map((doc) => doc.doc_type));

  // Validate every uploaded photo before writing anything.
  const files = {};
  for (const type of required) {
    const file = req.files?.[type]?.[0];
    if (!file) {
      if (!have.has(type)) fail(400, method === 'nid' ? 'Upload NID front, NID back and a selfie.' : 'Upload your birth certificate and a selfie.');
      continue;
    }

    const ext = imageExtension(file.buffer);
    if (!ext) fail(400, 'Photos must be JPG, PNG or WebP images.');
    files[type] = { buffer: file.buffer, ext };
  }

  // Photos are stored in the database, so they survive on hosts with temporary disks and are
  // included in every database backup.
  for (const [type, file] of Object.entries(files)) {
    const [old] = await db.query(
      'SELECT file_name FROM kyc_documents WHERE user_id = ? AND doc_type = ?',
      [req.user.id, type]
    );

    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_name, mime, data) VALUES (?, ?, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE file_name = NULL, mime = VALUES(mime), data = VALUES(data), created_at = NOW()`,
      [req.user.id, type, CONTENT_TYPES[file.ext], file.buffer]
    );

    // A photo saved by an earlier version lived on disk: remove it now that it is replaced.
    if (old.length && old[0].file_name) fs.rmSync(path.join(UPLOAD_DIR, path.basename(old[0].file_name)), { force: true });
  }

  // Anything from the other route (for example NID photos after switching to a birth certificate) is removed.
  await db.query('DELETE FROM kyc_documents WHERE user_id = ? AND doc_type NOT IN (?)', [req.user.id, required]);

  await db.query(
    `UPDATE users
     SET kyc_status = 'pending', kyc_reason = NULL, kyc_full_name = ?, kyc_dob = ?, kyc_method = ?,
         nid_number = ?, birth_cert_number = ?, nid_status = 'pending', kyc_submitted_at = NOW()
     WHERE id = ?`,
    [fullName, dob, method, method === 'nid' ? idNumber : null, method === 'birth_certificate' ? idNumber : null, req.user.id]
  );

  res.status(201).json({
    success: true,
    message: 'Verification submitted. We will review it shortly.',
  });
});

// ---------- Serving a document (owner or admin) ----------

router.get('/kyc/file/:userId/:type', requireAuth, async (req, res) => {
  const userId = toId(req.params.userId);
  const type = req.params.type;

  if (!userId || !DOC_TYPES.includes(type)) fail(400, 'Invalid request.');
  if (userId !== req.user.id && req.user.role !== 'admin') fail(404, 'Not found.');

  const [rows] = await db.query(
    'SELECT file_name, mime, data FROM kyc_documents WHERE user_id = ? AND doc_type = ?',
    [userId, type]
  );
  if (!rows.length) fail(404, 'Not found.');

  res.setHeader('Cache-Control', 'private, no-store');

  if (rows[0].data) {
    res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
    return res.send(rows[0].data);
  }

  // Older submissions may still be files on disk.
  const fileName = rows[0].file_name ? path.basename(rows[0].file_name) : null;
  const filePath = fileName && path.join(UPLOAD_DIR, fileName);
  if (!filePath || !fs.existsSync(filePath)) fail(404, 'Not found.');

  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(fileName).slice(1)] || 'application/octet-stream');
  res.sendFile(filePath);
});

// ---------- Admin review ----------

router.get('/admin/kyc', requireAuth, requireRole('admin'), async (req, res) => {
  const status = ['pending', 'verified', 'rejected'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  const [users] = await db.query(
    `SELECT id, full_name, email, role, phone, nid_number, kyc_method, birth_cert_number, kyc_status, kyc_reason,
            kyc_full_name, kyc_dob, kyc_submitted_at
     FROM users WHERE kyc_status = ?
     ORDER BY kyc_submitted_at DESC LIMIT 200`,
    [status]
  );

  res.json({ success: true, users });
});

router.patch('/admin/kyc/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  const userId = toId(req.params.userId);
  const decision = req.body.status;
  const reason = str(req.body.reason, 255);

  if (!userId || !['verified', 'rejected'].includes(decision)) fail(400, 'Invalid request.');
  if (decision === 'rejected' && !reason) fail(400, 'Give the user a reason so they can fix it.');

  const [rows] = await db.query('SELECT id, kyc_status FROM users WHERE id = ?', [userId]);
  if (!rows.length) fail(404, 'User not found.');
  if (rows[0].kyc_status !== 'pending') fail(409, 'This submission is not waiting for review.');

  await db.query(
    'UPDATE users SET kyc_status = ?, kyc_reason = ?, nid_status = ? WHERE id = ?',
    [decision, decision === 'rejected' ? reason : null, decision, userId]
  );

  await notify(
    userId,
    'kyc_status',
    decision === 'verified' ? 'Identity verified' : 'Verification rejected',
    decision === 'verified' ? 'Your KYC was approved. A verified badge now shows on your profile.' : reason,
    '/kyc'
  );

  res.json({ success: true, message: decision === 'verified' ? 'User verified.' : 'Submission rejected.' });
});

module.exports = router;
