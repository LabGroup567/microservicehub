const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, PASSWORD } = require('./helpers');

let t, outbox;

before(async () => {
  t = await startTestServer();
  ({ outbox } = require('../mailer'));
});
after(() => t.close());

const tokenFrom = (message) => new URL(message.link).searchParams.get('token');
const lastMailTo = (email) => [...outbox].reverse().find((message) => message.to === email);

test('registering sends a verification email and verifying works once', async () => {
  const user = await t.register('seeker');
  assert.equal(user.email_verified, false);

  const mail = lastMailTo(user.email);
  assert.match(mail.subject, /verify/i);
  const token = tokenFrom(mail);

  assert.equal((await t.api('POST', '/verify-email', null, { token: 'bad'.repeat(20) })).status, 400);
  assert.ok((await t.api('POST', '/verify-email', null, { token })).success);
  assert.equal((await t.api('POST', '/verify-email', null, { token })).status, 400, 'links are single use');
  assert.equal((await t.api('GET', '/me', user.token)).user.email_verified, true);
});

test('resending verification is limited', async () => {
  const user = await t.register('seeker');
  assert.equal((await t.api('POST', '/me/resend-verification', user.token)).status, 429, 'one was just sent');

  await t.db.query("UPDATE auth_tokens SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE user_id = ?", [user.id]);
  assert.ok((await t.api('POST', '/me/resend-verification', user.token)).success);
});

test('forgot password gives the same answer for unknown emails and sends nothing', async () => {
  const before = outbox.length;
  const answer = await t.api('POST', '/forgot-password', null, { email: 'nobody-here@test.local' });

  assert.ok(answer.success);
  assert.equal(outbox.length, before);
  assert.equal((await t.api('POST', '/forgot-password', null, {})).status, 400);
});

test('full password reset flow', async () => {
  const user = await t.register('seeker');

  assert.ok((await t.api('POST', '/forgot-password', null, { email: user.email })).success);
  const mail = lastMailTo(user.email);
  assert.match(mail.subject, /reset/i);
  const token = tokenFrom(mail);

  assert.equal((await t.api('POST', '/reset-password', null, { token, password: 'short' })).status, 400, 'weak password refused');
  assert.ok((await t.api('POST', '/reset-password', null, { token, password: 'BrandNewPass99' })).success);

  assert.equal((await t.api('POST', '/login', null, { email: user.email, password: PASSWORD })).status, 401, 'old password stops working');
  assert.ok((await t.api('POST', '/login', null, { email: user.email, password: 'BrandNewPass99' })).token);
  assert.equal((await t.api('POST', '/reset-password', null, { token, password: 'AnotherPass123' })).status, 400, 'link cannot be reused');
  assert.match(lastMailTo(user.email).subject, /changed/i, 'owner is told the password changed');
});

test('expired reset links are refused', async () => {
  const user = await t.register('seeker');
  await t.api('POST', '/forgot-password', null, { email: user.email });
  const token = tokenFrom(lastMailTo(user.email));

  await t.db.query("UPDATE auth_tokens SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ? AND type = 'reset'", [user.id]);
  assert.equal((await t.api('POST', '/reset-password', null, { token, password: 'BrandNewPass99' })).status, 400);
});

test('only the newest reset link works', async () => {
  const user = await t.register('seeker');
  await t.api('POST', '/forgot-password', null, { email: user.email });
  const first = tokenFrom(lastMailTo(user.email));

  await t.db.query("UPDATE auth_tokens SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE user_id = ?", [user.id]);
  await t.api('POST', '/forgot-password', null, { email: user.email });
  const second = tokenFrom(lastMailTo(user.email));

  assert.notEqual(first, second);
  assert.equal((await t.api('POST', '/reset-password', null, { token: first, password: 'BrandNewPass99' })).status, 400);
  assert.ok((await t.api('POST', '/reset-password', null, { token: second, password: 'BrandNewPass99' })).success);
});
