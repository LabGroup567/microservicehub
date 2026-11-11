// Usage: npm run backup
// Saves the whole database (and the private KYC photos) into backend/backups/.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

function findTool(name) {
  if (name === 'mysqldump' && process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;

  const xampp = `C:\\xampp\\mysql\\bin\\${name}.exe`;
  return fs.existsSync(xampp) ? xampp : name; // otherwise rely on PATH
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function prune(prefix, isDirectory) {
  const entries = fs
    .readdirSync(BACKUPS)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .reverse();

  entries.slice(KEEP).forEach((name) => fs.rmSync(path.join(BACKUPS, name), { recursive: isDirectory, force: true }));
}

async function main() {
  const database = process.env.DB_NAME || 'micro_service_hub';
  const time = stamp();

  fs.mkdirSync(BACKUPS, { recursive: true });

  const sqlFile = path.join(BACKUPS, `${database}-${time}.sql`);
  const out = fs.createWriteStream(sqlFile);

  const dump = spawn(
    findTool('mysqldump'),
    [
      '-h', process.env.DB_HOST || 'localhost',
      '-P', String(process.env.DB_PORT || 3306),
      '-u', process.env.DB_USER || 'root',
      '--single-transaction',
      '--routines',
      '--default-character-set=utf8mb4',
      database,
    ],
    // The password goes through the environment so it never shows up in process lists.
    { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } }
  );

  dump.stdout.pipe(out);

  let errors = '';
  dump.stderr.on('data', (chunk) => {
    errors += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', resolve);
  });

  if (code !== 0) {
    fs.rmSync(sqlFile, { force: true });
    throw new Error(errors.trim() || `mysqldump exited with code ${code}`);
  }

  console.log(`Database saved: ${path.relative(ROOT, sqlFile)} (${(fs.statSync(sqlFile).size / 1024).toFixed(0)} KB)`);

  const uploads = path.join(ROOT, 'uploads');
  if (fs.existsSync(uploads)) {
    const target = path.join(BACKUPS, `uploads-${time}`);
    fs.cpSync(uploads, target, { recursive: true });
    console.log(`KYC photos copied: ${path.relative(ROOT, target)}`);
  }

  prune(`${database}-`, false);
  prune('uploads-', true);
  console.log(`Keeping the newest ${KEEP} backups.`);
}

main().catch((error) => {
  console.error('Backup failed:', error.message);
  console.error('Make sure MySQL is running. If mysqldump is not found, set MYSQLDUMP_PATH in backend/.env.');
  process.exit(1);
});
