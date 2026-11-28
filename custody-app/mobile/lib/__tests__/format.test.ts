// Run with: npm test   (node --experimental-strip-types --test lib/__tests__/*.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, daySegments, dayMs, diffDays, dow, fmtClock, fmtDate, fmtDT, fmtT, localOf, localToMs, money,
  nowLocalStamp, ownerAt, stampToMs, todayLocal, zonedParts,
} from '../format.ts';
import { linkToRoute, routes as routesForTest } from '../routes.ts';
import type { TimelineInterval } from '../types.ts';

const LA = 'America/Los_Angeles';
// Node's ICU puts a narrow no-break space (U+202F) before AM/PM; normalize for assertions.
const norm = (s: string) => s.replace(/[  ]/g, ' ');
const src = { type: 'pattern' as const, id: 1, name: 'Regular schedule' };

test('dayMs: local midnight in Los Angeles across the spring-forward change (2026-03-08)', () => {
  assert.equal(dayMs('2026-03-07', LA), Date.UTC(2026, 2, 7, 8, 0)); // PST, UTC-8
  assert.equal(dayMs('2026-03-08', LA), Date.UTC(2026, 2, 8, 8, 0)); // still PST at midnight
  assert.equal(dayMs('2026-03-09', LA), Date.UTC(2026, 2, 9, 7, 0)); // PDT, UTC-7
  assert.equal((dayMs('2026-03-09', LA) - dayMs('2026-03-08', LA)) / 3600000, 23);
});

test('dayMs: the fall-back day (2026-11-01) is 25 hours long', () => {
  assert.equal(dayMs('2026-11-01', LA), Date.UTC(2026, 10, 1, 7, 0));
  assert.equal(dayMs('2026-11-02', LA), Date.UTC(2026, 10, 2, 8, 0));
  assert.equal((dayMs('2026-11-02', LA) - dayMs('2026-11-01', LA)) / 3600000, 25);
});

test('localToMs keeps a 6:00 PM exchange at 6:00 PM on both sides of DST', () => {
  const before = localToMs('2026-03-06', '18:00', LA);
  const after = localToMs('2026-03-13', '18:00', LA);
  assert.equal(before, Date.UTC(2026, 2, 7, 2, 0));
  assert.equal(after, Date.UTC(2026, 2, 14, 1, 0));
  assert.deepEqual(localOf(before, LA), { date: '2026-03-06', time: '18:00' });
  assert.deepEqual(localOf(after, LA), { date: '2026-03-13', time: '18:00' });
  assert.equal(norm(fmtT(after, LA)), '6:00 PM');
  assert.equal(stampToMs('2026-03-13T18:00', LA), after);
});

test('localToMs agrees with server/time.js, including times inside the DST gap and overlap', async (t) => {
  let server: { localToUtc: (d: string, t: string, tz: string) => number; utcToLocalStamp: (ms: number, tz: string) => string };
  try {
    server = await import(new URL('../../../server/time.js', import.meta.url).href);
  } catch {
    t.skip('server/time.js not found next to the mobile app');
    return;
  }
  const zones = [LA, 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata', 'UTC'];
  const dates = ['2026-01-15', '2026-03-08', '2026-03-29', '2026-04-05', '2026-10-04', '2026-10-25', '2026-11-01', '2026-12-31'];
  const times = ['00:00', '01:30', '02:00', '02:30', '03:00', '06:00', '18:00', '23:59'];
  for (const tz of zones) for (const d of dates) for (const tm of times) {
    const mine = localToMs(d, tm, tz);
    assert.equal(mine, server.localToUtc(d, tm, tz), `${d} ${tm} ${tz}`);
    const l = localOf(mine, tz);
    assert.equal(`${l.date}T${l.time}`, server.utcToLocalStamp(mine, tz), `round trip ${d} ${tm} ${tz}`);
  }
  // 2:30 AM does not exist on 2026-03-08 in Los Angeles; both implementations resolve it the same way.
  const gap = localToMs('2026-03-08', '02:30', LA);
  assert.ok(['01:30', '03:30'].includes(localOf(gap, LA).time));
});

test('daySegments splits the 23-hour DST day correctly', () => {
  const x = localToMs('2026-03-08', '18:00', LA);
  const timeline: TimelineInterval[] = [
    { start: dayMs('2026-03-01', LA), end: x, parent: 1, src },
    { start: x, end: dayMs('2026-03-15', LA), parent: 2, src },
  ];
  const segs = daySegments(timeline, '2026-03-08', LA);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].parent, 1);
  assert.equal(segs[1].parent, 2);
  // 00:00-18:00 is 17 real hours on this day (2 AM is skipped), 18:00-24:00 is 6.
  assert.ok(Math.abs(segs[0].frac - 17 / 23) < 1e-9, `frac ${segs[0].frac}`);
  assert.ok(Math.abs(segs[1].frac - 6 / 23) < 1e-9);
  assert.equal(norm(segs[0].label), '12:00 AM–6:00 PM');
  assert.equal(norm(segs[1].label), '6:00 PM–12:00 AM');
  assert.equal(segs[0].start, dayMs('2026-03-08', LA));
  assert.equal(segs[1].end, dayMs('2026-03-09', LA));
});

test('daySegments: a whole day with one parent is a single full segment; days outside are empty', () => {
  const timeline: TimelineInterval[] = [{ start: dayMs('2026-11-01', LA), end: dayMs('2026-11-02', LA), parent: 7, src }];
  const segs = daySegments(timeline, '2026-11-01', LA);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].frac, 1);
  assert.equal(daySegments(timeline, '2026-11-02', LA).length, 0);
  assert.equal(ownerAt(timeline, localToMs('2026-11-01', '01:30', LA)), 7);
  assert.equal(ownerAt(timeline, dayMs('2026-11-02', LA)), null);
});

test('todayLocal / nowLocalStamp use the family zone, not UTC', () => {
  const now = Date.UTC(2026, 0, 2, 5, 30); // Jan 2 05:30 UTC = Jan 1 21:30 in LA
  assert.equal(todayLocal(LA, now), '2026-01-01');
  assert.equal(nowLocalStamp(LA, now), '2026-01-01T21:30');
  assert.equal(todayLocal('Asia/Tokyo', now), '2026-01-02');
  assert.deepEqual(zonedParts(now, 'UTC'), { y: 2026, m: 1, d: 2, h: 5, min: 30, s: 0 });
});

test('civil date arithmetic and labels', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(diffDays('2026-03-09', '2026-03-08'), 1);
  assert.equal(dow('2026-03-08'), 0);
  assert.equal(fmtDate('2026-03-08'), 'Sun, Mar 8, 2026');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(fmtClock('00:05'), '12:05 AM');
  assert.equal(fmtClock('18:00'), '6:00 PM');
  assert.equal(norm(fmtDT(Date.UTC(2026, 2, 14, 1, 0), LA)), 'Fri, Mar 13, 6:00 PM');
  assert.equal(money(1250), '$12.50');
  assert.equal(money(-300), '-$3.00');
});

test('notification links map to app routes', () => {
  assert.equal(linkToRoute('dashboard'), '/');
  assert.equal(linkToRoute('expenses'), '/money');
  assert.equal(linkToRoute('messages/42'), '/thread/42');
  assert.equal(linkToRoute('messages'), '/messages');
  assert.equal(linkToRoute('settings'), '/settings');
  assert.equal(linkToRoute('/calendar/'), '/calendar');
  // API.md: clients fall back to the dashboard for anything they don't recognise
  assert.equal(linkToRoute('nonsense'), '/');
  assert.equal(linkToRoute('messages/abc'), '/');
  assert.equal(linkToRoute('expenses/7'), '/');
  assert.equal(linkToRoute(''), '/');
  assert.equal(linkToRoute(null), '/');
  assert.equal(linkToRoute(undefined), '/');
  assert.equal(routesForTest.newExpense({ eventId: 3, description: 'Cleats & socks', amount: 40 }), '/expense/new?eventId=3&description=Cleats%20%26%20socks&amount=40');
  assert.equal(routesForTest.editActivity(), '/activities/edit');
  assert.equal(routesForTest.scheduleChange('2026-03-08'), '/schedule/change?date=2026-03-08');
});
