const webpush = require('web-push');
const db = require('./db');

let enabled = false;

/**
 * Called once at start. The keys come from the environment when set; otherwise they are created
 * the first time and saved in the database. Phones subscribe to ONE key pair, so it must never
 * change: a key kept only on a temporary disk would break every phone after each restart.
 */
async function initPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    const [rows] = await db.query("SELECT name, value FROM settings WHERE name IN ('vapid_public', 'vapid_private')");
    const saved = Object.fromEntries(rows.map((row) => [row.name, row.value]));

    if (!saved.vapid_public || !saved.vapid_private) {
      const keys = webpush.generateVAPIDKeys();
      // INSERT IGNORE: if two servers start together, the first pair wins and both read it back.
      await db.query("INSERT IGNORE INTO settings (name, value) VALUES ('vapid_public', ?), ('vapid_private', ?)", [keys.publicKey, keys.privateKey]);
      const [again] = await db.query("SELECT name, value FROM settings WHERE name IN ('vapid_public', 'vapid_private')");
      Object.assign(saved, Object.fromEntries(again.map((row) => [row.name, row.value])));
    }

    process.env.VAPID_PUBLIC_KEY = saved.vapid_public;
    process.env.VAPID_PRIVATE_KEY = saved.vapid_private;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@microservicehub.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  enabled = true;
}

async function sendToSubscriptions(subscriptions, payload) {
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (error) {
        // The browser unsubscribed or the subscription expired: forget it.
        if (error.statusCode === 404 || error.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
        } else {
          console.warn('Push failed:', error.statusCode || error.message);
        }
      }
    })
  );
}

/** Sends a phone/browser push to every device a user enabled. Never throws. */
async function pushToUsers(userIds, payload) {
  if (!enabled || !userIds.length) return;

  try {
    const [subscriptions] = await db.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (?)',
      [userIds]
    );
    await sendToSubscriptions(subscriptions, payload);
  } catch (error) {
    console.warn('Push error:', error.message);
  }
}

module.exports = { initPush, pushToUsers, pushEnabled: () => enabled };
