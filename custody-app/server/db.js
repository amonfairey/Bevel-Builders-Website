import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL,
  ics_token TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS families(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL, default_split INTEGER NOT NULL DEFAULT 50,
  invite_code TEXT UNIQUE, viewer_code TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(
  family_id INTEGER NOT NULL REFERENCES families(id), user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('parent','viewer')), color TEXT NOT NULL, joined_at TEXT NOT NULL,
  PRIMARY KEY(family_id, user_id));
CREATE TABLE IF NOT EXISTS children(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), name TEXT NOT NULL, birthdate TEXT,
  info TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id),
  type TEXT NOT NULL CHECK(type IN ('default','pattern','holiday','override')), name TEXT NOT NULL,
  config TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL,
  decided_by INTEGER, decided_at TEXT, decision_note TEXT,
  retire_requested_by INTEGER, retire_requested_at TEXT, supersedes INTEGER, ended_at INTEGER, effective_from INTEGER);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'activity', child_ids TEXT NOT NULL DEFAULT '[]',
  start_local TEXT NOT NULL, end_local TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  transport_parent INTEGER, recurrence TEXT, details TEXT NOT NULL DEFAULT '',
  cost_cents INTEGER, status TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
  responded_by INTEGER, responded_at TEXT, response_note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS feeds(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), user_id INTEGER NOT NULL,
  name TEXT NOT NULL, provider TEXT NOT NULL, url TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'me',
  last_sync TEXT, last_error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feed_events(
  id INTEGER PRIMARY KEY, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, uid TEXT NOT NULL,
  title TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, all_day INTEGER NOT NULL, location TEXT);
-- Keyed per family: the same bytes uploaded by two families are two separate rows (see migrate()).
CREATE TABLE IF NOT EXISTS files(
  hash TEXT NOT NULL, family_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  size INTEGER NOT NULL, data BLOB NOT NULL, uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(family_id, hash));
CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), description TEXT NOT NULL,
  category TEXT NOT NULL, amount_cents INTEGER NOT NULL, date TEXT NOT NULL, child_ids TEXT NOT NULL DEFAULT '[]',
  event_id INTEGER, paid_by INTEGER NOT NULL, other_share_pct INTEGER NOT NULL, receipt_hash TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, decision_note TEXT);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), from_user INTEGER NOT NULL,
  to_user INTEGER NOT NULL, amount_cents INTEGER NOT NULL, date TEXT NOT NULL, method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', expense_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  created_at TEXT NOT NULL, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), target_type TEXT NOT NULL,
  target_id TEXT NOT NULL, body TEXT NOT NULL, author INTEGER NOT NULL, created_at TEXT NOT NULL,
  attachment_hash TEXT, content_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), subject TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'general', created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id), family_id INTEGER NOT NULL,
  author INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_reads(
  message_id INTEGER NOT NULL REFERENCES messages(id), user_id INTEGER NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY(message_id, user_id));
CREATE TABLE IF NOT EXISTS call_rules(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), name TEXT NOT NULL,
  entitled_parent INTEGER NOT NULL, method TEXT NOT NULL, count INTEGER NOT NULL, period TEXT NOT NULL,
  duration_min INTEGER NOT NULL, window TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL,
  decided_by INTEGER, decided_at TEXT, decision_note TEXT, retire_requested_by INTEGER, retire_requested_at TEXT, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), rule_id INTEGER,
  child_ids TEXT NOT NULL DEFAULT '[]', started_local TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, method TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', logged_by INTEGER NOT NULL,
  created_at TEXT NOT NULL, confirm_result TEXT, confirmed_by INTEGER, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS exchanges(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), kind TEXT NOT NULL,
  at_ms INTEGER NOT NULL, scheduled_ms INTEGER, location TEXT NOT NULL DEFAULT '', lat REAL, lng REAL,
  accuracy REAL, child_ids TEXT NOT NULL DEFAULT '[]', details TEXT NOT NULL DEFAULT '',
  logged_by INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL,
  user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, data TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL, UNIQUE(family_id, seq));
-- Platform tables (web portal + iPhone app). All IF NOT EXISTS so an existing database file upgrades in place.
CREATE TABLE IF NOT EXISTS report_links(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL, entity TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT);
-- session_token ties a device registration to the sign-in that made it, so signing out (or a password change) stops pushes to that device.
CREATE TABLE IF NOT EXISTS push_tokens(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
  session_token TEXT REFERENCES sessions(token) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reminders_sent(family_id INTEGER NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(family_id, at_ms, kind));
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_session ON push_tokens(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_report_links_user ON report_links(user_id);
CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id);
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(family_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_feed_events ON feed_events(feed_id, start_ms);
`;

// Hard protections: records that may be used as evidence cannot be changed or
// deleted through SQL either (short of dropping the triggers, which the hash
// chain would still expose).
export const IMMUTABLE_TABLES = ['messages', 'notes', 'audit', 'exchanges'];
/** Columns of a call log fixed at creation (the other parent's agree/dispute columns are filled in later). */
export const CALL_FIXED_COLUMNS = ['rule_id', 'child_ids', 'started_local', 'duration_min', 'status', 'method', 'details', 'logged_by', 'created_at'];
export const IMMUTABLE_TRIGGERS = IMMUTABLE_TABLES.map(t => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are append-only'); END;`).join('\n') + `
CREATE TRIGGER IF NOT EXISTS calls_fixed_no_update BEFORE UPDATE OF ${CALL_FIXED_COLUMNS.join(', ')} ON calls BEGIN SELECT RAISE(ABORT, 'call logs cannot be edited'); END;
CREATE TRIGGER IF NOT EXISTS calls_no_delete BEFORE DELETE ON calls BEGIN SELECT RAISE(ABORT, 'call logs cannot be deleted'); END;`;

/** Only used by account deletion's family purge, inside a transaction that re-creates them (see account.js). */
export const DROP_IMMUTABLE_TRIGGERS = IMMUTABLE_TABLES.map(t => `DROP TRIGGER IF EXISTS ${t}_no_update; DROP TRIGGER IF EXISTS ${t}_no_delete;`).join('\n')
  + '\nDROP TRIGGER IF EXISTS calls_fixed_no_update; DROP TRIGGER IF EXISTS calls_no_delete;';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  db.exec(IMMUTABLE_TRIGGERS);
  return db;
}

/** In-place upgrades for database files created by older versions. Each step is idempotent. */
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all();
  const has = (t, c) => cols(t).some(x => x.name === c);
  const tx = (fn) => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // files: PRIMARY KEY(hash) -> PRIMARY KEY(family_id, hash). Copy into a new table and swap, in one transaction.
  const pk = cols('files').filter(x => x.pk > 0).map(x => x.name);
  if (pk.length === 1 && pk[0] === 'hash') {
    tx(() => {
      db.exec(`CREATE TABLE files_new(
        hash TEXT NOT NULL, family_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        size INTEGER NOT NULL, data BLOB NOT NULL, uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(family_id, hash));
        INSERT INTO files_new(hash, family_id, name, type, size, data, uploaded_by, created_at)
          SELECT hash, family_id, name, type, size, data, uploaded_by, created_at FROM files;
        DROP TABLE files;
        ALTER TABLE files_new RENAME TO files;`);
    });
  }

  // rules.ended_at / rules.effective_from / call_rules.ended_at (epoch ms). See schedule.js buildTimeline.
  tx(() => {
    if (!has('rules', 'ended_at')) {
      db.exec('ALTER TABLE rules ADD COLUMN ended_at INTEGER');
      // Items ended before this column existed: the time of their audit 'retire' (or 'approve_retire') entry.
      // Rows with no such entry stay NULL and are left out of the timeline, as before.
      const rows = db.prepare("SELECT id, family_id FROM rules WHERE status = 'retired'").all();
      const last = db.prepare(`SELECT MAX(ts) ts FROM audit WHERE family_id = ? AND entity = 'rule' AND entity_id = ? AND action IN ('retire', 'approve_retire')`);
      const upd = db.prepare('UPDATE rules SET ended_at = ? WHERE id = ?');
      for (const r of rows) { const ts = last.get(r.family_id, String(r.id))?.ts; if (ts) upd.run(Date.parse(ts), r.id); }
    }
    if (!has('rules', 'effective_from')) {
      db.exec('ALTER TABLE rules ADD COLUMN effective_from INTEGER');
      // When an existing primary-parent rule took effect: when it retired the previous one, else when it was
      // requested (if it started as "not yet confirmed"), else when it was approved.
      const rows = db.prepare("SELECT * FROM rules WHERE type = 'default' AND status IN ('active','unconfirmed','retired')").all();
      const retiredOthers = db.prepare(`SELECT MIN(ts) ts FROM audit WHERE family_id = ? AND action = 'retire' AND entity = 'rule' AND json_extract(data, '$.by_rule') = ?`);
      const requested = db.prepare(`SELECT json_extract(data, '$.status') s FROM audit WHERE family_id = ? AND action = 'request' AND entity = 'rule' AND entity_id = ?`);
      const upd = db.prepare('UPDATE rules SET effective_from = ? WHERE id = ?');
      for (const r of rows) {
        const viaRetire = retiredOthers.get(r.family_id, r.id)?.ts;
        const startedUnconfirmed = requested.get(r.family_id, String(r.id))?.s === 'unconfirmed';
        const iso = viaRetire || (startedUnconfirmed || !r.decided_at ? r.requested_at : r.decided_at);
        const ms = Date.parse(iso);
        if (Number.isFinite(ms)) upd.run(ms, r.id);
      }
    }
    if (!has('call_rules', 'ended_at')) {
      db.exec('ALTER TABLE call_rules ADD COLUMN ended_at INTEGER');
      const rows = db.prepare("SELECT id, family_id FROM call_rules WHERE status = 'retired'").all();
      const last = db.prepare(`SELECT MAX(ts) ts FROM audit WHERE family_id = ? AND entity = 'call_rule' AND entity_id = ? AND action IN ('retire', 'approve_retire')`);
      const upd = db.prepare('UPDATE call_rules SET ended_at = ? WHERE id = ?');
      for (const r of rows) { const ts = last.get(r.family_id, String(r.id))?.ts; if (ts) upd.run(Date.parse(ts), r.id); }
    }
  });
}

export const nowIso = () => new Date().toISOString();
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const token = (n = 24) => randomBytes(n).toString('base64url');

// Invite and viewer codes: 80 random bits as 16 base32 characters, stored grouped as XXXX-XXXX-XXXX-XXXX.
// (Before this version codes were 10 hex characters; those keep working, see normalizeCode.)
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export function code() {
  const bytes = randomBytes(10);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}
/** What a person typed (any case, spaces or dashes) -> the comparable form (no separators, upper case). */
export const normalizeCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);

// Passwords: scrypt (N=16384, r=8, p=1, 64-byte key), stored as scrypt$<salt hex>$<hash hex>.
// Async, so hashing never blocks the event loop for other requests.
const scryptAsync = (pw, salt, len) => new Promise((resolve, reject) => scrypt(pw, salt, len, (err, key) => (err ? reject(err) : resolve(key))));
export const scryptStats = { verifies: 0 };
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  scryptStats.verifies++;
  const [, saltHex = '', hashHex = ''] = String(stored).split('$');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length < 16) return false;
  const got = await scryptAsync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, got);
}
/** A fixed hash for unknown emails, so a login for an address with no account costs the same scrypt work. */
export const DUMMY_PASSWORD_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

/** Canonical JSON (sorted keys) so hashes are reproducible. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

const GENESIS = '0'.repeat(64);

function auditHash(e) {
  return sha256(canonical({ prev: e.prev_hash, seq: e.seq, ts: e.ts, family: e.family_id, user: e.user_id,
    action: e.action, entity: e.entity, entity_id: e.entity_id, data: e.data }));
}

/** Append an entry to the family's hash chain. */
export function audit(db, familyId, userId, action, entity, entityId, data = {}) {
  const last = db.prepare('SELECT seq, hash FROM audit WHERE family_id = ? ORDER BY seq DESC LIMIT 1').get(familyId);
  const e = {
    family_id: familyId, seq: last ? last.seq + 1 : 1, ts: nowIso(), user_id: userId ?? null,
    action, entity, entity_id: entityId == null ? null : String(entityId), data: canonical(data),
    prev_hash: last ? last.hash : GENESIS,
  };
  e.hash = auditHash(e);
  db.prepare(`INSERT INTO audit(family_id, seq, ts, user_id, action, entity, entity_id, data, prev_hash, hash)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(e.family_id, e.seq, e.ts, e.user_id, e.action, e.entity, e.entity_id, e.data, e.prev_hash, e.hash);
  return e;
}

const EXCHANGE_FIXED = ['family_id', 'kind', 'at_ms', 'scheduled_ms', 'location', 'lat', 'lng', 'accuracy', 'child_ids', 'details', 'logged_by', 'created_at'];
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
/** Hash of an exchange check-in as saved (every column is fixed at creation). */
export const exchangeHash = (row) => sha256(canonical(pick(row, EXCHANGE_FIXED)));
/** Hash of a call log's fixed columns (the other parent's agree/dispute answer is filled in later and audited separately). */
export const callHash = (row) => sha256(canonical(pick(row, ['family_id', ...CALL_FIXED_COLUMNS])));

/**
 * Verify the chain and cross-check that every message and note still matches
 * the content hash recorded when it was created.
 */
export function verifyFamily(db, familyId) {
  const rows = db.prepare('SELECT * FROM audit WHERE family_id = ? ORDER BY seq').all(familyId);
  const problems = [];
  let prev = GENESIS;
  rows.forEach((r, i) => {
    if (r.seq !== i + 1) problems.push(`Gap in sequence at entry ${i + 1}`);
    if (r.prev_hash !== prev) problems.push(`Entry ${r.seq} does not link to the previous entry`);
    if (auditHash(r) !== r.hash) problems.push(`Entry ${r.seq} contents were altered`);
    prev = r.hash;
  });
  const recorded = new Map();
  for (const r of rows) if (r.action === 'create' && (r.entity === 'message' || r.entity === 'note')) {
    recorded.set(`${r.entity}:${r.entity_id}`, JSON.parse(r.data).content_hash);
  }
  const check = (entity, list) => {
    for (const m of list) {
      const h = recorded.get(`${entity}:${m.id}`);
      if (!h) problems.push(`${entity} ${m.id} has no audit record`);
      else if (h !== m.content_hash || sha256(m.body) !== m.content_hash) problems.push(`${entity} ${m.id} text no longer matches its original hash`);
    }
  };
  check('message', db.prepare('SELECT id, body, content_hash FROM messages WHERE family_id = ?').all(familyId));
  check('note', db.prepare('SELECT id, body, content_hash FROM notes WHERE family_id = ?').all(familyId));

  // Exchange check-ins and call logs: a hash of the fields fixed at creation is recorded in the audit entry.
  // Rows logged before this version have no recorded hash and are counted as not content-checked.
  const recHash = new Map();
  for (const r of rows) if (r.action === 'create' && (r.entity === 'exchange' || r.entity === 'call')) {
    const h = JSON.parse(r.data).record_hash;
    if (h) recHash.set(`${r.entity}:${r.entity_id}`, h);
  }
  let unchecked = 0;
  const checkRecords = (entity, list, hashFn) => {
    for (const x of list) {
      const h = recHash.get(`${entity}:${x.id}`);
      if (!h) { unchecked++; continue; }
      if (hashFn(x) !== h) problems.push(`${entity} ${x.id} no longer matches the record saved when it was logged`);
    }
  };
  checkRecords('exchange', db.prepare('SELECT * FROM exchanges WHERE family_id = ?').all(familyId), exchangeHash);
  checkRecords('call', db.prepare('SELECT * FROM calls WHERE family_id = ?').all(familyId), callHash);
  return { ok: problems.length === 0, entries: rows.length, head: prev, problems, records_not_content_checked: unchecked };
}
