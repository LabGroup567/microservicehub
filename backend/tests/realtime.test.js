const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, sleep, tomorrow } = require('./helpers');

let t, seeker, provider, stranger, sSeeker, sProvider, sStranger;

const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const events = [];
  socket.on(event, (data) => events.push(data));
  return events;
};

before(async () => {
  t = await startTestServer();
  [seeker, provider, stranger] = await Promise.all([t.register('seeker'), t.register('provider'), t.register('seeker', 'stranger')]);
  await Promise.all([seeker, provider, stranger].map((user) => t.verify(user)));

  // A booking is what lets seeker and provider chat, call and share location.
  const cat = await t.category();
  const listing = await t.api('POST', '/my-listings', provider.token, { category_id: cat, title: 'Realtime listing', description: 'd', location: 'Dhaka', price: 100 });
  await t.api('POST', '/bookings', seeker.token, { provider_service_id: listing.id, preferred_date: tomorrow(), message: 'hi' });

  [sSeeker, sProvider, sStranger] = await Promise.all([seeker, provider, stranger].map((user) => t.connectSocket(user.token)));
});
after(async () => {
  [sSeeker, sProvider, sStranger].forEach((socket) => socket.close());
  await t.close();
});

test('sockets reject bad tokens', async () => {
  await assert.rejects(t.connectSocket('not-a-token'), /unauthorized/);
});

test('chat is instant and limited to people who work together', async () => {
  const received = collect(sProvider, 'message:new');
  const typing = collect(sProvider, 'typing');

  assert.equal((await t.api('POST', `/chat/${provider.id}`, stranger.token, { body: 'hi' })).status, 403);
  assert.equal((await t.api('POST', `/chat/${provider.id}`, seeker.token, { body: '   ' })).status, 400);

  assert.ok((await t.api('POST', `/chat/${provider.id}`, seeker.token, { body: 'hello there' })).success);
  sSeeker.emit('typing', { to: provider.id });
  await sleep(300);

  assert.equal(received.length, 1);
  assert.equal(received[0].body, 'hello there');
  assert.equal(typing[0].from, seeker.id);

  assert.equal((await t.api('GET', '/counters', provider.token)).messages, 1);
  await t.api('GET', `/chat/${seeker.id}`, provider.token);
  assert.equal((await t.api('GET', '/counters', provider.token)).messages, 0, 'reading clears the unread count');
});

test('live location is consent based and private', async () => {
  const updates = collect(sSeeker, 'location:update');
  const statuses = collect(sSeeker, 'location:status');

  assert.equal((await ack(sStranger, 'location:start', { to: provider.id })).ok, false);
  assert.ok((await ack(sProvider, 'location:start', { to: seeker.id })).ok);

  sProvider.emit('location:update', { to: seeker.id, lat: 23.8103, lng: 90.4125, accuracy: 12 });
  await sleep(300);
  assert.equal(updates.length, 1);

  sProvider.emit('location:update', { to: seeker.id, lat: 999, lng: 0 });
  sStranger.emit('location:update', { to: seeker.id, lat: 1, lng: 1 });
  await sleep(1100);
  assert.equal(updates.length, 1, 'invalid or unconsented updates are ignored');

  const state = await t.api('GET', `/location/${provider.id}`, seeker.token);
  assert.equal(state.peer.lat, 23.8103);
  assert.equal((await t.api('GET', `/location/${provider.id}`, stranger.token)).status, 403);

  sProvider.emit('location:stop', { to: seeker.id });
  await sleep(300);
  assert.ok(statuses.some((s) => s.active === false));
  assert.equal((await t.api('GET', `/location/${provider.id}`, seeker.token)).peer.active, false);
});

test('voice call signalling: ring, answer, relay, hang up', async () => {
  const incoming = collect(sProvider, 'call:incoming');
  const accepted = collect(sSeeker, 'call:accepted');
  const toProvider = collect(sProvider, 'call:signal');
  const toSeeker = collect(sSeeker, 'call:signal');
  const endedSeeker = collect(sSeeker, 'call:ended');

  assert.equal((await ack(sStranger, 'call:invite', { to: provider.id })).ok, false, 'strangers cannot call');
  assert.ok((await ack(sSeeker, 'call:invite', { to: provider.id })).ok);
  await sleep(200);
  assert.equal(incoming.length, 1);
  assert.equal((await ack(sStranger, 'call:invite', { to: provider.id })).ok, false, 'busy');

  sSeeker.emit('call:signal', { to: provider.id, data: { sdp: { type: 'offer', sdp: 'early' } } });
  await sleep(150);
  assert.equal(toProvider.length, 0, 'no signalling before the call is answered');

  sProvider.emit('call:accept', { to: seeker.id });
  await sleep(250);
  assert.equal(accepted.length, 1);

  sSeeker.emit('call:signal', { to: provider.id, data: { sdp: { type: 'offer', sdp: 'offer' } } });
  sProvider.emit('call:signal', { to: seeker.id, data: { sdp: { type: 'answer', sdp: 'answer' } } });
  sStranger.emit('call:signal', { to: provider.id, data: { candidate: 'evil' } });
  await sleep(250);
  assert.equal(toProvider.length, 1);
  assert.equal(toSeeker.length, 1);

  sProvider.emit('call:end', { to: seeker.id });
  await sleep(250);
  assert.equal(endedSeeker.length, 1);
});

test('declined and missed calls', async () => {
  const endedSeeker = collect(sSeeker, 'call:ended');

  await ack(sSeeker, 'call:invite', { to: provider.id });
  await sleep(150);
  sProvider.emit('call:decline', { to: seeker.id });
  await sleep(250);
  assert.equal(endedSeeker.at(-1).reason, 'declined');

  await ack(sSeeker, 'call:invite', { to: provider.id });
  await sleep(150);
  sSeeker.emit('call:end', { to: provider.id });
  await sleep(300);
  const notes = await t.api('GET', '/notifications', provider.token);
  assert.ok(notes.notifications.some((n) => n.type === 'call_missed'));
});
