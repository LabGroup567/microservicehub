const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, PASSWORD } = require('./helpers');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.close());

test('register returns a token and the new user', async () => {
  const user = await t.register('seeker');
  assert.ok(user.token);
  assert.equal(user.role, 'seeker');
  assert.equal(user.kyc_status, 'none');
});

test('registration validates input', async () => {
  const email = `dup.${Date.now()}@test.local`;
  const body = { full_name: 'Dup User', email, password: PASSWORD, role: 'seeker' };

  assert.equal((await t.api('POST', '/register', null, body)).status, 201);
  assert.equal((await t.api('POST', '/register', null, body)).status, 409, 'duplicate email');
  assert.equal((await t.api('POST', '/register', null, { ...body, email: 'x@test.local', password: 'short' })).status, 400);
  assert.equal((await t.api('POST', '/register', null, { ...body, email: 'bad-email' })).status, 400);
  assert.equal((await t.api('POST', '/register', null, { ...body, email: 'r@test.local', role: 'admin' })).status, 400, 'cannot self-register as admin');
});

test('login works and rejects wrong passwords', async () => {
  const user = await t.register('seeker');

  assert.ok((await t.api('POST', '/login', null, { email: user.email, password: PASSWORD })).token);
  assert.equal((await t.api('POST', '/login', null, { email: user.email, password: 'wrongwrong1' })).status, 401);
  assert.equal((await t.api('POST', '/login', null, { email: 'nobody@test.local', password: PASSWORD })).status, 401);
});

test('protected routes need a valid token', async () => {
  assert.equal((await t.api('GET', '/my-work')).status, 401);
  assert.equal((await t.api('GET', '/my-work', 'garbage.token.value')).status, 401);
});

test('roles are enforced on the server', async () => {
  const seeker = await t.register('seeker');
  const provider = await t.register('provider');

  assert.equal((await t.api('POST', '/services', provider.token, {})).status, 403, 'provider cannot post work');
  assert.equal((await t.api('POST', '/applications', seeker.token, { service_id: 1, message: 'hello' })).status, 403);
  assert.equal((await t.api('GET', '/admin/stats', seeker.token)).status, 403);
  assert.equal((await t.api('GET', '/my-listings', seeker.token)).status, 403);
});

test('suspended accounts are locked out immediately', async () => {
  const user = await t.register('seeker');
  const admin = await t.makeAdmin();

  assert.equal((await t.api('GET', '/me', user.token)).status, 200);
  await t.api('PATCH', `/admin/users/${user.id}`, admin.token, { is_banned: true });
  assert.equal((await t.api('GET', '/me', user.token)).status, 403, 'existing token stops working');
  assert.equal((await t.api('POST', '/login', null, { email: user.email, password: PASSWORD })).status, 403);
});

test('profile and password changes', async () => {
  const user = await t.register('seeker');

  const saved = await t.api('PUT', '/me', user.token, { full_name: 'New Name', phone: '01700000000', bio: 'Hello' });
  assert.ok(saved.success);

  assert.equal((await t.api('PUT', '/me/password', user.token, { current_password: 'nope', new_password: 'Another1234' })).status, 400);
  assert.ok((await t.api('PUT', '/me/password', user.token, { current_password: PASSWORD, new_password: 'Another1234' })).success);
  assert.ok((await t.api('POST', '/login', null, { email: user.email, password: 'Another1234' })).token);
});

test('role can be switched only before any activity', async () => {
  const user = await t.register('seeker');
  const switched = await t.api('PUT', '/me/role', user.token, { role: 'provider' });
  assert.equal(switched.user.role, 'provider');

  await t.verify(user);
  const cat = await t.category();
  await t.api('POST', '/my-listings', switched.token, { category_id: cat, title: 'x', description: 'd', location: 'Dhaka', price: 5 });
  assert.equal((await t.api('PUT', '/me/role', switched.token, { role: 'seeker' })).status, 409);
});

test('public config and unknown endpoints', async () => {
  const config = await t.api('GET', '/config');
  assert.ok(config.success);
  assert.equal((await t.api('GET', '/does-not-exist')).status, 404);
});
