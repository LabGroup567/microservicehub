// Usage: npm run restore -- backups/micro_service_hub-20261018-120000.sql --yes
// Replaces the contents of the database with a backup file.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findTool(name) {
  if (name === 'mysql' && process.env.MYSQL_PATH) return process.env.MYSQL_PATH;

  const xampp = `C:\\xampp\\mysql\\bin\\${name}.exe`;
  return fs.existsSync(xampp) ? xampp : name;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const confirmed = args.includes('--yes');
  const database = process.env.DB_NAME || 'micro_service_hub';

  if (!file) {
    const dir = path.join(__dirname, '..', 'backups');
    const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().reverse() : [];
    console.log('Usage: npm run restore -- backups/<file>.sql --yes');
    console.log(list.length ? `Available backups:\n  ${list.join('\n  ')}` : 'No backups found. Run: npm run backup');
    process.exit(1);
  }

  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);

  if (!confirmed) {
    console.log(`This replaces everything in the "${database}" database with ${path.basename(resolved)}.`);
    console.log('Add --yes to confirm.');
    process.exit(1);
  }

  const client = spawn(
    findTool('mysql'),
    ['-h', process.env.DB_HOST || 'localhost', '-P', String(process.env.DB_PORT || 3306), '-u', process.env.DB_USER || 'root', database],
    { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } }
  );

  fs.createReadStream(resolved).pipe(client.stdin);

  let errors = '';
  client.stderr.on('data', (chunk) => {
    errors += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    client.on('error', reject);
    client.on('close', resolve);
  });

  if (code !== 0) throw new Error(errors.trim() || `mysql exited with code ${code}`);
  console.log(`Restored ${path.basename(resolved)} into "${database}".`);
}

main().catch((error) => {
  console.error('Restore failed:', error.message);
  process.exit(1);
});
