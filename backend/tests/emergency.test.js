const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer } = require('./helpers');

let t, admin;

before(async () => {
  t = await startTestServer();
  admin = await t.makeAdmin();
});

after(async () => {
  await t.close();
});

const rand = () => crypto.randomBytes(3).toString('hex');
const catId = async (name) => (await t.api('GET', '/categories')).categories.find((c) => c.name === name)?.id;

test('providers cannot list ambulances or doctors: the admin team runs them', async () => {
  const ambulance = await catId('Ambulance');
  const doctor = await catId('Online Doctor');
  assert.ok(ambulance && doctor, 'both service types exist');

  const provider = await t.register('provider', 'doc');
  await t.verify(provider);
  const body = { description: 'Open all day', location: 'Dhaka', price: 500 };

  const van = await t.api('POST', '/my-listings', provider.token, { ...body, category_id: ambulance, title: `Van ${rand()}` });
  assert.equal(van.status, 403, 'ambulances are added by admins only');
  const dr = await t.api('POST', '/my-listings', provider.token, { ...body, category_id: doctor, title: `Dr ${rand()}`, credential: 'BMDC A-12345' });
  assert.equal(dr.status, 403, 'doctors are added by admins only');

  const seeker = await t.register('seeker', 'patient');
  const hub = await t.api('GET', '/emergency', seeker.token);
  assert.ok(typeof hub.ambulance.total === 'number' && typeof hub.doctor.listings === 'number');
  assert.equal((await t.api('GET', '/emergency')).status, 401);
});

test('ambulances: admin adds, a person chooses one and follows it live, admin removes', async () => {
  const seeker = await t.register('seeker', 'amb1');
  const other = await t.register('seeker', 'amb2');

  const info = { name: `City Care ${rand()}`, driver_name: 'Karim Mia', phone: '01712345678', vehicle_no: 'Dhaka Metro 12-3456', area: 'Mirpur, Dhaka' };
  assert.equal((await t.api('POST', '/admin/ambulances', seeker.token, info)).status, 403, 'only admins add ambulances');
  assert.equal((await t.api('POST', '/admin/ambulances', admin.token, { ...info, phone: '123' })).status, 400, 'a real phone number');
  assert.equal((await t.api('POST', '/admin/ambulances', admin.token, { ...info, name: 'x' })).status, 400);

  const made = await t.api('POST', '/admin/ambulances', admin.token, info);
  assert.equal(made.status, 201, JSON.stringify(made));

  const listed = (await t.api('GET', '/ambulances', seeker.token)).ambulances.find((a) => a.id === made.id);
  assert.equal(listed.status, 'available');
  assert.equal(Object.hasOwn(listed, 'phone'), false, 'the driver number is not on the public list');
  assert.equal(Object.hasOwn(listed, 'track_token'), false);

  const ask = (token, extra = {}) => t.api('POST', `/ambulances/${made.id}/request`, token, { pickup: 'House 5, Road 3, Mirpur', phone: '01898765432', ...extra });
  assert.equal((await ask(seeker.token, { pickup: 'x' })).status, 400, 'an address is needed');
  assert.equal((await ask(seeker.token, { phone: '1' })).status, 400, 'a phone number is needed');
  assert.equal((await ask(admin.token)).status, 403, 'admins manage it, they do not request it');

  const chosen = await ask(seeker.token);
  assert.equal(chosen.status, 201, JSON.stringify(chosen));
  assert.equal((await ask(other.token)).status, 409, 'a busy ambulance cannot be chosen twice');
  assert.equal((await t.api('GET', '/ambulances', other.token)).ambulances.find((a) => a.id === made.id).status, 'busy');

  const admins = (await t.api('GET', '/notifications', admin.token)).notifications;
  assert.ok(admins.some((n) => n.type === 'ambulance_request'), 'the admins are told');

  // No position yet; then an admin puts the ambulance on the map and the patient sees it.
  const before = (await t.api('GET', `/ambulances/requests/${chosen.id}`, seeker.token)).request;
  assert.equal(before.location, null);
  assert.equal(before.ambulance.phone, '01712345678', 'the chosen driver number is shown to the patient');
  assert.equal((await t.api('PATCH', `/admin/ambulances/${made.id}/location`, seeker.token, { lat: 23.8, lng: 90.4 })).status, 403);
  assert.equal((await t.api('PATCH', `/admin/ambulances/${made.id}/location`, admin.token, { lat: 123, lng: 90.4 })).status, 400);
  assert.ok((await t.api('PATCH', `/admin/ambulances/${made.id}/location`, admin.token, { lat: 23.81, lng: 90.41 })).success);
  const live = (await t.api('GET', `/ambulances/requests/${chosen.id}`, seeker.token)).request;
  assert.equal(live.location.lat, 23.81);
  assert.equal(live.location.live, true);

  // The driver's phone updates it with the secret link, no login.
  const token = (await t.api('GET', '/admin/ambulances', admin.token)).ambulances.find((a) => a.id === made.id).track_token;
  assert.equal((await t.api('GET', '/ambulance-track/nope')).status, 404);
  assert.equal((await t.api('GET', `/ambulance-track/${token}`)).ambulance.name, info.name);
  assert.equal((await t.api('POST', `/ambulance-track/${token}`, null, { lat: 'a', lng: 1 })).status, 400);
  assert.ok((await t.api('POST', `/ambulance-track/${token}`, null, { lat: 23.9, lng: 90.5 })).success);
  assert.equal((await t.api('GET', `/ambulances/requests/${chosen.id}`, seeker.token)).request.location.lat, 23.9);

  // Nobody else can follow it.
  assert.equal((await t.api('GET', `/ambulances/requests/${chosen.id}`, other.token)).status, 404);
  assert.equal((await t.api('GET', '/admin/ambulances', other.token)).status, 403);

  // Cancelling frees the ambulance and the position is no longer shared.
  assert.equal((await t.api('PATCH', `/ambulances/requests/${chosen.id}`, seeker.token, { status: 'completed' })).status, 403, 'only an admin completes a trip');
  assert.ok((await t.api('PATCH', `/ambulances/requests/${chosen.id}`, seeker.token, { status: 'cancelled' })).success);
  assert.equal((await t.api('GET', `/ambulances/requests/${chosen.id}`, seeker.token)).request.location, null);
  assert.equal((await t.api('GET', '/ambulances', other.token)).ambulances.find((a) => a.id === made.id).status, 'available');

  // An admin can finish a trip too, and removing an ambulance tells the person waiting.
  const second = await ask(other.token);
  assert.equal(second.status, 201);
  assert.ok((await t.api('PATCH', `/ambulances/requests/${second.id}`, admin.token, { status: 'completed' })).success);
  const third = await ask(other.token);
  assert.equal(third.status, 201, JSON.stringify(third));
  assert.ok((await t.api('DELETE', `/admin/ambulances/${made.id}`, admin.token)).success);
  assert.ok((await t.api('GET', '/notifications', other.token)).notifications.some((n) => n.type === 'ambulance_status' && n.title.includes('removed')));
  assert.equal((await t.api('GET', '/ambulances', other.token)).ambulances.some((a) => a.id === made.id), false);
});

test('doctors: admin adds them, patients ask for a checkup, an admin approves and sends the meeting link', async () => {
  const patient = await t.register('seeker', 'pat1');
  const stranger = await t.register('seeker', 'pat2');

  const info = { full_name: `Dr Rahim ${rand()}`, specialty: 'Medicine', qualification: 'MBBS, FCPS', reg_no: 'BMDC A-12345', fee: 500, phone: '01711223344', bio: 'Fever, cough and common illness' };
  assert.equal((await t.api('POST', '/admin/doctors', patient.token, info)).status, 403);
  assert.equal((await t.api('POST', '/admin/doctors', admin.token, { ...info, reg_no: '' })).status, 400, 'a registration number is needed');
  const doctor = await t.api('POST', '/admin/doctors', admin.token, info);
  assert.equal(doctor.status, 201, JSON.stringify(doctor));

  const shown = (await t.api('GET', '/doctors', patient.token)).doctors.find((d) => d.id === doctor.id);
  assert.equal(shown.reg_no, 'BMDC A-12345');
  assert.equal(Object.hasOwn(shown, 'phone'), false, 'the doctor number stays with the admins');

  const ask = (token, extra = {}) => t.api('POST', '/checkups', token, { doctor_id: doctor.id, reason: 'Fever for two days', preferred_time: 'Tonight after 9 pm', ...extra });
  assert.equal((await ask(patient.token, { reason: '' })).status, 400);
  assert.equal((await ask(admin.token)).status, 403, 'admins do not request checkups');
  assert.equal((await ask(patient.token, { doctor_id: 99999999 })).status, 404);

  const sent = await ask(patient.token);
  assert.equal(sent.status, 201, JSON.stringify(sent));
  assert.ok((await t.api('GET', '/notifications', admin.token)).notifications.some((n) => n.type === 'checkup_request'), 'the admins are told');
  assert.equal((await t.api('GET', '/checkups/mine', patient.token)).checkups.find((c) => c.id === sent.id).meeting_link, null, 'no link before approval');

  const pending = (await t.api('GET', '/admin/checkups?status=pending', admin.token)).checkups.find((c) => c.id === sent.id);
  assert.equal(pending.user_phone, '01711111111');
  assert.equal((await t.api('GET', '/admin/checkups', patient.token)).status, 403);

  // The admin must send a real web link.
  const approve = (link) => t.api('PATCH', `/admin/checkups/${sent.id}`, admin.token, { status: 'approved', meeting_link: link, meeting_time: 'Today 9:30 pm' });
  assert.equal((await approve('')).status, 400);
  assert.equal((await approve('javascript:alert(1)')).status, 400, 'only http or https links');
  assert.equal((await approve('not a link')).status, 400);
  assert.ok((await approve('https://meet.google.com/abc-defg-hij')).success);

  const mine = (await t.api('GET', '/checkups/mine', patient.token)).checkups.find((c) => c.id === sent.id);
  assert.equal(mine.status, 'approved');
  assert.equal(mine.meeting_link, 'https://meet.google.com/abc-defg-hij');
  assert.equal(mine.meeting_time, 'Today 9:30 pm');
  assert.ok((await t.api('GET', '/notifications', patient.token)).notifications.some((n) => n.type === 'checkup_status' && n.title.includes('approved')));
  assert.equal((await t.api('GET', '/checkups/mine', stranger.token)).checkups.length, 0, 'private to the patient');

  assert.ok((await t.api('PATCH', `/admin/checkups/${sent.id}`, admin.token, { status: 'completed' })).success);

  // A rejection needs a reason; a patient cannot flood the queue.
  const second = await ask(patient.token);
  assert.equal((await t.api('PATCH', `/admin/checkups/${second.id}`, admin.token, { status: 'rejected' })).status, 400);
  assert.ok((await t.api('PATCH', `/admin/checkups/${second.id}`, admin.token, { status: 'rejected', admin_note: 'Please call 16263 for this problem.' })).success);
  assert.equal((await t.api('GET', '/checkups/mine', patient.token)).checkups.find((c) => c.id === second.id).admin_note, 'Please call 16263 for this problem.');

  for (let i = 0; i < 3; i += 1) assert.equal((await ask(stranger.token)).status, 201);
  assert.equal((await ask(stranger.token)).status, 429, 'three waiting requests at most');

  const waiting = (await t.api('GET', '/checkups/mine', stranger.token)).checkups[0];
  assert.ok((await t.api('PATCH', `/checkups/${waiting.id}/cancel`, stranger.token)).success);
  assert.equal((await t.api('PATCH', `/checkups/${waiting.id}/cancel`, patient.token)).status, 404, 'only the patient cancels');

  assert.ok((await t.api('DELETE', `/admin/doctors/${doctor.id}`, admin.token)).success);
  assert.equal((await t.api('GET', '/doctors', patient.token)).doctors.some((d) => d.id === doctor.id), false);
});

test('blood bank: anyone adds themselves or asks for blood, admins see and clean it up', async () => {
  const donor = await t.register('seeker', 'adm-donor');
  const family = await t.register('seeker', 'adm-family');
  await t.api('PUT', '/blood/me', donor.token, { blood_group: 'AB+', area: 'Banani, Dhaka' });
  const posted = await t.api('POST', '/blood/requests', family.token, { blood_group: 'AB+', units: 1, hospital: 'United Hospital', area: 'Gulshan, Dhaka', contact_phone: '01955667788' });
  assert.equal(posted.status, 201);

  assert.equal((await t.api('GET', '/admin/blood', donor.token)).status, 403);
  const all = await t.api('GET', '/admin/blood', admin.token);
  assert.ok(all.donors.some((d) => d.user_id === donor.id));
  assert.ok(all.requests.some((r) => r.id === posted.id && r.contact_phone === '01955667788'), 'admins see the whole request');

  assert.ok((await t.api('PATCH', `/admin/blood/requests/${posted.id}`, admin.token, { status: 'closed' })).success);
  assert.ok(!(await t.api('GET', '/blood/requests', donor.token)).requests.some((r) => r.id === posted.id));
  assert.ok((await t.api('DELETE', `/admin/blood/donors/${donor.id}`, admin.token)).success);
  assert.equal((await t.api('GET', '/blood/me', donor.token)).donor, null);
  assert.equal((await t.api('DELETE', `/admin/blood/donors/${donor.id}`, admin.token)).status, 404);
});


test('blood donors: register, find, and keep phone numbers private', async () => {
  const donor = await t.register('seeker', 'donor');
  const finder = await t.register('seeker', 'finder');

  assert.equal((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'Z+', area: 'Mirpur' })).status, 400, 'not a blood group');
  assert.equal((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'O+', area: '' })).status, 400, 'area needed');
  assert.equal((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'O+', area: 'Mirpur', last_donated: '2999-01-01' })).status, 400, 'no future date');
  assert.equal((await t.api('PUT', '/blood/me', admin.token, { blood_group: 'O+', area: 'Mirpur' })).status, 403);

  assert.equal((await t.api('GET', '/blood/me', donor.token)).donor, null);
  assert.ok((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'o+', area: 'Mirpur, Dhaka' })).success);
  const mine = (await t.api('GET', '/blood/me', donor.token)).donor;
  assert.equal(mine.blood_group, 'O+');
  assert.equal(mine.share_phone, false);

  const list = (await t.api('GET', '/blood/donors?group=O%2B&area=Mirpur', finder.token)).donors;
  const row = list.find((d) => d.id === donor.id);
  assert.ok(row, 'the donor can be found');
  assert.equal(row.phone, null, 'the number stays private by default');
  assert.equal(row.eligible_now, true);
  assert.equal(list.some((d) => d.id === finder.id), false);
  assert.equal(Object.hasOwn(row, 'email'), false);

  assert.ok((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'O+', area: 'Mirpur, Dhaka', share_phone: true })).success);
  assert.equal((await t.api('GET', '/blood/donors?group=O%2B', finder.token)).donors.find((d) => d.id === donor.id).phone, '01711111111', 'shared on purpose');

  // A recent donation means "not yet", and the eligible filter hides them.
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  assert.ok((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'O+', area: 'Mirpur, Dhaka', last_donated: lastWeek })).success);
  assert.equal((await t.api('GET', '/blood/donors?group=O%2B', finder.token)).donors.find((d) => d.id === donor.id).eligible_now, false);
  assert.equal((await t.api('GET', '/blood/donors?group=O%2B&eligible=1', finder.token)).donors.some((d) => d.id === donor.id), false);

  // Switching off hides them; removing deletes the record.
  assert.ok((await t.api('PUT', '/blood/me', donor.token, { blood_group: 'O+', area: 'Mirpur, Dhaka', is_available: false })).success);
  assert.equal((await t.api('GET', '/blood/donors?group=O%2B', finder.token)).donors.some((d) => d.id === donor.id), false);
  assert.ok((await t.api('DELETE', '/blood/me', donor.token)).success);
  assert.equal((await t.api('GET', '/blood/me', donor.token)).donor, null);
  assert.equal((await t.api('GET', '/blood/donors')).status, 401);
});

test('blood requests: donors are told, a number is shared only when a donor offers', async () => {
  const donor = await t.register('provider', 'bdonor');
  const other = await t.register('seeker', 'bother');
  const family = await t.register('seeker', 'family');
  await t.api('PUT', '/blood/me', donor.token, { blood_group: 'B-', area: 'Uttara, Dhaka' });
  await t.api('PUT', '/blood/me', other.token, { blood_group: 'A+', area: 'Uttara, Dhaka' });

  const ask = (body) => t.api('POST', '/blood/requests', family.token, { blood_group: 'B-', units: 2, hospital: 'Square Hospital', area: 'Panthapath, Dhaka', contact_phone: '01822334455', urgent: true, ...body });
  assert.equal((await ask({ contact_phone: '12345' })).status, 400, 'phone must be a real number');
  assert.equal((await ask({ units: 99 })).status, 400);
  assert.equal((await ask({ hospital: '' })).status, 400);

  const posted = await ask({});
  assert.equal(posted.status, 201, JSON.stringify(posted));
  assert.ok(posted.alerted >= 1);

  const told = (await t.api('GET', '/notifications', donor.token)).notifications.find((n) => n.type === 'blood_request');
  assert.ok(told && told.title.includes('B- blood needed'), 'a matching donor is alerted');
  assert.ok(!(await t.api('GET', '/notifications', other.token)).notifications.some((n) => n.type === 'blood_request'), 'other groups are not');

  // The board hides the family number.
  const board = (await t.api('GET', '/blood/requests?group=B-', donor.token)).requests.find((r) => r.id === posted.id);
  assert.ok(board);
  assert.equal(Object.hasOwn(board, 'contact_phone'), false);
  assert.equal(board.urgent, true);
  assert.equal(board.mine, false);

  assert.equal((await t.api('POST', `/blood/requests/${posted.id}/offer`, family.token)).status, 400, 'not your own request');
  const offer = await t.api('POST', `/blood/requests/${posted.id}/offer`, donor.token);
  assert.equal(offer.status, 201, JSON.stringify(offer));
  assert.equal(offer.contact_phone, '01822334455', 'the donor now sees the number');
  assert.equal((await t.api('POST', `/blood/requests/${posted.id}/offer`, donor.token)).status, 409, 'only once');

  const note = (await t.api('GET', '/notifications', family.token)).notifications.find((n) => n.type === 'blood_offer');
  assert.ok(note && note.body.includes('01711111111'), 'the family gets the donor number');

  const mine = (await t.api('GET', '/blood/requests/mine', family.token)).requests.find((r) => r.id === posted.id);
  assert.equal(mine.offers.length, 1);
  assert.equal(mine.offers[0].donor_id, donor.id);
  assert.equal(mine.contact_phone, '01822334455');

  assert.equal((await t.api('PATCH', `/blood/requests/${posted.id}`, donor.token, { status: 'closed' })).status, 404, 'only the family can close it');
  assert.equal((await t.api('PATCH', `/blood/requests/${posted.id}`, family.token, { status: 'nonsense' })).status, 400);
  assert.ok((await t.api('PATCH', `/blood/requests/${posted.id}`, family.token, { status: 'fulfilled' })).success);
  assert.equal((await t.api('POST', `/blood/requests/${posted.id}/offer`, other.token)).status, 404, 'a closed request takes no offers');
  assert.ok(!(await t.api('GET', '/blood/requests', donor.token)).requests.some((r) => r.id === posted.id));
});

test('blood requests are limited so nobody can flood the board', async () => {
  const spammer = await t.register('seeker', 'spam');
  const post = () => t.api('POST', '/blood/requests', spammer.token, { blood_group: 'AB-', units: 1, hospital: 'City Hospital', area: 'Dhaka', contact_phone: '01933445566' });
  for (let i = 0; i < 3; i += 1) assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429, 'three open requests at most');

  // An expired request no longer shows, and does not count as open.
  await t.db.query('UPDATE blood_requests SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE requester_id = ?', [spammer.id]);
  const board = (await t.api('GET', '/blood/requests?group=AB-', spammer.token)).requests;
  assert.equal(board.some((r) => r.mine), false);
  assert.equal((await post()).status, 201, 'room again once they expired');
});

test('admin adds a walk-in donor and posts a blood request', async () => {
  const finder = await t.register('seeker', 'adm-find');
  const donor = { full_name: `Walk In ${rand()}`, phone: '01788990011', blood_group: 'b-', area: 'Dhanmondi, Dhaka' };

  assert.equal((await t.api('POST', '/admin/blood/managed', finder.token, donor)).status, 403, 'only admins');
  assert.equal((await t.api('POST', '/admin/blood/managed', admin.token, { ...donor, phone: '12' })).status, 400);
  assert.equal((await t.api('POST', '/admin/blood/managed', admin.token, { ...donor, blood_group: 'Q+' })).status, 400);
  assert.equal((await t.api('POST', '/admin/blood/managed', admin.token, { ...donor, last_donated: '2999-01-01' })).status, 400);
  const made = await t.api('POST', '/admin/blood/managed', admin.token, donor);
  assert.equal(made.status, 201, JSON.stringify(made));

  // People looking for donors find them, with the number they agreed to share.
  const row = (await t.api('GET', '/blood/donors?group=B-&area=Dhanmondi', finder.token)).donors.find((d) => d.id === `m${made.id}`);
  assert.ok(row, 'the admin-added donor can be found');
  assert.equal(row.phone, '01788990011');
  assert.equal(row.eligible_now, true);
  assert.ok((await t.api('GET', '/admin/blood', admin.token)).managed.some((d) => d.id === made.id));

  // An admin can also post a request, and registered donors are told.
  const reg = await t.register('seeker', 'adm-reg');
  await t.api('PUT', '/blood/me', reg.token, { blood_group: 'B-', area: 'Dhanmondi, Dhaka' });
  const posted = await t.api('POST', '/blood/requests', admin.token, { blood_group: 'B-', units: 2, hospital: 'Lab Aid Hospital', area: 'Dhanmondi, Dhaka', contact_phone: '01700112233' });
  assert.equal(posted.status, 201, JSON.stringify(posted));
  assert.ok((await t.api('GET', '/notifications', reg.token)).notifications.some((n) => n.type === 'blood_request'));

  assert.equal((await t.api('DELETE', `/admin/blood/managed/${made.id}`, finder.token)).status, 403);
  assert.ok((await t.api('DELETE', `/admin/blood/managed/${made.id}`, admin.token)).success);
  assert.equal((await t.api('GET', '/blood/donors?group=B-&area=Dhanmondi', finder.token)).donors.some((d) => d.id === `m${made.id}`), false);
  assert.equal((await t.api('DELETE', `/admin/blood/managed/${made.id}`, admin.token)).status, 404);
});

test('admin can edit and delete everything in the blood bank and checkups', async () => {
  const user = await t.register('seeker', 'edit-donor');
  const asker = await t.register('seeker', 'edit-asker');
  await t.api('PUT', '/blood/me', user.token, { blood_group: 'A+', area: 'Uttara, Dhaka' });

  // A registered donor's details can be corrected, and switched off.
  assert.equal((await t.api('PUT', `/admin/blood/donors/${user.id}`, user.token, { blood_group: 'O+', area: 'Mirpur' })).status, 403);
  assert.equal((await t.api('PUT', `/admin/blood/donors/${user.id}`, admin.token, { blood_group: 'Z', area: 'Mirpur' })).status, 400);
  assert.ok((await t.api('PUT', `/admin/blood/donors/${user.id}`, admin.token, { blood_group: 'O-', area: 'Mirpur, Dhaka', is_available: false })).success);
  const mine = (await t.api('GET', '/blood/me', user.token)).donor;
  assert.equal(mine.blood_group, 'O-');
  assert.equal(mine.is_available, false);

  // A walk-in donor can be edited.
  const made = await t.api('POST', '/admin/blood/managed', admin.token, { full_name: 'Walk In', phone: '01711000000', blood_group: 'A+', area: 'Uttara' });
  assert.ok((await t.api('PUT', `/admin/blood/managed/${made.id}`, admin.token, { full_name: 'Walk In Updated', phone: '01711000001', blood_group: 'AB+', area: 'Gulshan', is_available: false })).success);
  const edited = (await t.api('GET', '/admin/blood', admin.token)).managed.find((d) => d.id === made.id);
  assert.equal(edited.full_name, 'Walk In Updated');
  assert.equal(edited.blood_group, 'AB+');
  assert.equal(edited.is_available, false);
  assert.equal((await t.api('PUT', '/admin/blood/managed/99999999', admin.token, { full_name: 'Nobody', phone: '01711000001', blood_group: 'A+', area: 'Uttara' })).status, 404);

  // A request can be edited, reopened and deleted.
  const posted = await t.api('POST', '/blood/requests', asker.token, { blood_group: 'B+', units: 1, hospital: 'City Hospital', area: 'Dhaka', contact_phone: '01933445566' });
  const change = (extra) => t.api('PUT', `/admin/blood/requests/${posted.id}`, admin.token, { blood_group: 'B+', units: 3, hospital: 'Square Hospital', area: 'Panthapath', contact_phone: '01933445566', status: 'open', ...extra });
  assert.equal((await change({ units: 99 })).status, 400);
  assert.equal((await change({ status: 'weird' })).status, 400);
  assert.ok((await change({ status: 'closed' })).success);
  assert.ok(!(await t.api('GET', '/blood/requests', user.token)).requests.some((r) => r.id === posted.id), 'closed requests leave the board');
  assert.ok((await change({})).success, 'reopened');
  const back = (await t.api('GET', '/blood/requests', user.token)).requests.find((r) => r.id === posted.id);
  assert.ok(back && back.units === 3 && back.hospital === 'Square Hospital');
  assert.equal((await t.api('DELETE', `/admin/blood/requests/${posted.id}`, user.token)).status, 403);
  assert.ok((await t.api('DELETE', `/admin/blood/requests/${posted.id}`, admin.token)).success);
  assert.equal((await t.api('DELETE', `/admin/blood/requests/${posted.id}`, admin.token)).status, 404);

  // An approved checkup can get a new link, and any checkup can be deleted.
  const doctor = await t.api('POST', '/admin/doctors', admin.token, { full_name: `Dr Edit ${rand()}`, specialty: 'Medicine', reg_no: 'BMDC A-99999', fee: 0 });
  const checkup = await t.api('POST', '/checkups', asker.token, { doctor_id: doctor.id, reason: 'Headache for three days' });
  const approve = (link) => t.api('PATCH', `/admin/checkups/${checkup.id}`, admin.token, { status: 'approved', meeting_link: link, meeting_time: 'Tomorrow 10 am' });
  assert.ok((await approve('https://meet.google.com/aaa-bbbb-ccc')).success);
  assert.ok((await approve('https://zoom.us/j/123456')).success, 'the link can be changed after approval');
  assert.equal((await t.api('GET', '/checkups/mine', asker.token)).checkups.find((c) => c.id === checkup.id).meeting_link, 'https://zoom.us/j/123456');
  assert.ok((await t.api('GET', '/notifications', asker.token)).notifications.some((n) => n.type === 'checkup_status' && n.title.includes('updated')));
  assert.equal((await t.api('DELETE', `/admin/checkups/${checkup.id}`, asker.token)).status, 403);
  assert.ok((await t.api('DELETE', `/admin/checkups/${checkup.id}`, admin.token)).success);
  assert.equal((await t.api('GET', '/checkups/mine', asker.token)).checkups.some((c) => c.id === checkup.id), false);
});
