const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, sleep, tomorrow } = require('./helpers');

let t, mail, sms, seeker, provider;

before(async () => {
  t = await startTestServer();
  mail = require('../mailer').outbox;
  sms = require('../sms').outbox;

  [seeker, provider] = await Promise.all([t.register('seeker'), t.register('provider')]);
  await Promise.all([seeker, provider].map((user) => t.verify(user)));
});
after(() => t.close());

const emailsTo = (user) => mail.filter((message) => message.to === user.email && !/verify/i.test(message.subject));

async function trigger() {
  // A booking request notifies the provider (type booking_new: email and SMS worthy).
  const cat = await t.category();
  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: `L${Math.random()}`, description: 'd', location: 'Dhaka', price: 10 });
  await t.api('POST', '/bookings', seeker.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'hi' });
  await sleep(150);
}

test('email goes only to verified addresses', async () => {
  await trigger();
  assert.equal(emailsTo(provider).length, 0, 'unverified email gets nothing');

  await t.db.query('UPDATE users SET email_verified = 1 WHERE id = ?', [provider.id]);
  await trigger();
  const received = emailsTo(provider);
  assert.equal(received.length, 1);
  assert.match(received[0].subject, /booking/i);
  assert.match(received[0].link, /\/provider-bookings$/);
});

test('users can switch email alerts off', async () => {
  assert.ok((await t.api('PUT', '/me/preferences', provider.token, { notify_email: false, notify_sms: false })).success);
  const before = emailsTo(provider).length;
  await trigger();
  assert.equal(emailsTo(provider).length, before);

  await t.api('PUT', '/me/preferences', provider.token, { notify_email: true, notify_sms: false });
});

test('SMS needs opt-in, a valid mobile number and only covers urgent types', async () => {
  const before = sms.length;
  await trigger();
  assert.equal(sms.length, before, 'off by default');

  await t.db.query("UPDATE users SET phone = '12345' WHERE id = ?", [provider.id]);
  assert.equal((await t.api('PUT', '/me/preferences', provider.token, { notify_email: true, notify_sms: true })).status, 400, 'needs a Bangladeshi mobile');

  await t.api('PUT', '/me', provider.token, { full_name: 'Provider', phone: '+8801712345678' });
  assert.ok((await t.api('PUT', '/me/preferences', provider.token, { notify_email: true, notify_sms: true })).success);

  await trigger();
  const texts = sms.filter((message) => message.to === '8801712345678');
  assert.equal(texts.length, 1);
  assert.match(texts[0].body, /^MicroServiceHub: /);

  // new-work alerts are never texted
  const cat = await t.category();
  const count = sms.length;
  await t.api('POST', '/services', seeker.token, { category_id: cat, title: 'Broadcast', description: 'd', location: 'Dhaka', budget: 50 });
  await sleep(150);
  assert.equal(sms.length, count);
});

test('the site reports whether SMS is available', async () => {
  const config = await t.api('GET', '/config');
  assert.equal(config.sms_available, true);
});
