// Fees, promo codes, referrals and escrow. Routes call these helpers so the rules live in one place.
const crypto = require('crypto');

const db = require('./db');
const { fail, notify } = require('./helpers');

// ---------- Settings (small key/value table the main admin can change) ----------

async function getNumber(name, fallback) {
  const [rows] = await db.query('SELECT value FROM settings WHERE name = ?', [name]);
  const value = rows.length ? Number(rows[0].value) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

async function setSetting(name, value) {
  await db.query(
    'INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [name, String(value)]
  );
}

const money = (value) => Math.round(Number(value) * 100) / 100;

// ---------- Promo codes ----------

const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;
const normalizeCode = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

/** Returns the promo row if this user may use it now, otherwise throws a 400 with the reason. */
async function findUsablePromo(rawCode, userId) {
  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) fail(400, 'Enter a valid promo code.');

  const [rows] = await db.query('SELECT *, (expires_on IS NOT NULL AND expires_on < CURDATE()) AS is_expired FROM promo_codes WHERE code = ?', [code]);
  const promo = rows[0];

  if (!promo || !promo.active) fail(400, 'This promo code is not valid.');
  if (promo.user_id && promo.user_id !== userId) fail(400, 'This promo code is not valid.');
  if (promo.is_expired) fail(400, 'This promo code has expired.');
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) fail(400, 'This promo code has been fully used.');

  const [used] = await db.query(
    "SELECT id FROM payments WHERE promo_code = ? AND payer_id = ? AND status IN ('pending', 'paid') LIMIT 1",
    [code, userId]
  );
  if (used.length) fail(400, 'You have already used this promo code.');

  return promo;
}

/**
 * What the payer is charged for an online payment. The provider always receives `amount`;
 * the service fee is added on top, and a promo code can reduce the total (the platform covers it).
 */
async function quote({ amount, promoCode, userId }) {
  const feePercent = await getNumber('fee_percent', 0);
  const price = money(amount);
  const fee = money((price * feePercent) / 100);
  const gross = money(price + fee);

  let discount = 0;
  let promo = null;
  if (promoCode) {
    promo = await findUsablePromo(promoCode, userId);
    const raw = promo.kind === 'percent' ? (gross * Number(promo.value)) / 100 : Number(promo.value);
    discount = money(Math.min(raw, Math.max(gross - 1, 0))); // always charge at least BDT 1
  }

  return {
    amount: price,
    fee_percent: feePercent,
    fee,
    discount,
    total: money(gross - discount),
    promo_code: promo ? promo.code : null,
  };
}

// ---------- Referrals ----------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  let out = '';
  for (const byte of crypto.randomBytes(length)) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

async function referralCodeFor(userId) {
  const [[row]] = await db.query('SELECT referral_code FROM users WHERE id = ?', [userId]);
  if (row.referral_code) return row.referral_code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode(8);
    const [[taken]] = await db.query('SELECT COUNT(*) AS c FROM users WHERE referral_code = ?', [code]);
    if (taken.c) continue;
    await db.query('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL', [code, userId]);
    break;
  }
  const [[after]] = await db.query('SELECT referral_code FROM users WHERE id = ?', [userId]);
  return after.referral_code;
}

/** A personal, single-use code that only this user can apply. Returns null when bonuses are off. */
async function givePersonalPromo(userId, prefix) {
  const bonus = await getNumber('referral_bonus', 0);
  if (bonus <= 0) return null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `${prefix}-${randomCode(6)}`;
    try {
      await db.query(
        "INSERT INTO promo_codes (code, kind, value, max_uses, user_id) VALUES (?, 'fixed', ?, 1, ?)",
        [code, bonus, userId]
      );
      return { code, bonus };
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  return null;
}

/** Called right after a user registers with someone's referral code. Never blocks registration. */
async function applyReferral(newUserId, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return;

  try {
    const [owner] = await db.query('SELECT id FROM users WHERE referral_code = ? AND id <> ?', [code, newUserId]);
    if (!owner.length) return;

    await db.query('UPDATE users SET referred_by = ? WHERE id = ?', [owner[0].id, newUserId]);
    const gift = await givePersonalPromo(newUserId, 'WELCOME');
    if (gift) {
      await notify(
        newUserId,
        'promo',
        'Welcome gift',
        `Use code ${gift.code} on an online payment to save BDT ${gift.bonus}.`,
        '/referrals'
      );
    }
  } catch (error) {
    console.error('Referral could not be applied:', error.message);
  }
}

/** The referrer is rewarded once, when the person they invited makes their first online payment. */
async function rewardReferrer(payerId) {
  const [[payer]] = await db.query('SELECT referred_by, referral_rewarded FROM users WHERE id = ?', [payerId]);
  if (!payer || !payer.referred_by || payer.referral_rewarded) return;

  const [claimed] = await db.query('UPDATE users SET referral_rewarded = 1 WHERE id = ? AND referral_rewarded = 0', [payerId]);
  if (!claimed.affectedRows) return;

  const gift = await givePersonalPromo(payer.referred_by, 'THANKS');
  if (gift) {
    await notify(
      payer.referred_by,
      'promo',
      'Referral reward',
      `Someone you invited made their first payment. Use code ${gift.code} to save BDT ${gift.bonus}.`,
      '/referrals'
    );
  }
}

// ---------- Escrow ----------
// An online payment goes to the platform first ("held"). It is released to the provider's
// payout queue when the seeker marks the job complete, or when an admin settles a dispute.

const titleOf = `COALESCE(s.title, ps.title)`;

async function paymentInfo(paymentId) {
  const [rows] = await db.query(
    `SELECT p.*, ${titleOf} AS title
     FROM payments p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE p.id = ?`,
    [paymentId]
  );
  return rows[0];
}

async function announceRelease(payment) {
  await notify(
    payment.payee_id,
    'payment_status',
    'Payment released to you',
    `BDT ${payment.amount} for "${payment.title}" was released. Your payout is on its way.`,
    '/payments'
  );
}

/** Releases whatever is held for one job. Used when the seeker marks the job complete. */
async function releaseForJob({ serviceId = null, bookingId = null }) {
  const column = serviceId ? 'service_id' : 'booking_id';
  const [held] = await db.query(
    `SELECT id FROM payments
     WHERE ${column} = ? AND gateway IS NOT NULL AND status = 'paid' AND escrow_status = 'held'`,
    [serviceId || bookingId]
  );

  for (const { id } of held) {
    const [done] = await db.query(
      "UPDATE payments SET escrow_status = 'released', payout_status = 'due' WHERE id = ? AND escrow_status = 'held'",
      [id]
    );
    if (done.affectedRows) await announceRelease(await paymentInfo(id));
  }
}

async function jobIsCompleted({ serviceId = null, bookingId = null }) {
  const [[job]] = serviceId
    ? await db.query('SELECT status FROM services WHERE id = ?', [serviceId])
    : await db.query('SELECT status FROM bookings WHERE id = ?', [bookingId]);
  return !!job && job.status === 'completed';
}

/** Admin or dispute decision: send the held money to the provider. */
async function releasePayment(paymentId) {
  const [done] = await db.query(
    `UPDATE payments SET escrow_status = 'released', payout_status = 'due'
     WHERE id = ? AND gateway IS NOT NULL AND status = 'paid' AND escrow_status IN ('held', 'disputed')`,
    [paymentId]
  );
  if (!done.affectedRows) fail(409, 'This payment is not being held.');
  await announceRelease(await paymentInfo(paymentId));
}

/** Admin or dispute decision: give the money back to the seeker. */
async function refundPayment(paymentId) {
  const [done] = await db.query(
    `UPDATE payments SET escrow_status = 'refunded', status = 'refunded', refund_status = 'due', payout_status = 'none'
     WHERE id = ? AND gateway IS NOT NULL AND status = 'paid' AND escrow_status IN ('held', 'disputed')`,
    [paymentId]
  );
  if (!done.affectedRows) fail(409, 'This payment is not being held.');

  const payment = await paymentInfo(paymentId);
  await notify(
    payment.payer_id,
    'payment_status',
    'Refund approved',
    `BDT ${payment.charged_amount ?? payment.amount} for "${payment.title}" will be refunded to you.`,
    '/payments'
  );
  await notify(payment.payee_id, 'payment_status', 'Payment refunded to the seeker', `The payment for "${payment.title}" was refunded after review.`, '/payments');
}

module.exports = {
  getNumber, setSetting, money, normalizeCode, CODE_PATTERN,
  findUsablePromo, quote,
  referralCodeFor, givePersonalPromo, applyReferral, rewardReferrer,
  paymentInfo, jobIsCompleted, releaseForJob, releasePayment, refundPayment,
};
