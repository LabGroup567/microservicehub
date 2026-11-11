const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer, tomorrow, PASSWORD } = require('./helpers');
const money = require('../money');

let t, main, sub, seeker, provider, stranger, categoryId;

before(async () => {
  t = await startTestServer();
  main = await t.makeAdmin();
  [seeker, provider, stranger, sub] = await Promise.all([
    t.register('seeker'), t.register('provider'), t.register('seeker', 'stranger'), t.register('seeker', 'subadmin'),
  ]);
  await Promise.all([seeker, provider, stranger].map((user) => t.verify(user)));
  categoryId = await t.category();

  await t.api('POST', '/admin/admins', main.token, { email: sub.email });
  sub = { ...sub, token: (await t.api('POST', '/login', null, { email: sub.email, password: PASSWORD })).token };
});

after(async () => {
  // The fee setting is shared by every test file, so leave it at zero.
  await money.setSetting('fee_percent', 0);
  await t.close();
});

const rand = () => crypto.randomBytes(3).toString('hex');

async function listing(price = 1000, extra = {}) {
  const made = await t.api('POST', '/my-listings', provider.token, {
    category_id: categoryId, title: `Listing ${rand()}`, description: 'desc', location: 'Dhaka', price, ...extra,
  });
  assert.ok(made.success, JSON.stringify(made));
  return made.id;
}

async function acceptedBooking(customer = seeker) {
  const id = await listing(1000);
  const booked = await t.api('POST', '/bookings', customer.token, { provider_service_id: id, preferred_date: tomorrow(), message: 'please come' });
  assert.ok(booked.success, JSON.stringify(booked));
  await t.api('PATCH', `/bookings/${booked.booking_id}/status`, provider.token, { status: 'accepted' });
  return booked.booking_id;
}

// A paid online payment held in escrow, as the bKash callback leaves it.
async function heldPayment(bookingId, amount = 1000) {
  const [result] = await t.db.query(
    `INSERT INTO payments (booking_id, payer_id, payee_id, amount, method, status, gateway, gateway_ref, trx_id,
                           charged_amount, escrow_status, paid_at)
     VALUES (?, ?, ?, ?, 'bkash', 'paid', 'bkash', ?, ?, ?, 'held', NOW())`,
    [bookingId, seeker.id, provider.id, amount, `PID${rand()}`, `T${rand()}${rand()}`.toUpperCase(), amount]
  );
  return result.insertId;
}

const payment = async (id) => (await t.db.query('SELECT * FROM payments WHERE id = ?', [id]))[0][0];

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function upload(token, bytes, name = 'photo.png', type = 'image/png') {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), name);
  const response = await fetch(`${t.base}/api/images`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: response.status, ...(await response.json()) };
}

// ---------- Photos ----------

test('photos: only real images are accepted, and they show on listings and work', async () => {
  assert.equal((await upload(null, PNG)).status, 401);
  assert.equal((await upload(provider.token, Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 400, 'a renamed text file is refused');

  const saved = await upload(provider.token, PNG);
  assert.equal(saved.status, 201);

  const served = await fetch(`${t.base}/api/images/${saved.image_id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await fetch(`${t.base}/api/images/99999999`)).status, 404);

  // Somebody else's photo cannot be attached.
  const bad = await t.api('POST', '/my-listings', stranger.token, {});
  assert.ok(bad.status >= 400);
  const stolen = await t.api('POST', '/services', seeker.token, { category_id: categoryId, title: 'Photo work', description: 'd', location: 'Dhaka', budget: 500, image_id: saved.image_id });
  assert.equal(stolen.status, 400);

  const id = await listing(800, { image_id: saved.image_id });
  const browse = await t.api('GET', '/provider-services', seeker.token);
  assert.equal(browse.services.find((s) => s.id === id).image_id, saved.image_id);

  const mine = await upload(seeker.token, PNG);
  const work = await t.api('POST', '/services', seeker.token, { category_id: categoryId, title: 'Photo work', description: 'd', location: 'Dhaka', budget: 500, image_id: mine.image_id });
  assert.ok(work.success);
  const open = await t.api('GET', '/services', provider.token);
  assert.equal(open.services.find((s) => s.id === work.service_id).image_id, mine.image_id);

  // Replacing the photo removes the old file once nothing uses it.
  const next = await upload(seeker.token, PNG);
  assert.ok((await t.api('PUT', `/my-work/${work.service_id}`, seeker.token, { category_id: categoryId, title: 'Photo work', description: 'd', location: 'Dhaka', budget: 500, image_id: next.image_id })).success);
  assert.equal((await fetch(`${t.base}/api/images/${mine.image_id}`)).status, 404);
});

// ---------- Fee and promo codes ----------

test('fee settings: only the main admin changes them, within limits', async () => {
  assert.equal((await t.api('PUT', '/admin/settings', sub.token, { fee_percent: 5, referral_bonus: 50 })).status, 403);
  assert.equal((await t.api('PUT', '/admin/settings', provider.token, { fee_percent: 5, referral_bonus: 50 })).status, 403);
  assert.equal((await t.api('PUT', '/admin/settings', main.token, { fee_percent: 31, referral_bonus: 50 })).status, 400);
  assert.equal((await t.api('PUT', '/admin/settings', main.token, { fee_percent: -1, referral_bonus: 50 })).status, 400);
  assert.ok((await t.api('PUT', '/admin/settings', main.token, { fee_percent: 10, referral_bonus: 50 })).success);
  assert.equal((await t.api('GET', '/admin/settings', sub.token)).settings.fee_percent, 10, 'sub admins can read it');
});

test('quotes add the fee on top and apply promo codes', async () => {
  await t.api('PUT', '/admin/settings', main.token, { fee_percent: 10, referral_bonus: 50 });
  const bookingId = await acceptedBooking();

  const plain = await t.api('GET', `/payments/quote?booking_id=${bookingId}`, seeker.token);
  assert.deepEqual([plain.quote.amount, plain.quote.fee, plain.quote.discount, plain.quote.total], [1000, 100, 0, 1100]);

  const fixed = `FIX${rand()}`.toUpperCase();
  const percent = `PCT${rand()}`.toUpperCase();
  const expired = `OLD${rand()}`.toUpperCase();
  assert.equal((await t.api('POST', '/admin/promos', sub.token, { code: fixed, kind: 'fixed', value: 50 })).status, 403, 'sub admins cannot create codes');
  assert.ok((await t.api('POST', '/admin/promos', main.token, { code: fixed, kind: 'fixed', value: 50 })).success);
  assert.ok((await t.api('POST', '/admin/promos', main.token, { code: percent, kind: 'percent', value: 10, max_uses: 1 })).success);
  assert.ok((await t.api('POST', '/admin/promos', main.token, { code: expired, kind: 'fixed', value: 50, expires_on: '2020-01-01' })).success);
  assert.equal((await t.api('POST', '/admin/promos', main.token, { code: fixed, kind: 'fixed', value: 50 })).status, 409, 'duplicate code');
  assert.equal((await t.api('POST', '/admin/promos', main.token, { code: 'x', kind: 'fixed', value: 5 })).status, 400);
  assert.equal((await t.api('POST', '/admin/promos', main.token, { code: `BAD${rand()}`.toUpperCase(), kind: 'percent', value: 150 })).status, 400);

  const withFixed = await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${fixed.toLowerCase()}`, seeker.token);
  assert.deepEqual([withFixed.quote.discount, withFixed.quote.total, withFixed.quote.promo_code], [50, 1050, fixed], 'codes are not case sensitive');

  const withPercent = await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${percent}`, seeker.token);
  assert.equal(withPercent.quote.discount, 110);
  assert.equal(withPercent.quote.total, 990);

  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${expired}`, seeker.token)).status, 400);
  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=NOPE${rand()}`, seeker.token)).status, 400);
  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}`, stranger.token)).status, 404, 'only the payer');

  // A code that has hit its limit, and a code this user already used, stop working.
  await t.db.query('UPDATE promo_codes SET used_count = 1 WHERE code = ?', [percent]);
  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${percent}`, seeker.token)).status, 400);

  await t.db.query("INSERT INTO payments (booking_id, payer_id, payee_id, amount, method, status, promo_code) VALUES (?, ?, ?, 1000, 'bkash', 'pending', ?)", [bookingId, seeker.id, provider.id, fixed]);
  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${fixed}`, seeker.token)).status, 400);

  // A discount can never make the payment free.
  const huge = `BIG${rand()}`.toUpperCase();
  await t.api('POST', '/admin/promos', main.token, { code: huge, kind: 'fixed', value: 99999 });
  const free = await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${huge}`, seeker.token);
  assert.equal(free.quote.total, 1);

  // Turning a code off stops it.
  const listed = (await t.api('GET', '/admin/promos', sub.token)).promos.find((p) => p.code === huge);
  assert.ok((await t.api('PATCH', `/admin/promos/${listed.id}/active`, main.token, { active: false })).success);
  assert.equal((await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${huge}`, seeker.token)).status, 400);

  await t.api('PUT', '/admin/settings', main.token, { fee_percent: 0, referral_bonus: 50 });
});

// ---------- Escrow ----------

test('escrow: held money is released when the seeker completes the booking', async () => {
  const bookingId = await acceptedBooking();
  const id = await heldPayment(bookingId);

  await t.api('PATCH', `/bookings/${bookingId}/status`, provider.token, { status: 'in_progress' });
  assert.equal((await payment(id)).escrow_status, 'held');
  assert.equal((await payment(id)).payout_status, 'none');

  assert.ok((await t.api('PATCH', `/bookings/${bookingId}/status`, seeker.token, { status: 'completed' })).success);
  const row = await payment(id);
  assert.equal(row.escrow_status, 'released');
  assert.equal(row.payout_status, 'due');

  const note = (await t.api('GET', '/notifications', provider.token)).notifications.find((n) => n.title === 'Payment released to you');
  assert.ok(note);
});

test('escrow: a dispute freezes the money and an admin decides', async () => {
  const bookingId = await acceptedBooking();
  const id = await heldPayment(bookingId);
  await t.api('PATCH', `/bookings/${bookingId}/status`, provider.token, { status: 'in_progress' });

  assert.equal((await t.api('POST', '/disputes', stranger.token, { booking_id: bookingId, reason: 'Not my job at all' })).status, 404);
  assert.equal((await t.api('POST', '/disputes', seeker.token, { booking_id: bookingId, reason: 'short' })).status, 400);
  const opened = await t.api('POST', '/disputes', seeker.token, { booking_id: bookingId, reason: 'The provider never showed up.' });
  assert.equal(opened.status, 201);
  assert.equal((await t.api('POST', '/disputes', provider.token, { booking_id: bookingId, reason: 'I was there, no one answered' })).status, 409, 'one open dispute per job');
  assert.equal((await payment(id)).escrow_status, 'disputed');

  // The seeker completing the job cannot release disputed money.
  await t.api('PATCH', `/bookings/${bookingId}/status`, seeker.token, { status: 'completed' });
  assert.equal((await payment(id)).escrow_status, 'disputed');

  const mine = await t.api('GET', '/disputes/mine', provider.token);
  const dispute = mine.disputes.find((d) => d.id === opened.dispute_id);
  assert.ok(dispute && dispute.escrow_status === 'disputed');
  assert.equal((await t.api('GET', '/disputes/mine', stranger.token)).disputes.some((d) => d.id === opened.dispute_id), false);

  assert.equal((await t.api('GET', '/admin/disputes', seeker.token)).status, 403);
  assert.equal((await t.api('PATCH', `/admin/disputes/${dispute.id}`, sub.token, { action: 'refund', note: 'Refund' })).status, 403, 'sub admins cannot move money');
  assert.equal((await t.api('PATCH', `/admin/disputes/${dispute.id}`, main.token, { action: 'refund' })).status, 400, 'a note is required');

  assert.ok((await t.api('PATCH', `/admin/disputes/${dispute.id}`, main.token, { action: 'refund', note: 'Provider did not attend.' })).success);
  const row = await payment(id);
  assert.equal(row.escrow_status, 'refunded');
  assert.equal(row.status, 'refunded');
  assert.equal(row.refund_status, 'due');
  assert.equal(row.payout_status, 'none');
  assert.equal((await t.api('PATCH', `/admin/disputes/${dispute.id}`, main.token, { action: 'release', note: 'again' })).status, 409, 'already decided');

  assert.equal((await t.api('PATCH', `/admin/payments/${id}/refund-sent`, sub.token)).status, 403);
  assert.ok((await t.api('PATCH', `/admin/payments/${id}/refund-sent`, main.token)).success);
  assert.equal((await payment(id)).refund_status, 'sent');
  assert.equal((await t.api('PATCH', `/admin/payments/${id}/refund-sent`, main.token)).status, 409);

  const told = (await t.api('GET', '/notifications', seeker.token)).notifications.find((n) => n.title === 'Refund approved');
  assert.ok(told);
});

test('escrow: releasing a dispute pays the provider, dismissing returns the money to normal', async () => {
  const releaseJob = await acceptedBooking();
  const releaseId = await heldPayment(releaseJob);
  const d1 = await t.api('POST', '/disputes', provider.token, { booking_id: releaseJob, reason: 'The seeker disputes a finished job.' });
  assert.ok((await t.api('PATCH', `/admin/disputes/${d1.dispute_id}`, main.token, { action: 'release', note: 'Work was done.' })).success);
  assert.deepEqual([(await payment(releaseId)).escrow_status, (await payment(releaseId)).payout_status], ['released', 'due']);

  const dismissJob = await acceptedBooking();
  const dismissId = await heldPayment(dismissJob);
  const d2 = await t.api('POST', '/disputes', seeker.token, { booking_id: dismissJob, reason: 'I changed my mind about this.' });
  assert.equal((await payment(dismissId)).escrow_status, 'disputed');
  assert.ok((await t.api('PATCH', `/admin/disputes/${d2.dispute_id}`, sub.token, { action: 'dismiss', note: 'No problem found.' })).success, 'any admin can close a dispute');
  assert.equal((await payment(dismissId)).escrow_status, 'held', 'the money goes back to waiting for completion');

  // A dispute on a job with no held money can still be closed with a note, but not released or refunded.
  const plainJob = await acceptedBooking();
  const d3 = await t.api('POST', '/disputes', seeker.token, { booking_id: plainJob, reason: 'Paid in cash, provider rude.' });
  assert.equal((await t.api('PATCH', `/admin/disputes/${d3.dispute_id}`, main.token, { action: 'refund', note: 'x' })).status, 409);
  assert.equal((await t.db.query('SELECT status FROM disputes WHERE id = ?', [d3.dispute_id]))[0][0].status, 'open', 'a failed decision leaves the dispute open');
  assert.ok((await t.api('PATCH', `/admin/disputes/${d3.dispute_id}`, main.token, { action: 'dismiss', note: 'Handled by chat.' })).success);
});

// ---------- Availability ----------

test('availability: days off block bookings and filter providers', async () => {
  const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const other = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  assert.equal((await t.api('PUT', '/my-availability', seeker.token, { days: [day] })).status, 403);
  assert.equal((await t.api('PUT', '/my-availability', provider.token, { days: ['tomorrow'] })).status, 400);
  assert.ok((await t.api('PUT', '/my-availability', provider.token, { days: [day, day] })).success);

  const calendar = await t.api('GET', `/availability/${provider.id}`, seeker.token);
  assert.deepEqual(calendar.days_off, [day]);

  const id = await listing(500);
  const blocked = await t.api('POST', '/bookings', seeker.token, { provider_service_id: id, preferred_date: day, message: 'that day please' });
  assert.equal(blocked.status, 409);

  const freeDay = await t.api('POST', '/bookings', seeker.token, { provider_service_id: id, preferred_date: other, message: 'the next day' });
  assert.ok(freeDay.success);

  const filtered = await t.api('GET', `/provider-services?available_on=${day}`, seeker.token);
  assert.equal(filtered.services.some((s) => s.id === id), false);
  assert.equal((await t.api('GET', `/provider-services?available_on=${other}`, seeker.token)).services.some((s) => s.id === id), true);

  // Saving a new list replaces the old one.
  assert.ok((await t.api('PUT', '/my-availability', provider.token, { days: [other] })).success);
  assert.deepEqual((await t.api('GET', `/availability/${provider.id}`, seeker.token)).days_off, [other]);
  assert.ok((await t.api('PUT', '/my-availability', provider.token, { days: [] })).success);
  assert.deepEqual((await t.api('GET', `/availability/${provider.id}`, seeker.token)).days_off, []);
});

// ---------- Search ----------

test('search: sort, price, rating and verified filters', async () => {
  const marker = rand();
  const cheap = await listing(100, { title: `Zed ${marker} cheap` });
  const dear = await listing(900, { title: `Zed ${marker} dear` });

  const ids = (result) => result.services.map((s) => s.id);

  const low = await t.api('GET', `/provider-services?q=${marker}&sort=price_low`, seeker.token);
  assert.deepEqual(ids(low), [cheap, dear]);
  const high = await t.api('GET', `/provider-services?q=${marker}&sort=price_high`, seeker.token);
  assert.deepEqual(ids(high), [dear, cheap]);

  assert.deepEqual(ids(await t.api('GET', `/provider-services?q=${marker}&min_price=500`, seeker.token)), [dear]);
  assert.deepEqual(ids(await t.api('GET', `/provider-services?q=${marker}&max_price=500`, seeker.token)), [cheap]);

  // Nobody has reviewed this provider yet, so a minimum rating hides them.
  const fresh = await t.register('provider', 'fresh');
  await t.verify(fresh);
  const made = await t.api('POST', '/my-listings', fresh.token, { category_id: categoryId, title: `Zed ${marker} fresh`, description: 'd', location: 'Dhaka', price: 300 });
  assert.ok(made.success);
  assert.equal(ids(await t.api('GET', `/provider-services?q=${marker}&min_rating=4`, seeker.token)).length, 0);

  await t.db.query("INSERT INTO reviews (reviewer_id, provider_id, booking_id, rating) VALUES (?, ?, ?, 5)", [seeker.id, fresh.id, 987654]);
  assert.deepEqual(ids(await t.api('GET', `/provider-services?q=${marker}&min_rating=4`, seeker.token)), [made.id]);
  const byRating = await t.api('GET', `/provider-services?q=${marker}&sort=rating`, seeker.token);
  assert.equal(ids(byRating)[0], made.id, 'the reviewed provider comes first');

  await t.db.query("UPDATE users SET kyc_status = 'none' WHERE id = ?", [fresh.id]);
  assert.equal(ids(await t.api('GET', `/provider-services?q=${marker}&verified=1`, seeker.token)).includes(made.id), false);
  assert.equal(ids(await t.api('GET', `/provider-services?q=${marker}&verified=1`, seeker.token)).includes(cheap), true);
});

// ---------- Referrals ----------

test('referrals: new users get a welcome code and the referrer is rewarded once', async () => {
  await t.api('PUT', '/admin/settings', main.token, { fee_percent: 0, referral_bonus: 40 });

  const mine = await t.api('GET', '/referrals/me', seeker.token);
  assert.match(mine.referral_code, /^[A-Z0-9]{8}$/);
  assert.equal((await t.api('GET', '/referrals/me', seeker.token)).referral_code, mine.referral_code, 'the code is stable');

  const email = `invited.${rand()}@test.local`;
  const joined = await t.api('POST', '/register', null, { full_name: 'Invited Person', email, password: PASSWORD, role: 'seeker', referral_code: mine.referral_code.toLowerCase() });
  assert.ok(joined.success);

  const welcome = (await t.api('GET', '/referrals/me', joined.token)).promos[0];
  assert.match(welcome.code, /^WELCOME-/);
  assert.equal(Number(welcome.value), 40);
  assert.equal((await t.api('GET', '/referrals/me', seeker.token)).invited >= 1, true);

  // The welcome code works for the new user only.
  await t.verify(joined.user);
  const bookingId = await acceptedBooking(joined);
  const ok = await t.api('GET', `/payments/quote?booking_id=${bookingId}&promo_code=${welcome.code}`, joined.token);
  assert.equal(ok.quote.discount, 40);
  const before = (await t.api('GET', '/referrals/me', seeker.token)).promos.length;

  await money.rewardReferrer(joined.user.id);
  await money.rewardReferrer(joined.user.id);
  const after = (await t.api('GET', '/referrals/me', seeker.token)).promos;
  assert.equal(after.length, before + 1, 'rewarded exactly once');
  assert.match(after[0].code, /^THANKS-/);

  // Unknown or own codes are ignored; registration still works.
  const plain = await t.api('POST', '/register', null, { full_name: 'No Code', email: `plain.${rand()}@test.local`, password: PASSWORD, role: 'seeker', referral_code: 'ZZZZZZZZ' });
  assert.ok(plain.success);
  assert.equal((await t.api('GET', '/referrals/me', plain.token)).promos.length, 0);

  await t.api('PUT', '/admin/settings', main.token, { fee_percent: 0, referral_bonus: 0 });
  const quiet = await t.api('POST', '/register', null, { full_name: 'Quiet', email: `quiet.${rand()}@test.local`, password: PASSWORD, role: 'seeker', referral_code: mine.referral_code });
  assert.equal((await t.api('GET', '/referrals/me', quiet.token)).promos.length, 0, 'no gift while the bonus is zero');
  await t.api('PUT', '/admin/settings', main.token, { fee_percent: 0, referral_bonus: 50 });
});
