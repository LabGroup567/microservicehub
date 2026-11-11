const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

let t, user, stranger, admin, cat;

// A minimal valid PNG signature followed by padding.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

before(async () => {
  t = await startTestServer();
  [user, stranger] = await Promise.all([t.register('provider'), t.register('seeker')]);
  admin = await t.makeAdmin();
  cat = await t.category();
});
after(() => t.close());

function form({ nid = '1234567890123', dob = '1995-05-05', files = ['nid_front', 'nid_back', 'selfie'], fake = false } = {}) {
  const data = new FormData();
  data.set('full_name', 'Test User');
  data.set('nid_number', nid);
  data.set('dob', dob);
  files.forEach((name) =>
    data.set(name, new Blob([fake ? Buffer.from('definitely not an image') : PNG], { type: 'image/png' }), `${name}.png`)
  );
  return data;
}

const submit = async (token, body) => {
  const response = await fetch(`${t.base}/api/kyc`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  return { status: response.status, ...(await response.json()) };
};

const file = (token, id, type) => fetch(`${t.base}/api/kyc/file/${id}/${type}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('unverified users cannot create, but can still browse and chat', async () => {
  const listing = { category_id: cat, title: 'x', description: 'd', location: 'Dhaka', price: 5 };
  const blocked = await t.api('POST', '/my-listings', user.token, listing);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, 'kyc_required');

  assert.equal((await t.api('POST', '/applications', user.token, { service_id: 1, message: 'hello there' })).code, 'kyc_required');
  assert.equal((await t.api('POST', '/bookings', stranger.token, { provider_service_id: 1, preferred_date: '2099-01-01', message: 'x' })).code, 'kyc_required');
  assert.ok((await t.api('GET', '/provider-services', stranger.token)).success);
  assert.ok((await t.api('GET', '/me', stranger.token)).success);
});

test('submission is validated', async () => {
  assert.equal((await submit(user.token, form({ files: ['nid_front'] }))).status, 400, 'all three photos needed');
  assert.equal((await submit(user.token, form({ fake: true }))).status, 400, 'file content must really be an image');
  assert.equal((await submit(user.token, form({ nid: '12ab' }))).status, 400);
  assert.equal((await submit(user.token, form({ dob: '2015-01-01' }))).status, 400, 'must be an adult');
});

test('a valid submission goes to review and cannot be repeated meanwhile', async () => {
  assert.ok((await submit(user.token, form())).success);
  assert.equal((await submit(user.token, form())).status, 409);

  const mine = await t.api('GET', '/kyc/me', user.token);
  assert.equal(mine.kyc.status, 'pending');
  assert.equal(mine.kyc.documents.length, 3);
});

test('only the owner and admins can see documents and NID data', async () => {
  assert.equal((await file(user.token, user.id, 'selfie')).status, 200);
  assert.equal((await file(admin.token, user.id, 'nid_front')).status, 200);
  assert.equal((await file(stranger.token, user.id, 'nid_front')).status, 404);
  assert.equal((await file('', user.id, 'nid_front')).status, 401);

  const profile = JSON.stringify(await t.api('GET', `/providers/${user.id}/reviews`, stranger.token));
  assert.ok(!profile.includes('1234567890123'), 'NID number is not in the public profile');
  assert.equal((await t.api('GET', '/admin/users', stranger.token)).status, 403);
  assert.equal((await t.api('GET', '/admin/kyc', stranger.token)).status, 403);
});

test('admin review: reject with a reason, resubmit, approve', async () => {
  assert.equal((await t.api('PATCH', `/admin/kyc/${user.id}`, admin.token, { status: 'rejected' })).status, 400, 'reason required');
  assert.ok((await t.api('PATCH', `/admin/kyc/${user.id}`, admin.token, { status: 'rejected', reason: 'Selfie is blurry' })).success);

  const rejected = await t.api('GET', '/kyc/me', user.token);
  assert.equal(rejected.kyc.reason, 'Selfie is blurry');

  assert.ok((await submit(user.token, form({ files: [] }))).success, 'old photos are kept when resubmitting');
  assert.ok((await t.api('PATCH', `/admin/kyc/${user.id}`, admin.token, { status: 'verified' })).success);

  const me = await t.api('GET', '/me', user.token);
  assert.equal(me.user.kyc_status, 'verified');
  assert.equal(me.user.nid_status, 'verified');
  assert.equal((await t.api('PATCH', `/admin/kyc/${user.id}`, admin.token, { status: 'verified' })).status, 409);

  const listing = await t.api('POST', '/my-listings', user.token, { category_id: cat, title: 'Now allowed', description: 'd', location: 'Dhaka', price: 5 });
  assert.ok(listing.success, 'verified providers can create');
});

// ---------- Under 18: birth certificate instead of NID ----------

function minorForm({ method = 'birth_certificate', dob, files = ['birth_certificate', 'selfie'], number = '20081234567890123' } = {}) {
  const data = new FormData();
  data.set('method', method);
  data.set('full_name', 'Young Person');
  data.set('id_number', number);
  data.set('dob', dob);
  files.forEach((name) => data.set(name, new Blob([PNG], { type: 'image/png' }), `${name}.png`));
  return data;
}

const yearsAgo = (years, extraDays = 0) => new Date(Date.now() - years * 365.25 * 86400000 - extraDays * 86400000).toISOString().slice(0, 10);

test('under 18: a birth certificate is required, an NID is not accepted', async () => {
  const teen = await t.register('seeker', 'teen');
  const dob = yearsAgo(16);

  assert.equal((await submit(teen.token, form({ dob }))).status, 400, 'NID route is closed to under 18');
  assert.equal((await submit(teen.token, minorForm({ dob, files: ['selfie'] }))).status, 400, 'certificate photo required');
  assert.equal((await submit(teen.token, minorForm({ dob, files: ['birth_certificate'] }))).status, 400, 'selfie required');
  assert.equal((await submit(teen.token, minorForm({ dob, number: '12ab' }))).status, 400, 'number must be digits');
  assert.equal((await submit(teen.token, minorForm({ dob: yearsAgo(10) }))).status, 400, 'below the minimum age');
  assert.equal((await submit(teen.token, minorForm({ dob: '2999-01-01' }))).status, 400, 'future date');
  assert.equal((await submit(teen.token, minorForm({ dob: yearsAgo(30) }))).status, 400, 'adults must use the NID');

  const sent = await submit(teen.token, minorForm({ dob }));
  assert.ok(sent.success, JSON.stringify(sent));

  const mine = (await t.api('GET', '/kyc/me', teen.token)).kyc;
  assert.equal(mine.status, 'pending');
  assert.equal(mine.method, 'birth_certificate');
  assert.equal(mine.birth_cert_number, '20081234567890123');
  assert.equal(mine.nid_number, '');
  assert.deepEqual([...mine.documents].sort(), ['birth_certificate', 'selfie']);
});

test('under 18: documents are private and admins review and approve them', async () => {
  const teen = await t.register('provider', 'teenprov');
  assert.ok((await submit(teen.token, minorForm({ dob: yearsAgo(17) }))).success);

  assert.equal((await file(teen.token, teen.id, 'birth_certificate')).status, 200);
  assert.equal((await file(admin.token, teen.id, 'birth_certificate')).status, 200);
  assert.equal((await file(stranger.token, teen.id, 'birth_certificate')).status, 404);
  assert.equal((await file('', teen.id, 'birth_certificate')).status, 401);

  const queue = (await t.api('GET', '/admin/kyc?status=pending', admin.token)).users.find((u) => u.id === teen.id);
  assert.equal(queue.kyc_method, 'birth_certificate');
  assert.equal(queue.birth_cert_number, '20081234567890123');

  const publicView = JSON.stringify(await t.api('GET', `/providers/${teen.id}/reviews`, stranger.token));
  assert.ok(!publicView.includes('20081234567890123'), 'the certificate number is not public');
  assert.equal((await t.api('GET', '/admin/kyc', stranger.token)).status, 403);

  assert.ok((await t.api('PATCH', `/admin/kyc/${teen.id}`, admin.token, { status: 'verified' })).success);
  assert.equal((await t.api('GET', '/me', teen.token)).user.kyc_status, 'verified');
  const listing = await t.api('POST', '/my-listings', teen.token, { category_id: cat, title: 'Teen helper', description: 'd', location: 'Dhaka', price: 5 });
  assert.ok(listing.success, 'a verified young person can use the platform');
});

test('adults cannot use a birth certificate, and switching routes replaces the old photos', async () => {
  const adult = await t.register('seeker', 'adultswitch');
  assert.equal((await submit(adult.token, minorForm({ dob: yearsAgo(30) }))).status, 400);

  // First an NID submission, rejected, then the person turns out to be a minor: old NID photos go away.
  const person = await t.register('seeker', 'switcher');
  assert.ok((await submit(person.token, form({ dob: yearsAgo(25) }))).success);
  assert.ok((await t.api('PATCH', `/admin/kyc/${person.id}`, admin.token, { status: 'rejected', reason: 'Wrong date of birth' })).success);

  assert.ok((await submit(person.token, minorForm({ dob: yearsAgo(15) }))).success);
  const mine = (await t.api('GET', '/kyc/me', person.token)).kyc;
  assert.equal(mine.method, 'birth_certificate');
  assert.deepEqual([...mine.documents].sort(), ['birth_certificate', 'selfie']);
  assert.equal((await file(person.token, person.id, 'nid_front')).status, 404, 'old NID photos were removed');
  assert.equal(mine.nid_number, '');
});

test('the 18th birthday decides the route', async () => {
  const justAdult = await t.register('seeker', 'adult18');
  assert.equal((await submit(justAdult.token, minorForm({ dob: yearsAgo(18, 2) }))).status, 400, 'just turned 18: NID required');
  assert.ok((await submit(justAdult.token, form({ dob: yearsAgo(18, 2) }))).success);

  const almost = await t.register('seeker', 'almost18');
  assert.equal((await submit(almost.token, form({ dob: yearsAgo(18, -2) }))).status, 400, 'turns 18 in two days: birth certificate');
  assert.ok((await submit(almost.token, minorForm({ dob: yearsAgo(18, -2) }))).success);
});
