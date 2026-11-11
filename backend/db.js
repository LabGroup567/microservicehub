const mysql = require('mysql2/promise');

// Hosted MySQL services (Aiven, TiDB, Railway ...) require an encrypted connection.
// Set DB_SSL=true; add DB_SSL_CA (the provider's certificate text) if it gives you one.
function sslOptions() {
  if (process.env.DB_SSL !== 'true') return undefined;

  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
  };
}

module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'micro_service_hub',
  port: Number(process.env.DB_PORT) || 3306,
  ssl: sslOptions(),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  // Cloud databases drop idle connections; keep them alive so requests do not fail after a quiet spell.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});
