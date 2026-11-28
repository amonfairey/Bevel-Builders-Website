// In-app notification inbox + push fan-out. Shared by the web portal and the iPhone app.
// notify() writes the inbox rows synchronously (cheap) and sends push later, so a
// notification can never fail or slow down the API request that triggered it.
import { bad, HttpError } from './http.js';
import { nowIso } from './db.js';
import { PUSH_TOKEN_RE } from './push.js';

/** Where a notification takes the user. Both clients map these to their own screens. */
export const LINKS = ['dashboard', 'calendar', 'schedule', 'activities', 'expenses', 'messages', 'calls', 'exchanges', 'records', 'settings'];
export const isLink = (l) => LINKS.includes(l) || /^messages\/\d+$/.test(String(l));

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_TOKENS_PER_USER = 20;

// Display helpers for notification text (ICU puts a narrow no-break space before AM/PM; use a plain one).
const fmt = (opts) => new Intl.DateTimeFormat('en-US', opts);
const plain = (s) => s.replace(/[  ]/g, ' ');
/** UTC ms -> "6:00 PM" in the family time zone. */
export const fmtTime = (ms, tz) => plain(fmt({ timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms));
/** Local stamp 'YYYY-MM-DDTHH:MM' -> "Tue, Dec 1, 5:00 PM" (already local, so formatted as UTC). */
export function fmtLocal(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(stamp));
  if (!m) return String(stamp ?? '');
  return plain(fmt({ timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])));
}
export const money = (c) => `$${(c / 100).toFixed(2)}`;

export function createNotifier(db, push = null, { logger = console } = {}) {
  const q = (sql) => db.prepare(sql);
  const unreadCount = (userId) => q('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

  /**
   * Save one inbox row per recipient and queue push. Callers decide recipients
   * (never the actor, never viewers). Returns the new notification ids.
   */
  function notify({ familyId, userIds, kind, title, body = '', link, entity = null, entityId = null }) {
    const ids = [];
    try {
      if (!isLink(link)) throw new Error(`unknown link "${link}"`);
      const ins = q(`INSERT INTO notifications(family_id, user_id, kind, title, body, link, entity, entity_id, created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      const at = nowIso();
      for (const uid of new Set(userIds)) {
        ids.push(Number(ins.run(familyId, uid, kind, clip(title, 140), clip(body, 500), link, entity, entityId == null ? null : String(entityId), at).lastInsertRowid));
      }
    } catch (e) {
      logger.error('notify: could not save notification', e.message);
      return [];
    }
    if (ids.length && push?.enabled) {
      setImmediate(() => { dispatch(ids).catch(e => logger.error('notify: push dispatch failed', e.message)); });
    }
    return ids;
  }

  async function dispatch(ids) {
    // Re-read: a row whose surrounding transaction rolled back is not pushed.
    const rows = q(`SELECT * FROM notifications WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    // Only devices whose sign-in is still valid get pushes.
    const tokensFor = q('SELECT p.token FROM push_tokens p JOIN sessions s ON s.token = p.session_token WHERE p.user_id = ? AND s.expires > ?');
    const messages = [];
    for (const n of rows) {
      const tokens = tokensFor.all(n.user_id, Date.now());
      if (!tokens.length) continue;
      const badge = unreadCount(n.user_id);
      for (const { token } of tokens) {
        messages.push({ to: token, title: n.title, body: n.body, sound: 'default', badge, data: { link: n.link, notification_id: n.id } });
      }
    }
    await push.send(messages);
  }

  function list(userId, { limit, before } = {}) {
    const lim = Number.isInteger(+limit) && limit !== '' && limit != null ? Math.max(1, Math.min(200, +limit)) : 50;
    const b = Number.isInteger(+before) && +before > 0 ? +before : null;
    return q(`SELECT id, kind, title, body, link, entity, entity_id, created_at, read_at FROM notifications
      WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`).all(userId, b, b, lim);
  }

  function markRead(userId, { ids, all } = {}) {
    const at = nowIso();
    if (all === true) {
      q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, userId);
    } else if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length > 1000) throw bad('ids must be an array of notification ids');
      const upd = q('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
      for (const id of ids) if (Number.isInteger(+id)) upd.run(at, +id, userId);
    }
    return unreadCount(userId);
  }

  /** Opening a thread counts as reading its message notifications. */
  const markReadByLink = (userId, link) => q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND link = ? AND read_at IS NULL').run(nowIso(), userId, link);

  return { notify, list, markRead, markReadByLink, unreadCount };
}

export function notificationRoutes(r, { db, notifier }) {
  const q = (sql) => db.prepare(sql);

  r.get('/api/notifications', ({ c, query }) => notifier.list(c.user.id, query));
  r.post('/api/notifications/read', ({ c, body }) => ({ ok: true, unread: notifier.markRead(c.user.id, body) }));

  r.post('/api/push-tokens', ({ c, body, sessionToken }) => {
    const t = typeof body.token === 'string' ? body.token.trim() : '';
    if (t.length > 200 || !PUSH_TOKEN_RE.test(t)) throw bad('Not a valid Expo push token');
    if (!['ios', 'android'].includes(body.platform)) throw bad("platform must be 'ios' or 'android'");
    const now = nowIso(), uid = c.user.id;
    // A token registered to someone else moves only once that person's sign-in on it is gone (they signed out,
    // or the session expired). Otherwise anyone who learned a device token could redirect another user's pushes.
    const held = q(`SELECT p.user_id FROM push_tokens p JOIN sessions s ON s.token = p.session_token
      WHERE p.token = ? AND p.user_id <> ? AND s.expires > ?`).get(t, uid, Date.now());
    if (held) throw new HttpError(409, 'This device is registered to another signed-in account');
    // Upsert: a device that signs in as someone else (after the previous account signed out) now belongs to them.
    q(`INSERT INTO push_tokens(token, user_id, platform, created_at, last_seen, session_token) VALUES(?,?,?,?,?,?)
      ON CONFLICT(token) DO UPDATE SET created_at = CASE WHEN user_id = excluded.user_id THEN created_at ELSE excluded.created_at END,
        user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen, session_token = excluded.session_token`)
      .run(t, uid, body.platform, now, now, sessionToken);
    q('DELETE FROM push_tokens WHERE user_id = ? AND token NOT IN (SELECT token FROM push_tokens WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?)')
      .run(uid, uid, MAX_TOKENS_PER_USER);
    return { ok: true };
  });
  r.post('/api/push-tokens/remove', ({ c, body }) => {
    q('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(String(body.token ?? ''), c.user.id);
    return { ok: true };
  });
}
