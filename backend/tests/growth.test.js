const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer } = require('./helpers');

let t, admin, seeker, provider, other, categoryId;

before(async () => {
  t = await startTestServer();
  admin = await t.makeAdmin();
  [seeker, provider, other] = await Promise.all([t.register('seeker'), t.register('provider'), t.register('provider', 'other')]);
  await Promise.all([seeker, provider, other].map((user) => t.verify(user)));
  categoryId = await t.category();
});

after(async () => {
  await t.close();
});

const rand = () => crypto.randomBytes(3).toString('hex');
const post = (budget = 1000) =>
  t.api('POST', '/services', seeker.token, { category_id: categoryId, title: `Job ${rand()}`, description: 'Please help with this job.', location: 'Dhaka', budget });

// A tiny valid PNG, enough for the upload check.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function uploadPhoto(user) {
  const form = new FormData();
  form.set('image', new Blob([PNG], { type: 'image/png' }), 'work.png');
  const response = await fetch(`${t.base}/api/images`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: form });
  return (await response.json()).image_id;
}

test('offers: a provider can name a price, and hiring it sets the agreed price', async () => {
  const work = await post(1000);
  assert.ok(work.success, JSON.stringify(work));

  const bad = await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'I can do this', offer_price: -5 });
  assert.equal(bad.status, 400, 'a negative offer is refused');
  assert.equal((await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'I can do this', offer_price: 'abc' })).status, 400);

  const cheap = await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'I can do it for less', offer_price: 800 });
  assert.ok(cheap.success, JSON.stringify(cheap));
  const plain = await t.api('POST', '/applications', other.token, { service_id: work.service_id, message: 'At your budget is fine' });
  assert.ok(plain.success, 'an offer is optional');

  const detail = await t.api('GET', `/work/${work.service_id}`, seeker.token);
  const offers = Object.fromEntries(detail.applications.map((a) => [a.provider_id, a.offer_price]));
  assert.equal(Number(offers[provider.id]), 800);
  assert.equal(offers[other.id], null);

  const note = (await t.api('GET', '/notifications', seeker.token)).notifications.find((n) => n.type === 'application_new' && n.body.includes('offered BDT 800'));
  assert.ok(note, 'the seeker is told about the offered price');

  const mine = await t.api('GET', `/work/${work.service_id}`, provider.token);
  assert.equal(Number(mine.my_application.offer_price), 800);

  assert.ok((await t.api('PATCH', `/applications/${cheap.application.id}/accept`, seeker.token)).success);
  const after = await t.api('GET', `/work/${work.service_id}`, seeker.token);
  assert.equal(Number(after.work.budget), 800, 'payments will use the agreed price');
});

test('hiring someone with no offer keeps the original budget', async () => {
  const work = await post(1500);
  const applied = await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'Happy to help' });
  assert.ok((await t.api('PATCH', `/applications/${applied.application.id}/accept`, seeker.token)).success);
  assert.equal(Number((await t.api('GET', `/work/${work.service_id}`, seeker.token)).work.budget), 1500);
});

test('expiry: old open work leaves the list, and the seeker can renew it', async () => {
  const work = await post(900);
  const listed = () => t.api('GET', '/services', provider.token).then((r) => r.services.some((s) => s.id === work.service_id));
  assert.equal(await listed(), true);
  assert.ok((await t.api('GET', '/services', provider.token)).services.find((s) => s.id === work.service_id).expires_at);

  await t.db.query('UPDATE services SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [work.service_id]);
  assert.equal(await listed(), false, 'expired work is not offered to providers');

  const mine = (await t.api('GET', '/my-work', seeker.token)).services.find((s) => s.id === work.service_id);
  assert.equal(Number(mine.is_expired), 1);
  assert.equal(Number((await t.api('GET', `/work/${work.service_id}`, seeker.token)).work.is_expired), 1);

  assert.equal((await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'Too late?' })).status, 404, 'no applying to expired work');

  assert.equal((await t.api('PATCH', `/my-work/${work.service_id}/renew`, other.token)).status, 403, 'providers cannot renew');
  assert.equal((await t.api('PATCH', `/my-work/${work.service_id}/renew`, (await t.register('seeker', 'notmine')).token)).status, 404, 'only the owner renews');
  assert.ok((await t.api('PATCH', `/my-work/${work.service_id}/renew`, seeker.token)).success);

  assert.equal(await listed(), true, 'renewed work is back in the list');
  assert.equal(Number((await t.api('GET', '/my-work', seeker.token)).services.find((s) => s.id === work.service_id).is_expired), 0);
});

test('expired work cannot be hired until it is renewed', async () => {
  const work = await post(700);
  const applied = await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'I am free today' });
  await t.db.query('UPDATE services SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [work.service_id]);

  assert.equal((await t.api('PATCH', `/applications/${applied.application.id}/accept`, seeker.token)).status, 409);
  await t.api('PATCH', `/my-work/${work.service_id}/renew`, seeker.token);
  assert.ok((await t.api('PATCH', `/applications/${applied.application.id}/accept`, seeker.token)).success);
});

test('portfolio: providers show finished work; only they can change it', async () => {
  const empty = await t.api('GET', `/providers/${provider.id}/portfolio`, seeker.token);
  assert.deepEqual(empty.items, []);

  assert.equal((await t.api('POST', '/portfolio', seeker.token, { image_id: 1 })).status, 403, 'providers only');
  assert.equal((await t.api('POST', '/portfolio', provider.token, {})).status, 400);

  const imageId = await uploadPhoto(provider);
  assert.ok(imageId);
  assert.equal((await t.api('POST', '/portfolio', other.token, { image_id: imageId })).status, 400, 'someone else’s photo is refused');

  const added = await t.api('POST', '/portfolio', provider.token, { image_id: imageId, caption: 'Fixed a kitchen sink' });
  assert.ok(added.success);
  assert.equal((await t.api('POST', '/portfolio', provider.token, { image_id: imageId })).status, 409, 'the same photo twice');

  const seen = (await t.api('GET', `/providers/${provider.id}/portfolio`, seeker.token)).items;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].caption, 'Fixed a kitchen sink');

  assert.equal((await t.api('PATCH', `/portfolio/${added.id}`, other.token, { caption: 'mine now' })).status, 404);
  assert.ok((await t.api('PATCH', `/portfolio/${added.id}`, provider.token, { caption: 'New caption' })).success);
  assert.equal((await t.api('DELETE', `/portfolio/${added.id}`, other.token)).status, 404, 'cannot remove another provider’s photo');

  assert.ok((await t.api('DELETE', `/portfolio/${added.id}`, provider.token)).success);
  assert.equal((await t.api('GET', `/providers/${provider.id}/portfolio`, seeker.token)).items.length, 0);
  const [gone] = await t.db.query('SELECT id FROM images WHERE id = ?', [imageId]);
  assert.equal(gone.length, 0, 'the unused photo is deleted too');
});

test('portfolio holds at most 12 photos', async () => {
  const filler = await t.register('provider', 'filler');
  await t.verify(filler);
  for (let i = 0; i < 12; i += 1) {
    const [made] = await t.db.query('INSERT INTO images (owner_id, mime, data) VALUES (?, ?, ?)', [filler.id, 'image/png', PNG]);
    assert.ok((await t.api('POST', '/portfolio', filler.token, { image_id: made.insertId })).success);
  }
  const [last] = await t.db.query('INSERT INTO images (owner_id, mime, data) VALUES (?, ?, ?)', [filler.id, 'image/png', PNG]);
  assert.equal((await t.api('POST', '/portfolio', filler.token, { image_id: last.insertId })).status, 400);
});

test('admin report: totals per service type, and a safe CSV download', async () => {
  const name = `Report ${rand()}`;
  const [made] = await t.db.query('INSERT INTO categories (name) VALUES (?)', [name]);
  const one = await t.api('POST', '/services', seeker.token, { category_id: made.insertId, title: `R ${rand()}`, description: 'Please help with this job.', location: 'Dhaka', budget: 400 });
  const two = await t.api('POST', '/services', seeker.token, { category_id: made.insertId, title: `R ${rand()}`, description: 'Please help with this job.', location: 'Dhaka', budget: 600 });
  await t.db.query("UPDATE services SET status = 'completed' WHERE id = ?", [one.service_id]);
  await t.db.query("UPDATE services SET status = 'cancelled' WHERE id = ?", [two.service_id]);

  assert.equal((await t.api('GET', '/admin/report', seeker.token)).status, 403, 'admins only');

  const report = await t.api('GET', '/admin/report?days=30', admin.token);
  assert.equal(report.days, 30);
  const row = report.categories.find((c) => c.name === name);
  assert.equal(row.posted, 2);
  assert.equal(row.completed, 1);
  assert.equal(row.cancelled, 1);
  assert.equal(row.avg_budget, 500);
  assert.equal(row.completed_value, 400);
  assert.ok(report.totals.posted >= 2);

  assert.equal((await t.api('GET', '/admin/report?days=bogus', admin.token)).days, 30, 'an unknown range falls back to 30 days');
  assert.equal((await t.api('GET', '/admin/report?days=0', admin.token)).days, 0, 'all time');

  const evil = `=HYPERLINK("http://x")${rand()}`;
  await t.db.query('INSERT INTO categories (name) VALUES (?)', [evil]);
  const response = await fetch(`${t.base}/api/admin/report.csv?days=0`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="microservicehub-report-all-time\.csv"/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM so Excel reads UTF-8');
  const csv = bytes.toString('utf8').replace(/^﻿/, '');
  assert.ok(csv.startsWith('Service type,Work posted'));
  assert.ok(csv.includes(name));
  assert.ok(csv.includes(`'=HYPERLINK`), 'a formula-looking name is made harmless');
  assert.equal(csv.includes(`\n=HYPERLINK`), false);

  assert.equal((await fetch(`${t.base}/api/admin/report.csv`, { headers: { Authorization: `Bearer ${seeker.token}` } })).status, 403);
});

test('profile photo: set, show to others, replace and remove', async () => {
  assert.equal((await t.api('GET', '/me', provider.token)).user.avatar_image_id, null, 'no photo to start with');
  assert.equal((await t.api('PUT', '/me/avatar', provider.token, {})).status, 400, 'a photo must be chosen');

  const first = await uploadPhoto(provider);
  assert.equal((await t.api('PUT', '/me/avatar', other.token, { image_id: first })).status, 400, 'someone else’s photo is refused');

  const set = await t.api('PUT', '/me/avatar', provider.token, { image_id: first });
  assert.ok(set.success, JSON.stringify(set));
  assert.equal(set.user.avatar_image_id, first);
  assert.equal((await t.api('GET', '/me', provider.token)).user.avatar_image_id, first, 'it is part of the signed-in user');

  // Others see it on the places that show a person.
  assert.equal((await t.api('GET', `/providers/${provider.id}/reviews`, seeker.token)).provider.avatar_image_id, first);
  const work = await post(500);
  await t.api('POST', '/applications', provider.token, { service_id: work.service_id, message: 'I can do it today' });
  const detail = await t.api('GET', `/work/${work.service_id}`, seeker.token);
  assert.equal(detail.applications[0].provider_avatar, first);

  // A new photo replaces it, and the old one is deleted because nothing uses it any more.
  const second = await uploadPhoto(provider);
  assert.ok((await t.api('PUT', '/me/avatar', provider.token, { image_id: second })).success);
  const [oldGone] = await t.db.query('SELECT id FROM images WHERE id = ?', [first]);
  assert.equal(oldGone.length, 0);

  const removed = await t.api('PUT', '/me/avatar', provider.token, { image_id: null });
  assert.ok(removed.success);
  assert.equal(removed.user.avatar_image_id, null);
  const [secondGone] = await t.db.query('SELECT id FROM images WHERE id = ?', [second]);
  assert.equal(secondGone.length, 0);
});

test('public numbers for the home page: no login, real counts', async () => {
  const stats = (await t.api('GET', '/public-stats')).stats;
  assert.ok(stats, 'works without signing in');
  for (const key of ['open_work', 'service_types', 'verified_providers', 'completed_jobs']) {
    assert.equal(typeof stats[key], 'number', key);
    assert.ok(stats[key] >= 0);
  }
  assert.ok(stats.service_types >= 45, 'counts the service types');
  assert.ok(stats.verified_providers >= 3, 'the verified test providers are counted');
  assert.ok(stats.open_work >= 1);
});

test('available now: opt-in, approximate, fresh, and only seekers can look', async () => {
  const near = await t.register('provider', 'nearby');
  const far = await t.register('provider', 'faraway');
  await Promise.all([near, far].map((user) => t.verify(user)));
  const lister = await t.api('POST', '/my-listings', near.token, { category_id: categoryId, title: `Near ${rand()}`, description: 'd', location: 'Dhaka', price: 300 });
  assert.ok(lister.success);

  // Nobody is on the map until a provider switches it on.
  const before = await t.api('GET', '/nearby-providers', seeker.token);
  assert.ok(!before.providers.some((p) => p.id === near.id));
  assert.equal((await t.api('GET', '/presence/me', near.token)).on, false);

  assert.equal((await t.api('PUT', '/presence', seeker.token, { lat: 23.81, lng: 90.41 })).status, 403, 'providers only');
  assert.equal((await t.api('PUT', '/presence', near.token, { lat: 'abc', lng: 90 })).status, 400);
  assert.equal((await t.api('PUT', '/presence', near.token, { lat: 123, lng: 90 })).status, 400);

  assert.ok((await t.api('PUT', '/presence', near.token, { lat: 23.81034, lng: 90.41257 })).success);
  assert.ok((await t.api('PUT', '/presence', far.token, { lat: 22.3569, lng: 91.7832 })).success); // Chattogram
  assert.equal((await t.api('GET', '/presence/me', near.token)).on, true);

  // The stored spot is rounded, never the exact one.
  const [[stored]] = await t.db.query('SELECT lat, lng FROM provider_presence WHERE provider_id = ?', [near.id]);
  assert.notEqual(Number(stored.lat), 23.81034);
  assert.ok(Math.abs(Number(stored.lat) - 23.81034) <= 0.0026 && Math.abs(Number(stored.lng) - 90.41257) <= 0.0026);

  const list = await t.api('GET', '/nearby-providers?lat=23.8103&lng=90.4125&radius_km=20', seeker.token);
  const row = list.providers.find((p) => p.id === near.id);
  assert.ok(row, 'a nearby provider is listed');
  assert.ok(row.distance_km < 1);
  assert.equal(row.minutes_ago, 0);
  assert.equal(row.live, true, 'just updated, so shown as live');
  assert.ok(row.categories.length >= 1);
  assert.ok(!list.providers.some((p) => p.id === far.id), 'Chattogram is not within 20 km of Dhaka');
  assert.equal(Object.hasOwn(row, 'email'), false, 'no contact details are leaked');

  const wide = await t.api('GET', '/nearby-providers', seeker.token); // no position given: everyone who is on the map
  assert.ok(wide.providers.some((p) => p.id === far.id));

  const byCategory = await t.api('GET', `/nearby-providers?category_id=${categoryId}`, seeker.token);
  assert.ok(byCategory.providers.some((p) => p.id === near.id));
  assert.ok(!byCategory.providers.some((p) => p.id === far.id), 'far has no listing in this category');

  assert.equal((await t.api('GET', '/nearby-providers', near.token)).status, 403, 'providers cannot browse other providers');
  assert.ok((await t.api('GET', '/nearby-providers', admin.token)).success, 'admins can');

  // After the app closes (no update for 15 minutes) the provider stays as "last seen" for three hours.
  await t.db.query('UPDATE provider_presence SET updated_at = DATE_SUB(NOW(), INTERVAL 40 MINUTE) WHERE provider_id = ?', [near.id]);
  const recent = (await t.api('GET', '/nearby-providers', seeker.token)).providers.find((p) => p.id === near.id);
  assert.ok(recent, 'still on the map as last seen');
  assert.equal(recent.live, false);
  assert.ok(recent.minutes_ago >= 40);
  const meRecent = await t.api('GET', '/presence/me', near.token);
  assert.equal(meRecent.fresh, false);
  assert.equal(meRecent.visible, true);

  // Live providers come first when nobody shares a position.
  await t.api('PUT', '/presence', far.token, { lat: 22.3569, lng: 91.7832 });
  const order = (await t.api('GET', '/nearby-providers', seeker.token)).providers.map((p) => p.id);
  assert.ok(order.indexOf(far.id) < order.indexOf(near.id), 'live before last seen');

  // After three hours the spot is no longer shown, and very old spots are deleted.
  await t.db.query('UPDATE provider_presence SET updated_at = DATE_SUB(NOW(), INTERVAL 4 HOUR) WHERE provider_id = ?', [near.id]);
  assert.ok(!(await t.api('GET', '/nearby-providers', seeker.token)).providers.some((p) => p.id === near.id));
  assert.equal((await t.api('GET', '/presence/me', near.token)).visible, false);
  await t.db.query('UPDATE provider_presence SET updated_at = DATE_SUB(NOW(), INTERVAL 13 HOUR) WHERE provider_id = ?', [near.id]);
  await t.api('GET', '/nearby-providers', seeker.token);
  const [old] = await t.db.query('SELECT 1 FROM provider_presence WHERE provider_id = ?', [near.id]);
  assert.equal(old.length, 0, 'a spot older than 12 hours is deleted');

  // Turning it off removes the row.
  assert.ok((await t.api('DELETE', '/presence', far.token)).success);
  assert.equal((await t.api('GET', '/presence/me', far.token)).on, false);
  assert.ok(!(await t.api('GET', '/nearby-providers?radius_km=200', seeker.token)).providers.some((p) => p.id === far.id));
});

test('explore: every service type with counts, what is popular, and my bookings', async () => {
  assert.equal((await t.api('GET', '/explore')).status, 401, 'login needed');

  const owner = await t.register('provider', 'exploreowner');
  await t.verify(owner);
  const listing = await t.api('POST', '/my-listings', owner.token, { category_id: categoryId, title: `Explore ${rand()}`, description: 'd', location: 'Dhaka', price: 450 });
  assert.ok(listing.success);

  const booker = await t.register('seeker', 'booker');
  await t.verify(booker);
  const before = await t.api('GET', '/explore', booker.token);
  assert.equal(before.my_active_bookings, 0);

  assert.ok((await t.api('POST', '/bookings', booker.token, { provider_service_id: listing.id, preferred_date: require('./helpers').tomorrow(), message: 'please come' })).success);

  const data = await t.api('GET', '/explore', booker.token);
  assert.ok(data.success);
  assert.equal(data.my_active_bookings, 1, 'the pending booking counts');
  assert.ok(data.categories.length >= 45);
  const row = data.categories.find((c) => c.id === categoryId);
  assert.ok(row.listings >= 1, 'the listing is counted');
  assert.equal(typeof row.open_work, 'number');

  // Popular is ordered by recent bookings, and our freshly booked listing is in it.
  const counts = data.popular.map((p) => p.recent_bookings);
  assert.deepEqual(counts, [...counts].sort((x, y) => y - x), 'most booked first');
  assert.ok(data.popular.length >= 1 && data.popular[0].recent_bookings >= 1, "the top listing has bookings");
  assert.equal(Object.hasOwn(data.popular[0], 'email'), false);

  // Providers and admins can open it too, but only seekers have bookings to count.
  assert.equal((await t.api('GET', '/explore', owner.token)).my_active_bookings, 0);
  assert.ok((await t.api('GET', '/explore', admin.token)).success);
});
