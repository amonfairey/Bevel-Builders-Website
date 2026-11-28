import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
  retire_requested_by INTEGER, retire_requested_at TEXT, supersedes INTEGER);
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
CREATE TABLE IF NOT EXISTS files(
  hash TEXT PRIMARY KEY, family_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  size INTEGER NOT NULL, data BLOB NOT NULL, uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL);
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
  decided_by INTEGER, decided_at TEXT, decision_note TEXT, retire_requested_by INTEGER, retire_requested_at TEXT);
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
CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id);
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(family_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_feed_events ON feed_events(feed_id, start_ms);
`;

// Hard protections: records that may be used as evidence cannot be changed or
// deleted through SQL either (short of dropping the triggers, which the hash
// chain would still expose).
const IMMUTABLE_TRIGGERS = ['messages', 'notes', 'audit'].map(t => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} are append-only'); END;`).join('\n');

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.exec(IMMUTABLE_TRIGGERS);
  return db;
}

export const nowIso = () => new Date().toISOString();
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const token = (n = 24) => randomBytes(n).toString('base64url');
export const code = () => randomBytes(5).toString('hex').toUpperCase();

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const got = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, got);
}

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
  return { ok: problems.length === 0, entries: rows.length, head: prev, problems };
}
