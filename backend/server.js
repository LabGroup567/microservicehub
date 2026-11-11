const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: [path.join(__dirname, '.env'), '.env'] });
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const { ensureSchema } = require('./migrate');
const { ensureInitialAdmin } = require('./bootstrap');
const { initPush } = require('./push');
const { HttpError } = require('./helpers');
const realtime = require('./realtime');

const PORT = Number(process.env.PORT) || 5000;

const app = express();

// When the frontend has been built (npm run build), serve it from this server too.
const DIST = path.join(__dirname, '..', 'dist');
const hasFrontend = fs.existsSync(path.join(DIST, 'index.html'));

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

const ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
];

// CSP is left off because the app loads Google sign-in and OpenStreetMap tiles.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: ORIGINS }));
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please slow down.' },
  })
);
app.use(express.json({ limit: '100kb' }));

if (!hasFrontend) {
  app.get('/', (req, res) => {
    res.json({ message: 'Micro-Service Hub API is running!' });
  });
}

app.get('/api/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ success: true, message: 'MySQL connected successfully!' });
});

// Public client configuration (the Google client ID is not a secret).
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    google_client_id: process.env.GOOGLE_CLIENT_ID || '',
    sms_available: require('./sms').smsAvailable(),
  });
});

app.use('/api', require('./routes/account'));
app.use('/api', require('./routes/recovery'));
app.use('/api', require('./routes/work'));
app.use('/api', require('./routes/listings'));
app.use('/api', require('./routes/social'));
app.use('/api', require('./routes/push'));
app.use('/api', require('./routes/location'));
app.use('/api', require('./routes/payments'));
app.use('/api', require('./routes/kyc'));
app.use('/api', require('./routes/images'));
app.use('/api', require('./routes/marketplace'));
app.use('/api', require('./routes/extras'));
app.use('/api', require('./routes/portfolio'));
app.use('/api', require('./routes/presence'));
app.use('/api', require('./routes/explore'));
app.use('/api', require('./routes/blood'));
app.use('/api', require('./routes/emergency'));
app.use('/api', require('./routes/admin'));

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

if (hasFrontend) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Central error handler: known errors keep their message, anything else is
// logged and hidden behind a generic 500.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  }

  console.error(`${req.method} ${req.originalUrl}:`, error);
  res.status(500).json({ success: false, message: 'Something went wrong on the server.' });
});

// Creates the database schema and returns a listening HTTP server.
async function startServer(port = PORT) {
  await db.query('SELECT 1');
  console.log('MySQL connected successfully!');

  await ensureSchema();
  console.log('Database schema is up to date.');

  await ensureInitialAdmin();
  await initPush();

  const server = http.createServer(app);
  realtime.init(server, ORIGINS);

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`Backend running at http://localhost:${server.address().port}`);
  return server;
}

module.exports = { app, startServer };

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Startup error:', error.message);
    process.exit(1);
  });
}
