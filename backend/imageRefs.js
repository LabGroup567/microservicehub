const db = require('./db');
const { fail, toId } = require('./helpers');

/**
 * Reads an `image_id` from a request body and checks the image belongs to this user.
 * Returns undefined when the field is absent (leave as is), null to clear, or the id.
 */
async function ownedImageId(value, userId) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const id = toId(value);
  if (!id) fail(400, 'Invalid image.');

  const [rows] = await db.query('SELECT id FROM images WHERE id = ? AND owner_id = ?', [id, userId]);
  if (!rows.length) fail(400, 'That image was not found. Upload it again.');
  return id;
}

/** Deletes an image nothing refers to any more. */
async function dropIfUnused(imageId) {
  if (!imageId) return;
  const [[used]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM services WHERE image_id = ?) +
            (SELECT COUNT(*) FROM provider_services WHERE image_id = ?) +
            (SELECT COUNT(*) FROM provider_portfolio WHERE image_id = ?) +
            (SELECT COUNT(*) FROM users WHERE avatar_image_id = ?) AS c`,
    [imageId, imageId, imageId, imageId]
  );
  if (!used.c) await db.query('DELETE FROM images WHERE id = ?', [imageId]);
}

module.exports = { ownedImageId, dropIfUnused };
