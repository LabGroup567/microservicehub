const express = require('express');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, str } = require('../helpers');
const { ownedImageId, dropIfUnused } = require('../imageRefs');

const router = express.Router();

const MAX_ITEMS = 12;

// Anyone signed in can see a provider's past work.
router.get('/providers/:id/portfolio', requireAuth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid provider.');

  const [items] = await db.query(
    `SELECT id, image_id, caption, created_at FROM provider_portfolio
     WHERE provider_id = ? ORDER BY created_at DESC, id DESC`,
    [id]
  );
  res.json({ success: true, items });
});

// A provider adds a photo of finished work. The photo is uploaded first (POST /images), then added here.
router.post('/portfolio', requireAuth, requireRole('provider'), async (req, res) => {
  const imageId = await ownedImageId(req.body.image_id, req.user.id);
  if (!imageId) fail(400, 'Choose a photo first.');
  const caption = str(req.body.caption, 120) || null;

  const [[count]] = await db.query('SELECT COUNT(*) AS c FROM provider_portfolio WHERE provider_id = ?', [req.user.id]);
  if (count.c >= MAX_ITEMS) fail(400, `Your portfolio can hold ${MAX_ITEMS} photos. Remove one to add another.`);

  const [dup] = await db.query('SELECT id FROM provider_portfolio WHERE provider_id = ? AND image_id = ?', [req.user.id, imageId]);
  if (dup.length) fail(409, 'That photo is already in your portfolio.');

  const [result] = await db.query('INSERT INTO provider_portfolio (provider_id, image_id, caption) VALUES (?, ?, ?)', [
    req.user.id,
    imageId,
    caption,
  ]);
  res.status(201).json({ success: true, id: result.insertId });
});

router.patch('/portfolio/:id', requireAuth, requireRole('provider'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid item.');

  const [result] = await db.query('UPDATE provider_portfolio SET caption = ? WHERE id = ? AND provider_id = ?', [
    str(req.body.caption, 120) || null,
    id,
    req.user.id,
  ]);
  if (!result.affectedRows) fail(404, 'Photo not found.');
  res.json({ success: true });
});

router.delete('/portfolio/:id', requireAuth, requireRole('provider'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid item.');

  const [rows] = await db.query('SELECT image_id FROM provider_portfolio WHERE id = ? AND provider_id = ?', [id, req.user.id]);
  if (!rows.length) fail(404, 'Photo not found.');

  await db.query('DELETE FROM provider_portfolio WHERE id = ?', [id]);
  await dropIfUnused(rows[0].image_id);
  res.json({ success: true });
});

module.exports = router;
