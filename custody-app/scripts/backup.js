// Online backup of the SQLite database. Safe while the server is running:
// VACUUM INTO writes a consistent, compacted snapshot without blocking writers for long.
//
//   npm run backup
//
// Env: DB_PATH (default data/coparent.db), BACKUP_DIR (default <db folder>/backups),
//      BACKUP_KEEP (keep only the newest N backups; default 0 = keep all).
// Output: <BACKUP_DIR>/coparent-<UTC timestamp>.db, e.g. data/backups/coparent-20261128T153000Z.db
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropPrivileges } from '../server/privileges.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(process.env.DB_PATH || join(ROOT, 'data', 'coparent.db'));
const outDir = resolve(process.env.BACKUP_DIR || join(dirname(dbPath), 'backups'));
const keep = Math.max(0, parseInt(process.env.BACKUP_KEEP || '0', 10) || 0);

// `docker exec <container> npm run backup` runs as root: switch to the server's user first, so the backup
// (and any -wal/-shm file SQLite creates) stays owned by it.
dropPrivileges(dirname(dbPath));

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath} (set DB_PATH)`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20261128T153000Z
const out = join(outDir, `coparent-${stamp}.db`);

const src = new DatabaseSync(dbPath);
try {
  src.prepare('VACUUM INTO ?').run(out);
} finally {
  src.close();
}

// Check the copy before calling it a backup.
const copy = new DatabaseSync(out, { readOnly: true });
const integrity = copy.prepare('PRAGMA integrity_check').get();
const families = copy.prepare('SELECT COUNT(*) n FROM families').get().n;
copy.close();
const result = Object.values(integrity)[0];
if (result !== 'ok') {
  console.error(`Backup ${out} failed its integrity check: ${result}`);
  process.exit(1);
}
console.log(`Backup written: ${out} (${statSync(out).size} bytes, ${families} families, integrity ok)`);

if (keep > 0) {
  const old = readdirSync(outDir).filter(f => /^coparent-\d{8}T\d{6}Z\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) { rmSync(join(outDir, f)); console.log(`Removed old backup ${f}`); }
}
