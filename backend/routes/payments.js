const express = require('express');

const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { fail, toId, str, notify } = require('../helpers');
const { quote, getNumber } = require('../money');

const router = express.Router();

/**
 * Payment methods. "manual" methods work today: the seeker pays the provider
 * directly (cash, or a Nagad send-money transfer) and the provider
 * confirms receipt. To add a real online gateway later, give a method
 * `mode: 'online'` and create/verify the checkout in createPayment() and a
 * webhook route; the rest of the flow (statuses, notifications, UI) stays.
 */
const METHODS = {
  cash: { label: 'Cash on delivery', mode: 'manual' },
  nagad: { label: 'Nagad', mode: 'manual' },
};

const MOBILE = /^01[3-9]\d{8}$/;

function normalizeMobile(value) {
  const digits = str(value, 30).replace(/[\s-]/g, '').replace(/^\+?88/, '');
  return MOBILE.test(digits) ? digits : null;
}

// ---------- Provider payment settings ----------

router.get('/payment-settings', requireAuth, requireRole('provider'), async (req, res) => {
  const [[row]] = await db.query(
    'SELECT accepts_cash, nagad_number FROM users WHERE id = ?',
    [req.user.id]
  );

  res.json({
    success: true,
    settings: {
      accepts_cash: !!row.accepts_cash,
      nagad_number: row.nagad_number || '',
    },
  });
});

router.put('/payment-settings', requireAuth, requireRole('provider'), async (req, res) => {
  const acceptsCash = req.body.accepts_cash ? 1 : 0;
  const rawNagad = str(req.body.nagad_number, 30);

  const nagad = rawNagad ? normalizeMobile(rawNagad) : null;

  if (rawNagad && !nagad) fail(400, 'Enter a valid Nagad number (e.g. 01XXXXXXXXX).');
  if (!acceptsCash && !nagad) fail(400, 'Accept at least one payment method.');

  await db.query('UPDATE users SET accepts_cash = ?, nagad_number = ? WHERE id = ?', [acceptsCash, nagad, req.user.id]);

  res.json({ success: true, message: 'Payment settings saved.' });
});

// ---------- Payment for one work or booking ----------

async function loadContext(query) {
  const workId = toId(query.work_id);
  const bookingId = toId(query.booking_id);
  if (!workId === !bookingId) fail(400, 'Specify either work_id or booking_id.');

  if (workId) {
    const [rows] = await db.query(
      `SELECT id, seeker_id AS payer_id, assigned_provider_id AS payee_id, budget AS amount,
              status, title
       FROM services WHERE id = ?`,
      [workId]
    );
    const row = rows[0];
    if (!row || !row.payee_id) fail(404, 'Work not found or no provider hired yet.');

    return {
      kind: 'work',
      serviceId: workId,
      bookingId: null,
      payerId: row.payer_id,
      payeeId: row.payee_id,
      amount: row.amount,
      title: row.title,
      payable: ['assigned', 'in_progress', 'completed'].includes(row.status),
    };
  }

  const [rows] = await db.query(
    `SELECT b.id, b.customer_id AS payer_id, ps.provider_id AS payee_id, ps.price AS amount,
            b.status, ps.title
     FROM bookings b JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE b.id = ?`,
    [bookingId]
  );
  const row = rows[0];
  if (!row) fail(404, 'Booking not found.');

  return {
    kind: 'booking',
    serviceId: null,
    bookingId,
    payerId: row.payer_id,
    payeeId: row.payee_id,
    amount: row.amount,
    title: row.title,
    payable: ['accepted', 'in_progress', 'completed'].includes(row.status),
  };
}

const PAYMENT_COLUMNS = `id, service_id, booking_id, payer_id, payee_id, amount, method, status,
  trx_id, sender_number, note, created_at, paid_at, gateway, payout_status,
  fee_amount, discount_amount, promo_code, charged_amount, escrow_status, refund_status`;

router.get('/payments/for', requireAuth, async (req, res) => {
  const ctx = await loadContext(req.query);

  const isPayer = ctx.payerId === req.user.id;
  const isPayee = ctx.payeeId === req.user.id;
  if (!isPayer && !isPayee && req.user.role !== 'admin') fail(404, 'Not found.');

  const [payments] = await db.query(
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE ${ctx.kind === 'work' ? 'service_id' : 'booking_id'} = ?
     ORDER BY id DESC`,
    [ctx.kind === 'work' ? ctx.serviceId : ctx.bookingId]
  );

  const [[provider]] = await db.query(
    `SELECT full_name, accepts_cash, nagad_number FROM users WHERE id = ?`,
    [ctx.payeeId]
  );

  res.json({
    success: true,
    role: isPayer ? 'payer' : isPayee ? 'payee' : 'admin',
    amount: ctx.amount,
    payable: ctx.payable,
    payments,
    methods: {
      cash: !!provider.accepts_cash,
      nagad: provider.nagad_number || null,
    },
    online: {},
    fee_percent: await getNumber('fee_percent', 0),
    provider_name: provider.full_name,
  });
});

// What an online payment would cost, with an optional promo code (used by the payment screen).
router.get('/payments/quote', requireAuth, requireRole('seeker'), async (req, res) => {
  const ctx = await loadContext(req.query);
  if (ctx.payerId !== req.user.id) fail(404, 'Not found.');

  const promoCode = str(req.query.promo_code, 30);
  res.json({ success: true, quote: await quote({ amount: ctx.amount, promoCode, userId: req.user.id }) });
});

router.post('/payments', requireAuth, requireRole('seeker'), async (req, res) => {
  const method = req.body.method;
  if (!METHODS[method]) fail(400, 'Choose a payment method.');

  const ctx = await loadContext(req.body);
  if (ctx.payerId !== req.user.id) fail(404, 'Not found.');
  if (!ctx.payable) fail(409, 'Payment opens once the work is hired or the booking is accepted.');

  const [provider] = await db.query(
    'SELECT accepts_cash, nagad_number FROM users WHERE id = ?',
    [ctx.payeeId]
  );
  const p = provider[0];

  const offered =
    (method === 'cash' && p.accepts_cash) ||
    (method === 'nagad' && p.nagad_number);
  if (!offered) fail(400, `This provider does not accept ${METHODS[method].label}.`);

  let trxId = null;
  let senderNumber = null;

  if (method !== 'cash') {
    trxId = str(req.body.trx_id, 40).toUpperCase();
    senderNumber = normalizeMobile(req.body.sender_number);

    if (!/^[A-Z0-9]{6,40}$/.test(trxId)) fail(400, 'Enter the transaction ID (TrxID) from the payment message.');
    if (!senderNumber) fail(400, `Enter the ${METHODS[method].label} number you paid from.`);
  }

  const [open] = await db.query(
    `SELECT id FROM payments
     WHERE ${ctx.kind === 'work' ? 'service_id' : 'booking_id'} = ? AND status IN ('pending', 'paid')`,
    [ctx.kind === 'work' ? ctx.serviceId : ctx.bookingId]
  );
  if (open.length) fail(409, 'A payment already exists for this job.');

  let result;
  try {
    [result] = await db.query(
      `INSERT INTO payments (service_id, booking_id, payer_id, payee_id, amount, method, trx_id, sender_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.serviceId, ctx.bookingId, req.user.id, ctx.payeeId, ctx.amount, method, trxId, senderNumber]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail(409, 'This transaction ID was already used.');
    throw error;
  }

  await notify(
    ctx.payeeId,
    'payment_new',
    method === 'cash' ? 'Cash payment promised' : `${METHODS[method].label} payment sent`,
    `${req.user.full_name} paid BDT ${ctx.amount} for "${ctx.title}". Please confirm once you receive it.`,
    ctx.kind === 'work' ? `/work/${ctx.serviceId}` : '/provider-bookings'
  );

  res.status(201).json({
    success: true,
    message:
      method === 'cash'
        ? 'Cash on delivery chosen. Pay the provider in person.'
        : 'Payment submitted. The provider will confirm when it arrives.',
    payment_id: result.insertId,
  });
});

async function decide(req, res, status) {
  const id = toId(req.params.id);
  if (!id) fail(400, 'Invalid payment.');

  const [rows] = await db.query(
    `SELECT p.*, COALESCE(s.title, ps.title) AS title
     FROM payments p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
     WHERE p.id = ?`,
    [id]
  );
  const payment = rows[0];

  if (!payment || payment.payee_id !== req.user.id) fail(404, 'Payment not found.');
  if (payment.gateway) fail(409, 'Online payments are confirmed automatically.');
  if (payment.status !== 'pending') fail(409, 'This payment was already handled.');

  const note = status === 'failed' ? str(req.body.note, 255) || 'Payment not received.' : null;

  await db.query(
    `UPDATE payments SET status = ?, note = ?, paid_at = ${status === 'paid' ? 'NOW()' : 'NULL'} WHERE id = ?`,
    [status, note, id]
  );

  await notify(
    payment.payer_id,
    'payment_status',
    status === 'paid' ? 'Payment confirmed' : 'Payment not received',
    status === 'paid'
      ? `${req.user.full_name} confirmed your BDT ${payment.amount} payment for "${payment.title}".`
      : `${req.user.full_name} could not find your payment for "${payment.title}". ${note}`,
    payment.service_id ? `/work/${payment.service_id}` : '/my-bookings'
  );

  res.json({ success: true, message: status === 'paid' ? 'Payment confirmed.' : 'Payment marked as not received.' });
}

router.patch('/payments/:id/confirm', requireAuth, requireRole('provider'), (req, res) =>
  decide(req, res, 'paid')
);

router.patch('/payments/:id/reject', requireAuth, requireRole('provider'), (req, res) =>
  decide(req, res, 'failed')
);


// ---------- History ----------

router.get('/payments/mine', requireAuth, async (req, res) => {
  const [payments] = await db.query(
    `SELECT p.id, p.service_id, p.booking_id, p.payer_id, p.payee_id, p.amount, p.method,
            p.status, p.trx_id, p.created_at, p.paid_at, p.gateway, p.payout_status,
            p.fee_amount, p.discount_amount, p.promo_code, p.charged_amount, p.escrow_status, p.refund_status,
            COALESCE(s.title, ps.title) AS title,
            payer.full_name AS payer_name, payee.full_name AS payee_name
     FROM payments p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN bookings b ON b.id = p.booking_id
     LEFT JOIN provider_services ps ON ps.id = b.provider_service_id
     JOIN users payer ON payer.id = p.payer_id
     JOIN users payee ON payee.id = p.payee_id
     WHERE p.payer_id = ? OR p.payee_id = ?
     ORDER BY p.id DESC LIMIT 200`,
    [req.user.id, req.user.id]
  );

  res.json({ success: true, payments });
});

module.exports = router;
