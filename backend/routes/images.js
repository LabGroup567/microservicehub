const express = require('express');
const multer = require('multer');

const db = require('../db');
const { requireAuth } = require('../auth');
const { HttpError, fail, toId } = require('../helpers');

const router = express.Router();

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_USER = 100;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('image');

// Do not trust the client's file type: check the real image signature.
function imageMime(buffer) {
  if (buffer.length > 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (error) => {
      if (!error) return resolve();
      reject(new HttpError(400, error.code === 'LIMIT_FILE_SIZE' ? 'The photo must be 2 MB or smaller.' : 'Could not read the photo.'));
    });
  });
}

// A photo for a work request or a service listing.
router.post('/images', requireAuth, async (req, res) => {
  await runUpload(req, res);
  if (!req.file) fail(400, 'Choose a photo to upload.');

  const mime = imageMime(req.file.buffer);
  if (!mime) fail(400, 'Only JPG, PNG or WebP photos are allowed.');

  const [[owned]] = await db.query('SELECT COUNT(*) AS c FROM images WHERE owner_id = ?', [req.user.id]);
  if (owned.c >= MAX_PER_USER) fail(429, 'You have uploaded too many photos. Remove some listings first.');

  const [result] = await db.query('INSERT INTO images (owner_id, mime, data) VALUES (?, ?, ?)', [req.user.id, mime, req.file.buffer]);
  res.status(201).json({ success: true, image_id: result.insertId });
});

// Listing photos are public (an <img> tag cannot send a login token). The id is the only handle.
router.get('/images/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(404, 'Not found.');

  const [rows] = await db.query('SELECT mime, data FROM images WHERE id = ?', [id]);
  if (!rows.length) fail(404, 'Not found.');

  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(rows[0].data);
});

module.exports = router;
