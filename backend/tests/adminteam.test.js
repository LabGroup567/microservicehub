const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, PASSWORD } = require('./helpers');

let t, main, subUser, subToken;

before(async () => {
  t = await startTestServer();
  main = await t.makeAdmin(); // makeAdmin creates the main admin
});
after(() => t.close());

const login = (user) => t.api('POST', '/login', null, { email: user.email, password: user.password });
const tokenFrom = (message) => new URL(message.link).searchParams.get('token');

test('the main admin makes a registered user a sub admin, from the admin API only', async () => {
  subUser = await t.register('seeker', 'sub');

  assert.equal((await t.api('POST', '/admin/admins', subUser.token, { email: subUser.email })).status, 403, 'normal users cannot');
  assert.equal((await t.api('POST', '/admin/admins', main.token, { email: 'not-an-email' })).status, 400);

  const granted = await t.api('POST', '/admin/admins', main.token, { email: subUser.email });
  assert.ok(granted.success);
  assert.match(granted.message, /sub admin/);

  const session = await login(subUser);
  assert.equal(session.user.role, 'admin');
  assert.equal(session.user.is_main_admin, false);
  subToken = session.token;

  assert.ok((await t.api('GET', '/notifications', subToken)).notifications.some((n) => n.type === 'admin_access'));
  assert.equal((await t.api('POST', '/admin/admins', main.token, { email: subUser.email })).status, 409, 'already an admin');
});

test('a sub admin can moderate but not manage admins, roles or categories', async () => {
  assert.ok((await t.api('GET', '/admin/overview', subToken)).success);
  assert.ok((await t.api('GET', '/admin/users', subToken)).success);
  assert.ok((await t.api('GET', '/admin/reports', subToken)).success);
  assert.ok((await t.api('GET', '/admin/kyc', subToken)).success);

  assert.equal((await t.api('GET', '/admin/admins', subToken)).status, 403);
  assert.equal((await t.api('POST', '/admin/admins', subToken, { email: 'x@test.local' })).status, 403, 'sub admins cannot add admins');
  assert.equal((await t.api('DELETE', `/admin/admins/${main.id}`, subToken)).status, 403);
  assert.equal((await t.api('POST', '/admin/categories', subToken, { name: 'Sneaky' })).status, 403);
  assert.equal((await t.api('DELETE', '/admin/categories/1', subToken)).status, 403);

  const other = await t.register('provider');
  assert.equal((await t.api('PATCH', `/admin/users/${other.id}`, subToken, { role: 'seeker' })).status, 403, 'cannot change roles');
  assert.ok((await t.api('PATCH', `/admin/users/${other.id}`, subToken, { nid_status: 'verified' })).success, 'can still handle NID status');
});

test('nobody can touch the main admin, and sub admins cannot touch each other', async () => {
  assert.equal((await t.api('PATCH', `/admin/users/${main.id}`, subToken, { is_banned: true })).status, 403);
  assert.equal((await t.api('PATCH', `/admin/users/${main.id}`, subToken, { nid_status: 'rejected' })).status, 403);

  const peer = await t.register('seeker', 'peer');
  await t.api('POST', '/admin/admins', main.token, { email: peer.email });
  assert.equal((await t.api('PATCH', `/admin/users/${peer.id}`, subToken, { is_banned: true })).status, 403, 'sub admins cannot suspend other admins');

  assert.equal((await t.api('DELETE', `/admin/admins/${main.id}`, main.token)).status, 400, 'the main admin cannot remove themselves');
  assert.equal((await t.api('POST', '/admin/admins', main.token, { email: main.email })).status, 400);
});

test('inviting an email that has no account yet', async () => {
  const email = `invitee.${Date.now()}@test.local`;
  const { outbox } = require('../mailer');

  const invited = await t.api('POST', '/admin/admins', main.token, { email });
  assert.ok(invited.invited);
  const invitation = outbox.find((m) => m.to === email);
  assert.match(invitation.subject, /invited/i);

  const list = await t.api('GET', '/admin/admins', main.token);
  assert.ok(list.invites.some((i) => i.email === email));

  // Registering alone does NOT grant admin: anyone could type someone else's address.
  const registered = await t.api('POST', '/register', null, { full_name: 'New Person', email, password: PASSWORD, role: 'seeker' });
  assert.equal(registered.user.role, 'seeker');
  assert.equal((await t.api('GET', '/admin/stats', registered.token)).status, 403);

  // Proving ownership of the email (clicking the verification link) applies the invite.
  const verification = [...outbox].reverse().find((m) => m.to === email && /verify/i.test(m.subject));
  assert.ok((await t.api('POST', '/verify-email', null, { token: tokenFrom(verification) })).success);

  const session = await t.api('POST', '/login', null, { email, password: PASSWORD });
  assert.equal(session.user.role, 'admin');
  assert.equal(session.user.is_main_admin, false);
  assert.ok((await t.api('GET', '/admin/stats', session.token)).success);

  const after = await t.api('GET', '/admin/admins', main.token);
  assert.ok(!after.invites.some((i) => i.email === email), 'the invitation is used up');
});

test('invitations can be cancelled', async () => {
  const email = `cancel.${Date.now()}@test.local`;
  await t.api('POST', '/admin/admins', main.token, { email });

  const invite = (await t.api('GET', '/admin/admins', main.token)).invites.find((i) => i.email === email);
  assert.equal((await t.api('DELETE', `/admin/invites/${invite.id}`, subToken)).status, 403, 'only the main admin');
  assert.ok((await t.api('DELETE', `/admin/invites/${invite.id}`, main.token)).success);
  assert.ok(!(await t.api('GET', '/admin/admins', main.token)).invites.some((i) => i.email === email));
});

test('removing sub admin access returns the person to a normal account', async () => {
  assert.ok((await t.api('DELETE', `/admin/admins/${subUser.id}`, main.token)).success);

  const session = await login(subUser);
  assert.equal(session.user.role, 'seeker');
  assert.equal((await t.api('GET', '/admin/stats', session.token)).status, 403);
  assert.equal((await t.api('GET', '/admin/stats', subToken)).status, 403, 'the old token stops working at once');
});

test('only the main admin manages categories', async () => {
  const name = `Team ${Date.now()}`;
  assert.ok((await t.api('POST', '/admin/categories', main.token, { name })).success);

  const list = await t.api('GET', '/admin/categories', main.token);
  const mine = list.categories.find((c) => c.name === name);
  assert.ok((await t.api('DELETE', `/admin/categories/${mine.id}`, main.token)).success, 'cleans up after itself');
});

test('users can chat with the support team, and emails stay private', async () => {
  const supporter = await t.register('seeker', 'supporter');
  await t.api('POST', '/admin/admins', main.token, { email: supporter.email });
  const supportSession = await login(supporter);

  const person = await t.register('seeker');
  const team = await t.api('GET', '/support/team', person.token);
  assert.ok(team.team.some((m) => m.id === supporter.id), 'sub admin is listed');
  assert.ok(!JSON.stringify(team).includes('@test.local'), 'no emails exposed');

  assert.ok((await t.api('POST', `/chat/${supporter.id}`, person.token, { body: 'I need help with my NID' })).success);
  assert.ok((await t.api('GET', '/counters', supportSession.token)).messages >= 1, 'the admin sees the unread message');
  assert.ok((await t.api('POST', `/chat/${person.id}`, supportSession.token, { body: 'Happy to help. What went wrong?' })).success);

  assert.equal((await t.api('GET', `/chat/${supporter.id}`, person.token)).messages.length, 2);
});
