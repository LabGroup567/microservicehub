const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

let t, seeker, provider, provider2, outsider, cat, workId;

before(async () => {
  t = await startTestServer();
  [seeker, provider, provider2, outsider] = await Promise.all([
    t.register('seeker'),
    t.register('provider'),
    t.register('provider', 'provider2'),
    t.register('seeker', 'outsider'),
  ]);
  cat = await t.category();
});
after(() => t.close());

const work = () => ({ category_id: cat, title: 'Fix sink', description: 'Leaking', location: 'Mirpur, Dhaka', budget: 800 });

test('posting work requires a verified NID', async () => {
  const blocked = await t.api('POST', '/services', seeker.token, work());
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, 'kyc_required');

  await Promise.all([seeker, provider, provider2, outsider].map((user) => t.verify(user)));
});

test('work validation and posting', async () => {
  assert.equal((await t.api('POST', '/services', seeker.token, { ...work(), budget: -1 })).status, 400);
  assert.equal((await t.api('POST', '/services', seeker.token, { ...work(), title: '' })).status, 400);

  const posted = await t.api('POST', '/services', seeker.token, work());
  assert.ok(posted.success);
  assert.ok(posted.providers_notified >= 3, 'every provider is notified');
  workId = posted.service_id;
});

test('providers are notified of new work', async () => {
  const notes = await t.api('GET', '/notifications', provider.token);
  assert.ok(notes.notifications.some((n) => n.type === 'work_new'));
});

test('providers can filter open work', async () => {
  assert.ok((await t.api('GET', '/services?q=sink&min_budget=500&max_budget=900', provider.token)).services.some((w) => w.id === workId));
  assert.equal((await t.api('GET', '/services?q=sink&min_budget=1000', provider.token)).services.length, 0);
  assert.ok((await t.api('GET', '/services?location=mirpur', provider.token)).services.some((w) => w.id === workId));
});

test('applications: validation, duplicates and withdrawal', async () => {
  assert.equal((await t.api('POST', '/applications', provider.token, { service_id: workId, message: 'hi' })).status, 400);

  const applied = await t.api('POST', '/applications', provider.token, { service_id: workId, message: 'I can fix it today' });
  assert.ok(applied.success);
  assert.equal((await t.api('POST', '/applications', provider.token, { service_id: workId, message: 'again please' })).status, 409);

  const second = await t.api('POST', '/applications', provider2.token, { service_id: workId, message: 'I am cheaper' });
  assert.equal((await t.api('DELETE', `/applications/${second.application.id}`, provider.token)).status, 404, 'cannot withdraw another provider\'s application');
  assert.ok((await t.api('DELETE', `/applications/${second.application.id}`, provider2.token)).success);
  assert.ok((await t.api('POST', '/applications', provider2.token, { service_id: workId, message: 'Changed my mind' })).success, 'can re-apply');
});

test('only the owner can manage the work', async () => {
  const detail = await t.api('GET', `/work/${workId}`, seeker.token);
  assert.equal(detail.applications.length, 2);

  const body = { category_id: cat, title: 'h', description: 'h', location: 'h', budget: 1 };
  assert.equal((await t.api('PUT', `/my-work/${workId}`, outsider.token, body)).status, 404);

  const appId = detail.applications[0].id;
  assert.equal((await t.api('PATCH', `/applications/${appId}/accept`, outsider.token)).status, 404);
});

test('accepting hires one provider and declines the rest', async () => {
  const detail = await t.api('GET', `/work/${workId}`, seeker.token);
  const winner = detail.applications.find((a) => a.provider_id === provider.id);

  assert.ok((await t.api('PATCH', `/applications/${winner.id}/accept`, seeker.token)).success);

  const after = await t.api('GET', `/work/${workId}`, seeker.token);
  assert.equal(after.work.status, 'assigned');
  assert.equal(after.work.assigned_provider_id, provider.id);
  assert.equal(after.applications.find((a) => a.provider_id === provider2.id).status, 'rejected');
  assert.equal((await t.api('DELETE', `/applications/${winner.id}`, provider.token)).status, 404, 'accepted application stays');
});

test('progress flow: start, complete, review', async () => {
  assert.equal((await t.api('PATCH', `/work/${workId}/start`, provider2.token)).status, 404, 'only the hired provider');
  assert.equal((await t.api('PATCH', `/work/${workId}/complete`, seeker.token)).status, 409, 'cannot complete before starting');
  assert.ok((await t.api('PATCH', `/work/${workId}/start`, provider.token)).success);
  assert.equal((await t.api('PATCH', `/work/${workId}/complete`, provider.token)).status, 403, 'provider cannot confirm completion');
  assert.equal((await t.api('POST', '/reviews', seeker.token, { service_id: workId, rating: 5 })).status, 409, 'no review before completion');
  assert.ok((await t.api('PATCH', `/work/${workId}/complete`, seeker.token)).success);

  assert.equal((await t.api('POST', '/reviews', seeker.token, { service_id: workId, rating: 9 })).status, 400);
  assert.ok((await t.api('POST', '/reviews', seeker.token, { service_id: workId, rating: 5, comment: 'Great' })).success);
  assert.equal((await t.api('POST', '/reviews', seeker.token, { service_id: workId, rating: 4 })).status, 409, 'one review per work');

  const profile = await t.api('GET', `/providers/${provider.id}/reviews`, seeker.token);
  assert.equal(Number(profile.provider.avg_rating), 5);
  assert.equal(profile.reviews.length, 1);
});

test('cancelling and withdrawing', async () => {
  const posted = await t.api('POST', '/services', seeker.token, work());
  const id = posted.service_id;
  const applied = await t.api('POST', '/applications', provider.token, { service_id: id, message: 'Ready to start' });
  await t.api('PATCH', `/applications/${applied.application.id}/accept`, seeker.token);

  assert.ok((await t.api('PATCH', `/work/${id}/withdraw`, provider.token)).success);
  assert.equal((await t.api('GET', `/work/${id}`, seeker.token)).work.status, 'open', 'work reopens');

  assert.ok((await t.api('PATCH', `/my-work/${id}/cancel`, seeker.token)).success);
  assert.equal((await t.api('PATCH', `/my-work/${id}/cancel`, seeker.token)).status, 409);
});
