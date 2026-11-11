const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { startTestServer, sleep, tomorrow } = require('./helpers');

let t, admin, seeker, provider, otherProvider, quietProvider, stranger;
let sSeeker, sProvider, sAdmin, sStranger;
const pushed = [];
const realSend = webpush.sendNotification;

const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const events = [];
  socket.on(event, (data) => events.push(data));
  return events;
};

const subscribe = (user, id) =>
  t.api('POST', '/push/subscribe', user.token, {
    subscription: { endpoint: `https://push.test/${id}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } },
  });

before(async () => {
  // Capture what would go to phones instead of calling real push servers.
  webpush.sendNotification = async (subscription, body) => {
    pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
  };

  t = await startTestServer();
  admin = await t.makeAdmin();
  [seeker, provider, otherProvider, quietProvider, stranger] = await Promise.all([
    t.register('seeker'), t.register('provider'), t.register('provider', 'second'), t.register('provider', 'quiet'), t.register('seeker', 'stranger'),
  ]);
  await Promise.all([seeker, provider, otherProvider, quietProvider, stranger].map((user) => t.verify(user)));

  const cat = await t.category();
  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: 'Alerts listing', description: 'd', location: 'Dhaka', price: 100 });
  await t.api('POST', '/bookings', seeker.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'hi' });

  [sSeeker, sProvider, sAdmin, sStranger] = await Promise.all([seeker, provider, admin, stranger].map((user) => t.connectSocket(user.token)));
});

after(async () => {
  webpush.sendNotification = realSend;
  [sSeeker, sProvider, sAdmin, sStranger].forEach((socket) => socket.close());
  await t.close();
});

test('phone alerts are switched on and the keys survive a restart', async () => {
  const key = await t.api('GET', '/push/key');
  assert.equal(key.enabled, true);
  assert.ok(key.public_key.length > 40);

  // A host with a temporary disk and no key settings: the pair must come from the database.
  const env = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  const push = require('../push');
  try {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    await t.db.query("DELETE FROM settings WHERE name IN ('vapid_public', 'vapid_private')");
    await push.initPush(); // first start: creates and saves a pair
    const first = process.env.VAPID_PUBLIC_KEY;
    const [rows] = await t.db.query("SELECT name, value FROM settings WHERE name IN ('vapid_public', 'vapid_private')");
    const saved = Object.fromEntries(rows.map((row) => [row.name, row.value]));
    assert.equal(saved.vapid_public, first, 'the pair is saved in the database');

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    await push.initPush(); // a restart: must read the same pair back
    assert.equal(process.env.VAPID_PUBLIC_KEY, first, 'the same key after a restart');
    assert.equal(process.env.VAPID_PRIVATE_KEY, saved.vapid_private);

    // Keys given in the environment win.
    process.env.VAPID_PUBLIC_KEY = env.pub || first;
    process.env.VAPID_PRIVATE_KEY = env.priv || saved.vapid_private;
    await push.initPush();
    assert.equal(process.env.VAPID_PUBLIC_KEY, env.pub || first);
  } finally {
    if (env.pub) process.env.VAPID_PUBLIC_KEY = env.pub; else delete process.env.VAPID_PUBLIC_KEY;
    if (env.priv) process.env.VAPID_PRIVATE_KEY = env.priv; else delete process.env.VAPID_PRIVATE_KEY;
    await push.initPush();
  }
});

test('a new job reaches every provider at once, on screen and on their phones', async () => {
  assert.equal((await subscribe(provider, 'p1')).status, 201);
  assert.equal((await subscribe(otherProvider, 'p2')).status, 201);
  // A provider with two devices gets both.
  assert.equal((await subscribe(otherProvider, 'p2b')).status, 201);
  // quietProvider never turned phone alerts on. The seeker is subscribed too, but is not a provider.
  assert.equal((await subscribe(seeker, 's1')).status, 201);

  const live = [collect(sProvider, 'notification:new')];
  pushed.length = 0;

  const cat = await t.category();
  const work = await t.api('POST', '/services', seeker.token, { category_id: cat, title: `Urgent job ${Date.now()}`, description: 'Need help now', location: 'Dhanmondi', budget: 500 });
  assert.ok(work.success);
  assert.ok(work.providers_notified >= 3, 'every provider is counted');

  await sleep(400);
  const endpoints = pushed.map((p) => p.endpoint).sort();
  assert.deepEqual(endpoints, ['https://push.test/p1', 'https://push.test/p2', 'https://push.test/p2b']);
  assert.ok(pushed.every((p) => p.payload.link === `/work/${work.service_id}` && /New work available/.test(p.payload.title)));

  // On screen at once for a provider who has the app open.
  assert.ok(live[0].some((n) => n.type === 'work_new'));

  // Every provider has the notification in the app, including the one without phone alerts.
  for (const user of [provider, otherProvider, quietProvider]) {
    const list = (await t.api('GET', '/notifications', user.token)).notifications;
    assert.ok(list.some((n) => n.type === 'work_new' && n.link === `/work/${work.service_id}`), `${user.email} was notified`);
  }
  const mine = (await t.api('GET', '/notifications', seeker.token)).notifications;
  assert.ok(!mine.some((n) => n.type === 'work_new'), 'the person who posted is not alerted');
});

test('seeker and provider see each other, and nobody else does', async () => {
  const seekerSees = collect(sSeeker, 'location:update');
  const providerSees = collect(sProvider, 'location:update');
  const strangerSees = collect(sStranger, 'location:update');

  assert.ok((await ack(sSeeker, 'location:start', { to: provider.id })).ok);
  assert.ok((await ack(sProvider, 'location:start', { to: seeker.id })).ok);
  assert.equal((await ack(sStranger, 'location:start', { to: provider.id })).ok, false, 'only people who work together');

  sSeeker.emit('location:update', { to: provider.id, lat: 23.78, lng: 90.4, accuracy: 12 });
  await sleep(1100);
  sProvider.emit('location:update', { to: seeker.id, lat: 23.79, lng: 90.41, accuracy: 8 });
  await sleep(300);

  assert.deepEqual([providerSees.at(-1).lat, providerSees.at(-1).lng], [23.78, 90.4], 'the provider sees the seeker');
  assert.deepEqual([seekerSees.at(-1).lat, seekerSees.at(-1).lng], [23.79, 90.41], 'the seeker sees the provider');
  assert.equal(strangerSees.length, 0);

  const fromSeeker = await t.api('GET', `/location/${seeker.id}`, provider.token);
  assert.equal(fromSeeker.peer.active, true);
  assert.equal(fromSeeker.mine.active, true);
});

test('admins see every live location, others do not', async () => {
  assert.equal((await t.api('GET', '/admin/locations', seeker.token)).status, 403);
  assert.equal((await t.api('GET', '/admin/locations', provider.token)).status, 403);

  const list = (await t.api('GET', '/admin/locations', admin.token)).shares;
  const fromSeeker = list.find((s) => s.from === seeker.id && s.to === provider.id);
  const fromProvider = list.find((s) => s.from === provider.id && s.to === seeker.id);
  assert.ok(fromSeeker && fromProvider, 'both shares are listed');
  assert.equal(fromSeeker.lat, 23.78);
  assert.equal(fromProvider.lat, 23.79);
  assert.match(fromSeeker.from_name, /seeker/i);
  assert.match(fromSeeker.to_name, /provider/i);

  // Live: the admin screen updates as people move, and when they stop.
  const live = collect(sAdmin, 'admin:location');
  await sleep(1100);
  sProvider.emit('location:update', { to: seeker.id, lat: 23.8, lng: 90.42 });
  await sleep(300);
  assert.ok(live.some((e) => e.from === provider.id && e.lat === 23.8), 'admin gets live updates');

  sSeeker.emit('location:stop', { to: provider.id });
  await sleep(300);
  assert.ok(live.some((e) => e.from === seeker.id && e.active === false), 'admin sees when sharing stops');

  const after = (await t.api('GET', '/admin/locations', admin.token)).shares;
  assert.ok(!after.some((s) => s.from === seeker.id && s.to === provider.id));
  assert.ok(after.some((s) => s.from === provider.id), 'the other share is still live');

  // Users who are not admins never receive the admin feed.
  const spy = collect(sStranger, 'admin:location');
  await sleep(1100);
  sProvider.emit('location:update', { to: seeker.id, lat: 23.81, lng: 90.43 });
  await sleep(300);
  assert.equal(spy.length, 0);
});
