const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, tomorrow } = require('./helpers');

let t, seeker, provider, other, cat, listingId, bookingId;

// TrxIDs are globally unique, so every run needs fresh ones.
const trxId = () => `T${require('crypto').randomBytes(5).toString('hex').toUpperCase()}`;
const TRX = trxId();

before(async () => {
  t = await startTestServer();
  [seeker, provider, other] = await Promise.all([t.register('seeker'), t.register('provider'), t.register('seeker', 'other')]);
  await Promise.all([seeker, provider, other].map((user) => t.verify(user)));
  cat = await t.category();
});
after(() => t.close());

test('listings and bookings', async () => {
  assert.equal((await t.api('POST', '/my-listings', seeker.token, {})).status, 403);

  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: 'Plumbing', description: 'Pipes', location: 'Dhaka', price: 750 });
  assert.ok(listing.success);
  listingId = listing.id;

  const body = { provider_service_id: listingId, preferred_date: tomorrow(), message: 'Sink is leaking' };
  assert.equal((await t.api('POST', '/bookings', seeker.token, { ...body, preferred_date: '2020-01-01' })).status, 400, 'past date');

  const booked = await t.api('POST', '/bookings', seeker.token, body);
  assert.ok(booked.success);
  bookingId = booked.booking_id;
  assert.equal((await t.api('POST', '/bookings', seeker.token, body)).status, 409, 'no duplicate active booking');
});

test('booking status transitions respect who may do what', async () => {
  const set = (token, status) => t.api('PATCH', `/bookings/${bookingId}/status`, token, { status });

  assert.equal((await set(seeker.token, 'accepted')).status, 409, 'seeker cannot accept');
  assert.equal((await set(other.token, 'accepted')).status, 404, 'stranger cannot touch it');
  assert.ok((await set(provider.token, 'accepted')).success);
  assert.ok((await set(provider.token, 'in_progress')).success);
  assert.equal((await set(provider.token, 'completed')).status, 409, 'provider cannot complete');
  assert.ok((await set(seeker.token, 'completed')).success);
  assert.ok((await t.api('POST', '/reviews', seeker.token, { booking_id: bookingId, rating: 4 })).success);
});

test('provider payment settings are validated', async () => {
  assert.equal((await t.api('PUT', '/payment-settings', seeker.token, { accepts_cash: true })).status, 403);
  assert.equal((await t.api('PUT', '/payment-settings', provider.token, { accepts_cash: false })).status, 400);
  assert.equal((await t.api('PUT', '/payment-settings', provider.token, { accepts_cash: true, bkash_number: '123' })).status, 400);

  assert.ok((await t.api('PUT', '/payment-settings', provider.token, { accepts_cash: true, bkash_number: '+8801712345678', nagad_number: '01912345678' })).success);
  assert.equal((await t.api('GET', '/payment-settings', provider.token)).settings.bkash_number, '01712345678');
});

test('manual bKash payment: submit, reject, retry with cash, confirm', async () => {
  const fresh = await t.api('POST', '/bookings', other.token, { provider_service_id: listingId, preferred_date: tomorrow(), message: 'Another job' });
  const id = fresh.booking_id;
  const pay = (token, body) => t.api('POST', '/payments', token, { booking_id: id, ...body });

  assert.equal((await pay(other.token, { method: 'cash' })).status, 409, 'cannot pay before the booking is accepted');
  await t.api('PATCH', `/bookings/${id}/status`, provider.token, { status: 'accepted' });

  assert.equal((await pay(seeker.token, { method: 'cash' })).status, 404, 'only the customer can pay');
  assert.equal((await pay(other.token, { method: 'paypal' })).status, 400);
  assert.equal((await pay(other.token, { method: 'bkash', sender_number: '01811111111' })).status, 400, 'needs TrxID');
  assert.equal((await pay(other.token, { method: 'bkash', trx_id: TRX })).status, 400, 'needs sender number');

  const info = await t.api('GET', `/payments/for?booking_id=${id}`, other.token);
  assert.equal(info.methods.bkash, '01712345678');
  assert.equal(Number(info.amount), 750);

  const first = await pay(other.token, { method: 'bkash', trx_id: TRX.toLowerCase(), sender_number: '01811111111' });
  assert.ok(first.success);
  assert.equal((await pay(other.token, { method: 'cash' })).status, 409, 'one open payment at a time');
  assert.equal((await t.api('PATCH', `/payments/${first.payment_id}/confirm`, other.token)).status, 403, 'payer cannot confirm');

  assert.ok((await t.api('PATCH', `/payments/${first.payment_id}/reject`, provider.token, { note: 'Not received' })).success);
  assert.equal((await pay(other.token, { method: 'bkash', trx_id: TRX, sender_number: '01811111111' })).status, 409, 'TrxID cannot be reused');

  const cash = await pay(other.token, { method: 'cash' });
  assert.ok((await t.api('PATCH', `/payments/${cash.payment_id}/confirm`, provider.token)).success);

  const notes = (await t.api('GET', '/notifications', other.token)).notifications;
  const confirmed = notes.find((n) => n.type === 'payment_status' && n.title === 'Payment confirmed');
  assert.ok(confirmed, 'the payer is told the payment was confirmed');
  assert.match(confirmed.body, /confirmed your BDT 750/);
  assert.ok(notes.some((n) => n.type === 'payment_status' && n.title === 'Payment not received'), 'and told about the rejected attempt');

  const overview = await t.api('GET', '/provider/overview', provider.token);
  assert.equal(Number(overview.overview.received), 750);
});

test('a method the provider does not offer is refused', async () => {
  await t.api('PUT', '/payment-settings', provider.token, { accepts_cash: true, bkash_number: '01712345678' });
  const fresh = await t.api('POST', '/bookings', seeker.token, { provider_service_id: listingId, preferred_date: tomorrow(), message: 'Third job' });
  await t.api('PATCH', `/bookings/${fresh.booking_id}/status`, provider.token, { status: 'accepted' });

  const nagad = await t.api('POST', '/payments', seeker.token, { booking_id: fresh.booking_id, method: 'nagad', trx_id: trxId(), sender_number: '01711111111' });
  assert.equal(nagad.status, 400);
});
