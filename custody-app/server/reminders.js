// Exchange reminders: a day-before and an hour-before notice for every custody hand-off,
// sent to both parents. Runs every 5 minutes in production; tests call the sweep directly.
import { transitions } from './schedule.js';
import { addDays, utcToLocalDate } from './time.js';
import { isDeletedUser } from './account.js';
import { fmtTime } from './notify.js';

const MIN = 60000, DAY = 24 * 60 * MIN;

export function createReminderSweep({ db, api, notifier, logger = console }) {
  const q = (sql) => db.prepare(sql);

  /** Returns how many reminders (one per exchange, sent to every parent) went out. */
  function sweepReminders(nowMs = Date.now()) {
    let sent = 0;
    try { q('DELETE FROM reminders_sent WHERE at_ms < ?').run(nowMs - 2 * DAY); } catch (e) { logger.error('reminders: cleanup failed', e.message); }
    for (const { id } of q('SELECT id FROM families ORDER BY id').all()) {
      try { sent += sweepFamily(id, nowMs); } catch (e) { logger.error(`reminders: family ${id} failed`, e.message); }
    }
    return sent;
  }

  function sweepFamily(familyId, nowMs) {
    const c = api.helpers.familyCtx(familyId);
    if (!c) return 0;
    const parents = c.members.filter(m => m.role === 'parent' && !isDeletedUser(m)).map(m => m.id);
    if (!parents.length) return 0;
    // A hand-off needs two parents: a family that never had a co-parent has none, so it costs the sweep nothing.
    if (c.allParents.length < 2) return 0;
    const from = addDays(utcToLocalDate(nowMs, c.tz), -1), to = addDays(utcToLocalDate(nowMs + DAY, c.tz), 2);
    const due = transitions(api.helpers.timelineFor(c, from, to).timeline)
      .filter(t => t.at > nowMs && t.at <= nowMs + DAY && t.from != null && t.to != null);
    const mark = q('INSERT OR IGNORE INTO reminders_sent(family_id, at_ms, kind) VALUES(?,?,?)');
    let sent = 0;
    for (const t of due) {
      const mins = (t.at - nowMs) / MIN;
      const kind = mins <= 60 ? 'hour' : 'day';
      if (!mark.run(familyId, t.at, kind).changes) continue; // already reminded
      const title = kind === 'hour'
        ? (mins > 45 ? 'Exchange in 1 hour' : `Exchange in ${Math.max(1, Math.round(mins))} minutes`)
        : (utcToLocalDate(t.at, c.tz) === utcToLocalDate(nowMs, c.tz) ? 'Exchange today' : 'Exchange tomorrow');
      notifier.notify({ familyId, userIds: parents, kind: 'exchange_reminder', link: 'calendar', entity: 'exchange', entityId: t.at,
        title, body: `${api.helpers.nameOf(c, t.from)} → ${api.helpers.nameOf(c, t.to)} at ${fmtTime(t.at, c.tz)}` });
      sent++;
    }
    return sent;
  }

  return sweepReminders;
}
