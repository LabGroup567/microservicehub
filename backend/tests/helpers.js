// Shared test helpers. Tests run against a throwaway database so your real data is never touched.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'micro_service_hub_test';
process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'memory';
process.env.SMS_TRANSPORT = 'memory';

const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { io } = require('socket.io-client');

async function ensureTestDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT) || 3306,
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4`);
  await connection.end();
}

const PASSWORD = 'TestPassw0rd!';

/** Starts the real app on a random port. Returns helpers bound to that server. */
async function startTestServer() {
  await ensureTestDatabase();

  const db = require('../db');
  const { startServer } = require('../server');
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, token, body) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json().catch(() => ({}))) };
  }

  // Creates a user through the real register endpoint.
  async function register(role, label = role) {
    const id = crypto.randomBytes(4).toString('hex');
    const email = `${label}.${id}@test.local`;
    const result = await api('POST', '/register', null, {
      full_name: `Test ${label} ${id}`,
      email,
      password: PASSWORD,
      role,
      phone: '01711111111',
    });
    if (!result.success) throw new Error(`register failed: ${JSON.stringify(result)}`);
    return { ...result.user, token: result.token, email, password: PASSWORD };
  }

  // Marks a user as having passed NID verification (what an admin approval does).
  async function verify(user) {
    await db.query("UPDATE users SET kyc_status = 'verified', nid_status = 'verified' WHERE id = ?", [user.id]);
  }

  async function makeAdmin() {
    const user = await register('seeker', 'admin');
    await db.query("UPDATE users SET role = 'admin', admin_level = 'full', is_main_admin = 1, kyc_status = 'verified' WHERE id = ?", [user.id]);
    const login = await api('POST', '/login', null, { email: user.email, password: PASSWORD });
    return { ...login.user, token: login.token };
  }

  async function category() {
    // A seeded category, never one a test created (those may be left behind by other tests).
    const { categories } = await api('GET', '/categories');
    return (categories.find((c) => c.name === 'Delivery') || categories[0]).id;
  }

  function connectSocket(token) {
    return new Promise((resolve, reject) => {
      const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  }

  return { api, register, verify, makeAdmin, category, connectSocket, base, db, close };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

module.exports = { startTestServer, sleep, tomorrow, PASSWORD };
