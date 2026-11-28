// Account self-service: change password, delete account.
// Deletion is required in-app by Apple (App Store Review Guideline 5.1.1(v)).
import { bad, HttpError } from './http.js';
import { audit, hashPassword, verifyPassword, token, code, IMMUTABLE_TRIGGERS, DROP_IMMUTABLE_TRIGGERS } from './db.js';

/** Anonymized accounts keep their row (so authorship still resolves) under an address no one can register. */
export const deletedEmail = (id) => `deleted-${id}@invalid`;
export const isDeletedUser = (u) => u.email === deletedEmail(u.id);

// Every table holding family rows, children before parents (foreign keys).
// feed_events and message_reads have no family_id and are deleted through their parents first.
const FAMILY_TABLES = ['messages', 'threads', 'notes', 'audit', 'files', 'payments', 'expenses', 'calls', 'call_rules',
  'exchanges', 'events', 'rules', 'feeds', 'children', 'notifications', 'reminders_sent'];

export function accountRoutes(r, { db, notifier }) {
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => { db.exec('BEGIN'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // Wrong-password attempts per user, so a stolen session can't be used to guess the password.
  const attempts = new Map();
  function checkPassword(c, pw, msg) {
    const now = Date.now();
    const a = (attempts.get(c.user.id) || []).filter(t => now - t < 15 * 60000);
    if (a.length >= 8) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    if (!verifyPassword(String(pw ?? ''), c.user.pass)) { a.push(now); attempts.set(c.user.id, a); throw bad(msg); }
    attempts.delete(c.user.id);
  }

  /** Personal rows that never outlive the account: sign-ins, devices, report links, imported calendars, inbox. */
  function deletePersonalRows(uid) {
    q('DELETE FROM push_tokens WHERE user_id = ?').run(uid);
    q('DELETE FROM sessions WHERE user_id = ?').run(uid);
    q('DELETE FROM report_links WHERE user_id = ?').run(uid);
    q('DELETE FROM feed_events WHERE feed_id IN (SELECT id FROM feeds WHERE user_id = ?)').run(uid);
    q('DELETE FROM feeds WHERE user_id = ?').run(uid);
    q('DELETE FROM notifications WHERE user_id = ?').run(uid);
  }

  r.post('/api/account/password', ({ c, body, sessionToken }) => {
    checkPassword(c, body.current, 'Current password is wrong');
    const next = String(body.next ?? '');
    if (next.length < 10) throw bad('New password must be at least 10 characters');
    tx(() => {
      q('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(next), c.user.id);
      // Sign out every other device (and stop pushing to them); keep the session making this request.
      q('DELETE FROM push_tokens WHERE user_id = ? AND (session_token IS NULL OR session_token <> ?)').run(c.user.id, sessionToken);
      q('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(c.user.id, sessionToken);
      q('DELETE FROM report_links WHERE user_id = ?').run(c.user.id);
      if (c.family) audit(db, c.family.id, c.user.id, 'change_password', 'user', c.user.id, {});
    });
    return { ok: true };
  });

  r.post('/api/account/delete', ({ c, body, clearCookie }) => {
    checkPassword(c, body.password, 'Password is wrong');
    const remaining = c.family ? c.members.filter(m => m.id !== c.user.id && !isDeletedUser(m)) : [];
    if (remaining.length) anonymize(c);
    else purge(c);
    clearCookie();
    return { ok: true };
  });

  // A co-parent or viewer remains: messages, notes and approvals this user took part in are also
  // the other parent's records, so the person is anonymized rather than erased.
  function anonymize(c) {
    const uid = c.user.id, role = c.member.role, name = c.user.name, fid = c.family.id;
    tx(() => {
      deletePersonalRows(uid);
      q('UPDATE users SET name = ?, email = ?, pass = ?, ics_token = ? WHERE id = ?')
        .run('Deleted user', deletedEmail(uid), hashPassword(token(32)), token(), uid);
      // Parents keep their members row so authorship of past records still resolves; viewers authored nothing.
      if (role === 'viewer') q('DELETE FROM members WHERE user_id = ?').run(uid);
      // A deleted parent no longer holds a parent place: a fresh invite code lets a new co-parent join
      // (the old code was consumed when this parent joined). Shown to the remaining parent in Settings.
      if (role === 'parent') q('UPDATE families SET invite_code = ? WHERE id = ?').run(code(), fid);
      audit(db, fid, uid, 'delete_account', 'member', uid, { role });
    });
    const parents = c.members.filter(m => m.role === 'parent' && m.id !== uid && !isDeletedUser(m)).map(m => m.id);
    if (parents.length) {
      notifier.notify({ familyId: fid, userIds: parents, kind: 'member_left', link: 'settings', entity: 'member', entityId: uid,
        title: `${name} deleted their account`,
        body: role === 'parent' ? 'Their past messages and records stay in your family history.' : 'They no longer have view-only access.' });
    }
  }

  // Nobody else remains: erase the whole family, including the append-only tables. The triggers that block
  // UPDATE/DELETE are dropped and re-created with the same SQL inside one transaction (SQLite DDL is transactional),
  // so they can never be left missing.
  function purge(c) {
    const uid = c.user.id;
    tx(() => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      db.exec(DROP_IMMUTABLE_TRIGGERS);
      if (c.family) {
        const fid = c.family.id;
        const memberIds = q('SELECT user_id FROM members WHERE family_id = ?').all(fid).map(x => x.user_id);
        // Anonymized ex-viewers of this family (members row already gone) who exist only in its records.
        const exViewers = q(`SELECT DISTINCT u.id FROM audit a JOIN users u ON u.id = a.user_id
          WHERE a.family_id = ? AND u.email = 'deleted-' || u.id || '@invalid' AND NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id)`).all(fid).map(x => x.id);
        q('DELETE FROM feed_events WHERE feed_id IN (SELECT id FROM feeds WHERE family_id = ?)').run(fid);
        q('DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE family_id = ?)').run(fid);
        for (const t of FAMILY_TABLES) q(`DELETE FROM ${t} WHERE family_id = ?`).run(fid);
        // Any table added later with a family_id column is covered too.
        for (const t of familyTables()) if (!FAMILY_TABLES.includes(t) && t !== 'members') q(`DELETE FROM "${t}" WHERE family_id = ?`).run(fid);
        for (const id of memberIds) deletePersonalRows(id);
        q('DELETE FROM members WHERE family_id = ?').run(fid);
        q('DELETE FROM families WHERE id = ?').run(fid);
        for (const id of [...memberIds, ...exViewers]) if (id !== uid) q('DELETE FROM users WHERE id = ?').run(id);
      }
      db.exec(IMMUTABLE_TRIGGERS);
      deletePersonalRows(uid);
      q('DELETE FROM users WHERE id = ?').run(uid);
    });
  }

  function familyTables() {
    return q("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(x => x.name)
      .filter(t => q(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all().some(col => col.name === 'family_id'));
  }
}
