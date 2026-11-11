const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, tomorrow } = require('./helpers');

let t, admin, seeker, provider, cat, workId, listingId;

before(async () => {
  t = await startTestServer();
  admin = await t.makeAdmin();
  [seeker, provider] = await Promise.all([t.register('seeker'), t.register('provider')]);
  await Promise.all([seeker, provider].map((user) => t.verify(user)));
  cat = await t.category();

  workId = (await t.api('POST', '/services', seeker.token, { category_id: cat, title: 'Admin test work', description: 'd', location: 'Dhaka', budget: 100 })).service_id;
  listingId = (await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: 'Admin test listing', description: 'd', location: 'Dhaka', price: 50 })).id;
});
after(() => t.close());

test('dashboard stats and overview are admin only', async () => {
  assert.equal((await t.api('GET', '/admin/overview', seeker.token)).status, 403);

  const stats = await t.api('GET', '/admin/stats', admin.token);
  assert.ok(stats.stats.users >= 3);

  const overview = await t.api('GET', '/admin/overview', admin.token);
  assert.equal(overview.charts.signups.length, 14);
  assert.ok(overview.charts.signups.at(-1).value >= 3, 'today\'s signups are counted on the last bar');
  assert.ok(Array.isArray(overview.top_categories));
  assert.ok(overview.recent.users.length > 0);
});

test('user management', async () => {
  const users = await t.api('GET', '/admin/users?q=Test', admin.token);
  assert.ok(users.users.length >= 2);

  assert.ok((await t.api('PATCH', `/admin/users/${provider.id}`, admin.token, { nid_status: 'verified' })).success);
  assert.equal((await t.api('PATCH', `/admin/users/${admin.id}`, admin.token, { is_banned: true })).status, 400, 'cannot suspend yourself');
  assert.equal((await t.api('PATCH', `/admin/users/${admin.id}`, admin.token, { role: 'seeker' })).status, 400, 'cannot demote yourself');
});

test('category management protects categories in use', async () => {
  const name = `Cat ${Date.now()}`;
  const created = await t.api('POST', '/admin/categories', admin.token, { name, description: 'x' });
  assert.ok(created.success);
  assert.equal((await t.api('POST', '/admin/categories', admin.token, { name: 'Delivery' })).status, 409, 'duplicate name');

  const list = await t.api('GET', '/admin/categories', admin.token);
  const mine = list.categories.find((c) => c.name === name);
  assert.ok((await t.api('DELETE', `/admin/categories/${mine.id}`, admin.token)).success);

  const used = list.categories.find((c) => c.usage_count > 0);
  assert.equal((await t.api('DELETE', `/admin/categories/${used.id}`, admin.token)).status, 409);
});

test('moderation hides work and listings from the public', async () => {
  assert.ok((await t.api('PATCH', `/admin/work/${workId}`, admin.token, { is_hidden: true })).success);
  assert.ok(!(await t.api('GET', '/services', provider.token)).services.some((w) => w.id === workId));

  assert.ok((await t.api('PATCH', `/admin/listings/${listingId}`, admin.token, { is_hidden: true })).success);
  assert.ok(!(await t.api('GET', '/provider-services', seeker.token)).services.some((l) => l.id === listingId));
  assert.equal((await t.api('POST', '/bookings', seeker.token, { provider_service_id: listingId, preferred_date: tomorrow(), message: 'x' })).status, 404);

  await t.api('PATCH', `/admin/work/${workId}`, admin.token, { is_hidden: false });
  assert.ok((await t.api('GET', '/services', provider.token)).services.some((w) => w.id === workId), 'restored');
});

test('reports: submit, no duplicates, resolve', async () => {
  const report = { target_type: 'work', target_id: workId, reason: 'Looks like spam' };
  assert.ok((await t.api('POST', '/reports', provider.token, report)).success);
  assert.equal((await t.api('POST', '/reports', provider.token, report)).status, 409);
  assert.equal((await t.api('POST', '/reports', provider.token, { ...report, reason: 'no' })).status, 400);

  const open = await t.api('GET', '/admin/reports', admin.token);
  const mine = open.reports.find((r) => r.target_id === workId);
  assert.ok(mine);
  assert.ok((await t.api('PATCH', `/admin/reports/${mine.id}`, admin.token, { status: 'resolved' })).success);
});

test('admin payments list', async () => {
  const payments = await t.api('GET', '/admin/payments', admin.token);
  assert.ok(Array.isArray(payments.payments));
  assert.equal((await t.api('GET', '/admin/payments', provider.token)).status, 403);
});
