// A brand-new server on an EMPTY database: this is what a first deployment looks like.
process.env.TEST_DB_NAME = 'micro_service_hub_test_fresh';
process.env.INITIAL_ADMIN_EMAIL = 'owner@test.local';
process.env.INITIAL_ADMIN_PASSWORD = 'OwnerPassw0rd!';
process.env.INITIAL_ADMIN_NAME = 'Site Owner';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { startTestServer } = require('./helpers');

let t;

before(async () => {
  // Start from nothing, even if an earlier run left the database behind.
  const admin = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', port: Number(process.env.DB_PORT) || 3306 });
  await admin.query(`DROP DATABASE IF EXISTS \`${process.env.TEST_DB_NAME}\``);
  await admin.end();

  t = await startTestServer();
});

after(async () => {
  await t.db.query('SELECT 1');
  const admin = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', port: Number(process.env.DB_PORT) || 3306 });
  await t.close();
  await admin.query(`DROP DATABASE IF EXISTS \`${process.env.TEST_DB_NAME}\``);
  await admin.end();
});

test('an empty database is turned into a complete schema with starter categories', async () => {
  const [tables] = await t.db.query('SHOW TABLES');
  const names = tables.map((row) => Object.values(row)[0]);

  for (const table of ['users', 'services', 'applications', 'provider_services', 'bookings', 'categories', 'reviews',
    'messages', 'notifications', 'reports', 'payments', 'kyc_documents', 'push_subscriptions', 'auth_tokens', 'admin_invites']) {
    assert.ok(names.includes(table), `${table} table exists`);
  }

  const { categories } = await t.api('GET', '/categories');
  assert.ok(categories.length >= 6, 'starter categories were added');
});

test('the main admin is created from the environment on first start', async () => {
  const login = await t.api('POST', '/login', null, { email: 'owner@test.local', password: 'OwnerPassw0rd!' });
  assert.ok(login.success);
  assert.equal(login.user.role, 'admin');
  assert.equal(login.user.is_main_admin, true);
  assert.equal(login.user.email_verified, true);
  assert.ok((await t.api('GET', '/admin/admins', login.token)).success, 'and has main admin powers');
});

test('the bootstrap only runs while there is no admin', async () => {
  const { ensureInitialAdmin } = require('../bootstrap');

  process.env.INITIAL_ADMIN_EMAIL = 'intruder@test.local';
  process.env.INITIAL_ADMIN_PASSWORD = 'IntruderPass123!';
  assert.equal(await ensureInitialAdmin(), false);
  assert.equal((await t.api('POST', '/login', null, { email: 'intruder@test.local', password: 'IntruderPass123!' })).status, 401);

  const [[count]] = await t.db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
  assert.equal(count.c, 1);
});

test('NID photos are stored in the database, not on the server disk', async () => {
  const user = await t.register('provider');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);

  const form = new FormData();
  form.set('full_name', 'Fresh Person');
  form.set('nid_number', '1234567890123');
  form.set('dob', '1990-01-01');
  ['nid_front', 'nid_back', 'selfie'].forEach((name) => form.set(name, new Blob([png], { type: 'image/png' }), `${name}.png`));

  const response = await fetch(`${t.base}/api/kyc`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: form });
  assert.equal(response.status, 201);

  const [rows] = await t.db.query('SELECT doc_type, mime, file_name, LENGTH(data) AS bytes FROM kyc_documents WHERE user_id = ?', [user.id]);
  assert.equal(rows.length, 3);
  rows.forEach((row) => {
    assert.equal(row.mime, 'image/png');
    assert.equal(row.file_name, null, 'no file name: nothing was written to disk');
    assert.ok(row.bytes > 2000);
  });

  const served = await fetch(`${t.base}/api/kyc/file/${user.id}/selfie`, { headers: { Authorization: `Bearer ${user.token}` } });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await served.arrayBuffer()).byteLength, png.length, 'the same bytes come back');
});
