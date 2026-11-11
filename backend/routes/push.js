const express = require('express');

const db = require('../db');
const { requireAuth } = require('../auth');
const { fail, str } = require('../helpers');
const { pushEnabled } = require('../push');

const router = express.Router();

// The public VAPID key lets the browser create a push subscription.
router.get('/push/key', (req, res) => {
  res.json({
    success: true,
    enabled: pushEnabled(),
    public_key: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : '',
  });
});

router.post('/push/subscribe', requireAuth, async (req, res) => {
  const sub = req.body.subscription || {};
  const endpoint = str(sub.endpoint, 500);
  const p256dh = str(sub.keys?.p256dh, 255);
  const auth = str(sub.keys?.auth, 255);

  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) fail(400, 'Invalid subscription.');

  // A device belongs to whoever subscribed last (shared phones, re-logins).
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [req.user.id, endpoint, p256dh, auth]
  );

  res.status(201).json({ success: true, message: 'Phone notifications are on.' });
});

router.post('/push/unsubscribe', requireAuth, async (req, res) => {
  const endpoint = str(req.body.endpoint, 500);
  if (!endpoint) fail(400, 'Missing endpoint.');

  await db.query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [
    endpoint,
    req.user.id,
  ]);

  res.json({ success: true, message: 'Phone notifications are off.' });
});

module.exports = router;
