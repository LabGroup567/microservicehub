const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer, tomorrow } = require('./helpers');

let t, admin, seeker, provider, stranger, categoryId;

before(async () => {
  t = await startTestServer();
  admin = await t.makeAdmin();
  [seeker, provider, stranger] = await Promise.all([t.register('seeker'), t.register('provider'), t.register('seeker', 'stranger')]);
  await Promise.all([seeker, provider, stranger].map((user) => t.verify(user)));
  categoryId = await t.category();
});

after(async () => {
  await t.close();
});

const rand = () => crypto.randomBytes(3).toString('hex');

test('contact form: validates, stores and alerts the admins', async () => {
  const mark = rand();
  const send = (body) => t.api('POST', '/contact', null, body);

  assert.equal((await send({ name: '', email: 'a@b.co', message: 'Hello there friend' })).status, 400);
  assert.equal((await send({ name: 'Rina', email: 'not-an-email', message: 'Hello there friend' })).status, 400);
  assert.equal((await send({ name: 'Rina', email: 'rina@test.local', message: 'short' })).status, 400);

  const sent = await send({ name: 'Rina', email: 'RINA@test.local', message: `How do I get verified? ${mark}` });
  assert.equal(sent.status, 201);

  assert.equal((await t.api('GET', '/admin/contact', seeker.token)).status, 403, 'only admins read the inbox');
  const inbox = (await t.api('GET', '/admin/contact', admin.token)).messages;
  const row = inbox.find((m) => m.message.includes(mark));
  assert.ok(row);
  assert.equal(row.email, 'rina@test.local');
  assert.equal(row.handled, 0);

  assert.equal((await t.api('PATCH', `/admin/contact/${row.id}/handled`, seeker.token, { handled: true })).status, 403);
  assert.ok((await t.api('PATCH', `/admin/contact/${row.id}/handled`, admin.token, { handled: true })).success);
  assert.equal((await t.api('GET', '/admin/contact', admin.token)).messages.find((m) => m.id === row.id).handled, 1);

  const note = (await t.api('GET', '/notifications', admin.token)).notifications.find((n) => n.type === 'contact');
  assert.ok(note, 'admins get a notification');
});

test('saved providers: save, list, mark in search results and remove', async () => {
  assert.equal((await t.api('PUT', `/favorites/${provider.id}`, provider.token)).status, 403, 'seekers only');
  assert.equal((await t.api('PUT', `/favorites/${stranger.id}`, seeker.token)).status, 404, 'only providers can be saved');
  assert.equal((await t.api('PUT', '/favorites/abc', seeker.token)).status, 400);

  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: categoryId, title: `Fav ${rand()}`, description: 'd', location: 'Dhaka', price: 300 });
  assert.ok(listing.success);

  const before = await t.api('GET', '/provider-services', seeker.token);
  assert.equal(Number(before.services.find((s) => s.id === listing.id).is_favorite), 0);

  assert.ok((await t.api('PUT', `/favorites/${provider.id}`, seeker.token)).success);
  assert.ok((await t.api('PUT', `/favorites/${provider.id}`, seeker.token)).success, 'saving twice is harmless');

  const saved = (await t.api('GET', '/favorites', seeker.token)).providers;
  assert.equal(saved.filter((p) => p.id === provider.id).length, 1);
  assert.equal((await t.api('GET', '/favorites', stranger.token)).providers.length, 0, 'lists are private');

  const after = await t.api('GET', '/provider-services', seeker.token);
  assert.equal(Number(after.services.find((s) => s.id === listing.id).is_favorite), 1);
  assert.equal(Number((await t.api('GET', '/provider-services', stranger.token)).services.find((s) => s.id === listing.id).is_favorite), 0);

  assert.ok((await t.api('DELETE', `/favorites/${provider.id}`, seeker.token)).success);
  assert.equal((await t.api('GET', '/favorites', seeker.token)).providers.length, 0);
});

test('earnings: totals, escrow, payouts and six months of history', async () => {
  const earner = await t.register('provider', 'earner');
  await t.verify(earner);

  const empty = await t.api('GET', '/provider/earnings', earner.token);
  assert.deepEqual(empty.totals, { received: 0, to_confirm: 0, in_escrow: 0, payout_due: 0, paid_out: 0, paid_count: 0 });
  assert.equal(empty.months.length, 6);
  assert.ok(empty.months.every((m) => m.total === 0));
  assert.equal((await t.api('GET', '/provider/earnings', seeker.token)).status, 403, 'providers only');

  const listing = await t.api('POST', '/my-listings', earner.token, { category_id: categoryId, title: `Earn ${rand()}`, description: 'd', location: 'Dhaka', price: 100 });
  const booking = await t.api('POST', '/bookings', seeker.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'please come' });

  const add = (amount, fields) =>
    t.db.query(
      `INSERT INTO payments (booking_id, payer_id, payee_id, amount, method, status, gateway, escrow_status, payout_status, trx_id, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [booking.booking_id, seeker.id, earner.id, amount, fields.method || 'cash', fields.status, fields.gateway || null, fields.escrow || 'none', fields.payout || 'none', `E${rand()}${rand()}`.toUpperCase()]
    );

  await add(500, { status: 'paid' });                                                 // cash received
  await add(300, { status: 'pending' });                                              // waiting for the provider to confirm
  await add(1000, { status: 'paid', gateway: 'bkash', method: 'bkash', escrow: 'held' });          // held in escrow
  await add(200, { status: 'paid', gateway: 'bkash', method: 'bkash', escrow: 'released', payout: 'due' });
  await add(400, { status: 'paid', gateway: 'bkash', method: 'bkash', escrow: 'released', payout: 'paid_out' });
  await add(999, { status: 'refunded', gateway: 'bkash', method: 'bkash', escrow: 'refunded' }); // never counted

  const result = await t.api('GET', '/provider/earnings', earner.token);
  assert.equal(result.totals.received, 1100, 'cash 500 + released 200 + paid out 400');
  assert.equal(result.totals.to_confirm, 300);
  assert.equal(result.totals.in_escrow, 1000);
  assert.equal(result.totals.payout_due, 200);
  assert.equal(result.totals.paid_out, 400);
  assert.equal(result.months[5].total, 1100, 'this month is the last bar');
  assert.ok(result.recent.length >= 5 && result.recent.every((p) => p.payer_name));
  assert.equal(result.recent.some((p) => p.amount === 999 && p.status !== 'refunded'), false);

  // Another provider never sees these numbers.
  assert.equal((await t.api('GET', '/provider/earnings', provider.token)).totals.received, 0);
});

test('reviews are written, with no star rating needed', async () => {
  const worker = await t.register('provider', 'reviewed');
  await t.verify(worker);
  const listing = await t.api('POST', '/my-listings', worker.token, { category_id: categoryId, title: `Review ${rand()}`, description: 'd', location: 'Dhaka', price: 200 });
  const booked = await t.api('POST', '/bookings', seeker.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'please come' });
  const review = (body) => t.api('POST', '/reviews', seeker.token, { booking_id: booked.booking_id, ...body });

  assert.equal((await review({ comment: 'Very polite and on time.' })).status, 409, 'only after the job is completed');

  await t.api('PATCH', `/bookings/${booked.booking_id}/status`, worker.token, { status: 'accepted' });
  await t.api('PATCH', `/bookings/${booked.booking_id}/status`, worker.token, { status: 'in_progress' });
  await t.api('PATCH', `/bookings/${booked.booking_id}/status`, seeker.token, { status: 'completed' });

  assert.equal((await review({})).status, 400, 'a review needs some words');
  assert.equal((await review({ comment: 'ok' })).status, 400, 'too short');
  assert.equal((await review({ comment: 'fine', rating: 9 })).status, 400, 'a rating, if sent, must be 1 to 5');

  const done = await review({ comment: 'Very polite and on time.' });
  assert.ok(done.success, JSON.stringify(done));
  assert.equal((await review({ comment: 'Writing it again.' })).status, 409, 'one review per job');

  const profile = await t.api('GET', `/providers/${worker.id}/reviews`, seeker.token);
  assert.equal(profile.provider.review_count, 1);
  assert.equal(profile.reviews[0].comment, 'Very polite and on time.');
  assert.equal(profile.reviews[0].rating, null);

  const note = (await t.api('GET', '/notifications', worker.token)).notifications.find((n) => n.type === 'review_new');
  assert.equal(note.title, 'New review');
});

test('more service types are added once and stay removable', async () => {
  const { categories } = await t.api('GET', '/categories');
  const names = categories.map((c) => c.name);
  for (const name of ['Tutoring', 'Plumbing', 'Photography', 'Health Care', 'Security Guard', 'Mobile Repair', 'Interior Design']) assert.ok(names.includes(name), `${name} exists`);
  assert.ok(categories.length >= 45);

  // An admin removes a category; a restart must not bring it back.
  const temp = `Temp ${rand()}`;
  await t.db.query('INSERT INTO categories (name) VALUES (?)', [temp]);
  const created = (await t.api('GET', '/categories')).categories.find((c) => c.name === temp);
  assert.ok((await t.api('DELETE', `/admin/categories/${created.id}`, admin.token)).success);

  await t.db.query("DELETE FROM categories WHERE name = 'Tailoring'");
  await require('../migrate').ensureSchema();
  const after = (await t.api('GET', '/categories')).categories.map((c) => c.name);
  assert.ok(!after.includes(temp));
  assert.ok(!after.includes('Tailoring'), 'a removed starter category stays removed');
  await t.db.query("INSERT IGNORE INTO categories (name, description) VALUES ('Tailoring', 'Stitching and alterations')");
});
