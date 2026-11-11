const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { startTestServer, tomorrow } = require('./helpers');

// A stand-in for bKash that follows the tokenized checkout request shapes the client uses.
// It proves our side (verification, idempotence, payouts); it is not proof that bKash itself
// accepts these requests, so run a sandbox payment with real credentials before going live.
const CREDS = { username: 'merchant-user', password: 'merchant-pass', key: 'app-key', secret: 'app-secret' };
const gateway = { server: null, payments: new Map(), calls: [], behaviour: {} };

function startFakeBkash() {
  return new Promise((resolve) => {
    gateway.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        gateway.calls.push({ path: req.url, headers: req.headers, body });
        const reply = (data, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };

        if (req.url === '/tokenized/checkout/token/grant') {
          const ok =
            req.headers.username === CREDS.username && req.headers.password === CREDS.password &&
            body.app_key === CREDS.key && body.app_secret === CREDS.secret;
          return ok ? reply({ statusCode: '0000', id_token: 'token-123', expires_in: 3600 }) : reply({ statusCode: '2079', statusMessage: 'Invalid credentials' });
        }

        if (req.headers.authorization !== 'token-123' || req.headers['x-app-key'] !== CREDS.key) {
          return reply({ statusCode: '2001', statusMessage: 'Invalid app key or token' });
        }

        if (req.url === '/tokenized/checkout/create') {
          if (gateway.behaviour.failCreate) return reply({ statusCode: '2023', statusMessage: 'Insufficient merchant balance' });
          const paymentID = `PID${crypto.randomBytes(5).toString('hex')}`;
          gateway.payments.set(paymentID, { amount: body.amount, state: 'Initiated', trxID: `TRX${crypto.randomBytes(4).toString('hex').toUpperCase()}` });
          return reply({ statusCode: '0000', paymentID, bkashURL: `https://pay.bkash.test/${paymentID}` });
        }

        const record = gateway.payments.get(body.paymentID);
        if (!record) return reply({ statusCode: '2056', statusMessage: 'Invalid payment id' });

        if (req.url === '/tokenized/checkout/execute') {
          if (record.state === 'Completed') return reply({ statusCode: '2062', statusMessage: 'Already completed' });
          record.state = 'Completed';
          return reply({
            statusCode: '0000',
            transactionStatus: gateway.behaviour.executeStatus || 'Completed',
            trxID: record.trxID,
            amount: gateway.behaviour.amount || record.amount,
          });
        }

        if (req.url === '/tokenized/checkout/payment/status') {
          return reply({ statusCode: '0000', transactionStatus: record.state, trxID: record.trxID, amount: record.amount });
        }

        return reply({ statusCode: '9999' }, 404);
      });
    });
    gateway.server.listen(0, () => resolve(`http://127.0.0.1:${gateway.server.address().port}`));
  });
}

let t, seeker, provider, stranger, main;

before(async () => {
  t = await startTestServer();
  main = await t.makeAdmin();
  [seeker, provider, stranger] = await Promise.all([t.register('seeker'), t.register('provider'), t.register('seeker', 'stranger')]);
  await Promise.all([seeker, provider, stranger].map((user) => t.verify(user)));

  process.env.API_PUBLIC_URL = 'http://api.test';
  process.env.APP_URL = 'http://app.test';
});

after(async () => {
  gateway.server?.close();
  ['BKASH_MODE', 'BKASH_USERNAME', 'BKASH_PASSWORD', 'BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_BASE_URL'].forEach((name) => delete process.env[name]);
  await t.close();
});

// A fresh accepted booking on a fresh listing (one active booking per customer and listing is allowed).
async function acceptedBooking(customer = seeker) {
  const cat = await t.category();
  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: `Listing ${crypto.randomBytes(3).toString('hex')}`, description: 'd', location: 'Dhaka', price: 750 });
  const booked = await t.api('POST', '/bookings', customer.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'please come' });
  await t.api('PATCH', `/bookings/${booked.booking_id}/status`, provider.token, { status: 'accepted' });
  return booked.booking_id;
}

// What bKash does after the customer approves: send the browser to our callback URL.
async function callback(paymentId, paymentID, status = 'success') {
  const response = await fetch(`${t.base}/api/payments/bkash/callback?payment=${paymentId}&paymentID=${paymentID}&status=${status}`, { redirect: 'manual' });
  return { status: response.status, location: response.headers.get('location') };
}

const startOnline = (token, bookingId) => t.api('POST', '/payments/bkash/start', token, { booking_id: bookingId });
const refFor = async (paymentId) => (await t.db.query('SELECT * FROM payments WHERE id = ?', [paymentId]))[0][0];

test('online bKash stays off until the gateway is configured', async () => {
  const id = await acceptedBooking();
  assert.equal((await startOnline(seeker.token, id)).status, 409);

  await t.api('PUT', '/payment-settings', provider.token, { accepts_cash: true, bkash_number: '01712345678' });
  assert.equal((await t.api('GET', `/payments/for?booking_id=${id}`, seeker.token)).online.bkash, false);
});

test('starting a payment talks to bKash correctly and returns the payment link', async () => {
  process.env.BKASH_BASE_URL = await startFakeBkash();
  Object.assign(process.env, { BKASH_MODE: 'sandbox', BKASH_USERNAME: CREDS.username, BKASH_PASSWORD: CREDS.password, BKASH_APP_KEY: CREDS.key, BKASH_APP_SECRET: CREDS.secret });

  const id = await acceptedBooking();
  assert.equal((await t.api('GET', `/payments/for?booking_id=${id}`, seeker.token)).online.bkash, true);
  assert.equal((await startOnline(stranger.token, id)).status, 404, 'only the customer can pay');
  assert.equal((await startOnline(provider.token, id)).status, 403);

  const started = await startOnline(seeker.token, id);
  assert.ok(started.success);
  assert.match(started.redirect_url, /^https:\/\/pay\.bkash\.test\/PID/);

  const create = gateway.calls.find((call) => call.path === '/tokenized/checkout/create');
  assert.equal(create.body.mode, '0011');
  assert.equal(create.body.currency, 'BDT');
  assert.equal(create.body.intent, 'sale');
  assert.equal(create.body.amount, '750.00');
  assert.equal(create.body.merchantInvoiceNumber, `MSH${started.payment_id}`);
  assert.equal(create.body.callbackURL, `http://api.test/api/payments/bkash/callback?payment=${started.payment_id}`);

  const row = await refFor(started.payment_id);
  assert.equal(row.status, 'pending');
  assert.equal(row.gateway, 'bkash');
  assert.equal((await startOnline(seeker.token, id)).status, 409, 'one open payment at a time');
});

test('a forged callback changes nothing', async () => {
  const id = await acceptedBooking();
  const started = await startOnline(seeker.token, id);
  const row = await refFor(started.payment_id);

  const forged = await callback(started.payment_id, 'PIDforged000000', 'success');
  assert.match(forged.location, /^http:\/\/app\.test\/\?payment=failed/);
  assert.equal((await refFor(started.payment_id)).status, 'pending');

  const unknown = await callback(999999, row.gateway_ref, 'success');
  assert.match(unknown.location, /payment=failed/);
});

test('an approved payment is verified with bKash, marked paid, and queued for payout', async () => {
  const id = await acceptedBooking();
  const started = await startOnline(seeker.token, id);
  const { gateway_ref: ref } = await refFor(started.payment_id);

  const done = await callback(started.payment_id, ref);
  assert.equal(done.location, 'http://app.test/my-bookings?payment=success');

  const row = await refFor(started.payment_id);
  assert.equal(row.status, 'paid');
  assert.match(row.trx_id, /^TRX/);
  assert.equal(row.payout_status, 'none', 'the money is held until the work is confirmed');
  assert.equal(row.escrow_status, 'held');
  assert.ok(gateway.calls.some((call) => call.path === '/tokenized/checkout/execute' && call.body.paymentID === ref));

  const payerNote = (await t.api('GET', '/notifications', seeker.token)).notifications.find((n) => n.title === 'Payment received');
  const payeeNote = (await t.api('GET', '/notifications', provider.token)).notifications.find((n) => n.title === 'Online payment received');
  assert.ok(payerNote && payeeNote);

  // Reloading the callback page must not pay twice or notify twice.
  const again = await callback(started.payment_id, ref);
  assert.match(again.location, /payment=success/);
  const count = (await t.api('GET', '/notifications', seeker.token)).notifications.filter((n) => n.title === 'Payment received').length;
  assert.equal(count, 1);
});

test('cancelled and failed payments can be retried', async () => {
  const id = await acceptedBooking();
  const first = await startOnline(seeker.token, id);
  const { gateway_ref: ref } = await refFor(first.payment_id);

  assert.match((await callback(first.payment_id, ref, 'cancel')).location, /payment=failed/);
  const failed = await refFor(first.payment_id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.note, /Cancelled/);

  assert.ok((await startOnline(seeker.token, id)).success, 'a new attempt is allowed');
});

test('amount mismatches and non-completed states are rejected', async () => {
  const id = await acceptedBooking();

  gateway.behaviour = { amount: '1.00' };
  const wrongAmount = await startOnline(seeker.token, id);
  await callback(wrongAmount.payment_id, (await refFor(wrongAmount.payment_id)).gateway_ref);
  const mismatch = await refFor(wrongAmount.payment_id);
  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.note, /amount/i);

  gateway.behaviour = { executeStatus: 'Initiated' };
  const notDone = await startOnline(seeker.token, id);
  await callback(notDone.payment_id, (await refFor(notDone.payment_id)).gateway_ref);
  assert.equal((await refFor(notDone.payment_id)).status, 'failed');

  gateway.behaviour = {};
});

test('a payment already executed at bKash is confirmed by querying it', async () => {
  const id = await acceptedBooking();
  const started = await startOnline(seeker.token, id);
  const { gateway_ref: ref } = await refFor(started.payment_id);

  // Simulate the customer's browser having executed it once already (bKash then refuses a second execute).
  gateway.payments.get(ref).state = 'Completed';
  assert.match((await callback(started.payment_id, ref)).location, /payment=success/);
  assert.equal((await refFor(started.payment_id)).status, 'paid');
});

test('gateway errors are reported without leaving a stuck payment', async () => {
  const id = await acceptedBooking();
  gateway.behaviour = { failCreate: true };

  const started = await startOnline(seeker.token, id);
  assert.equal(started.status, 502);
  assert.ok(!JSON.stringify(started).includes('merchant balance'), 'internal bKash details are not leaked to the customer');

  gateway.behaviour = {};
  assert.ok((await startOnline(seeker.token, id)).success, 'the customer can try again straight away');
});

test('gateway payments cannot be confirmed by hand', async () => {
  const id = await acceptedBooking();
  const started = await startOnline(seeker.token, id);
  assert.equal((await t.api('PATCH', `/payments/${started.payment_id}/confirm`, provider.token)).status, 409);
});

test('payouts: only the main admin can mark them, once', async () => {
  // Only this run's payment: the shared test database also holds older runs' payments.
  const held = (await t.db.query("SELECT id FROM payments WHERE gateway = 'bkash' AND escrow_status = 'held' AND payee_id = ? LIMIT 1", [provider.id]))[0][0];
  assert.ok((await t.api('PATCH', `/admin/payments/${held.id}/escrow`, main.token, { action: 'release' })).success);
  const paid = held;

  assert.equal((await t.api('PATCH', `/admin/payments/${paid.id}/payout`, provider.token, {})).status, 403);

  const subAdmin = await t.register('seeker', 'subadmin');
  await t.api('POST', '/admin/admins', main.token, { email: subAdmin.email });
  const subSession = await t.api('POST', '/login', null, { email: subAdmin.email, password: subAdmin.password });
  assert.equal((await t.api('PATCH', `/admin/payments/${paid.id}/payout`, subSession.token, {})).status, 403, 'sub admins cannot');

  const stats = await t.api('GET', '/admin/stats', main.token);
  assert.ok(stats.stats.payouts_due >= 1);

  const listing = await t.api('GET', '/admin/payments?status=paid', main.token);
  const row = listing.payments.find((p) => p.id === paid.id);
  assert.equal(row.payee_bkash, '01712345678', 'the admin sees where to send the money');

  assert.ok((await t.api('PATCH', `/admin/payments/${paid.id}/payout`, main.token, { note: 'bKash TrxID 8KJ2' })).success);
  assert.equal((await t.api('PATCH', `/admin/payments/${paid.id}/payout`, main.token, {})).status, 409, 'cannot pay out twice');

  const note = (await t.api('GET', '/notifications', provider.token)).notifications.find((n) => n.type === 'payout_sent');
  assert.ok(note, 'the provider is told');
  assert.equal((await refFor(paid.id)).payout_status, 'paid_out');
});

test('fee and promo code: the customer is charged the quoted total and the code is used up', async () => {
  const money = require('../money');
  await money.setSetting('fee_percent', 10);
  try {
    const code = `GW${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
    assert.ok((await t.api('POST', '/admin/promos', main.token, { code, kind: 'fixed', value: 100, max_uses: 5 })).success);

    const id = await acceptedBooking();
    const started = await t.api('POST', '/payments/bkash/start', seeker.token, { booking_id: id, promo_code: code });
    assert.ok(started.success, JSON.stringify(started));

    const create = gateway.calls.filter((call) => call.path === '/tokenized/checkout/create').pop();
    assert.equal(create.body.amount, '725.00', 'price 750 + fee 75 - promo 100');

    const row = await refFor(started.payment_id);
    assert.deepEqual([Number(row.amount), Number(row.fee_amount), Number(row.discount_amount), Number(row.charged_amount)], [750, 75, 100, 725]);

    await callback(started.payment_id, row.gateway_ref);
    const paid = await refFor(started.payment_id);
    assert.equal(paid.status, 'paid', 'bKash confirmed the charged total, not the price');
    assert.equal(paid.escrow_status, 'held');
    assert.equal((await t.db.query('SELECT used_count FROM promo_codes WHERE code = ?', [code]))[0][0].used_count, 1);

    // The same code cannot be used again by this customer.
    const second = await acceptedBooking();
    assert.equal((await t.api('POST', '/payments/bkash/start', seeker.token, { booking_id: second, promo_code: code })).status, 400);
    assert.ok((await t.api('POST', '/payments/bkash/start', seeker.token, { booking_id: second })).success, 'without the code it still works');
  } finally {
    await money.setSetting('fee_percent', 0);
  }
});
