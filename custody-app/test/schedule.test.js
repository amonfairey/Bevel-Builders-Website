import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, patternFromTemplate, timeShare, transitions, holidayOccurrence } from '../server/schedule.js';
import { localToUtc, utcToLocalStamp, easter, nthWeekday } from '../server/time.js';
import { parseIcs, buildIcs } from '../server/ics.js';
import { checkTone } from '../server/tone.js';

const TZ = 'America/Los_Angeles';
const A = 1, B = 2;
const def = { id: 1, type: 'default', status: 'active', config: { parent: A } };
const run = (rules, from, to) => {
  const fromMs = localToUtc(from, '00:00', TZ), toMs = localToUtc(to, '00:00', TZ);
  return buildTimeline({ rules, tz: TZ, fromMs, toMs });
};

test('holiday date rules', () => {
  assert.equal(nthWeekday(2026, 11, 4, 4), '2026-11-26'); // Thanksgiving 2026
  assert.equal(nthWeekday(2026, 5, 1, -1), '2026-05-25'); // Memorial Day
  assert.equal(easter(2027), '2027-03-28');
  assert.deepEqual(holidayOccurrence({ type: 'range', startMonth: 12, startDay: 20, endMonth: 1, endDay: 3 }, 2026), { startDate: '2026-12-20', endDate: '2027-01-03' });
});

test('default only: primary has 100%', () => {
  const tl = run([def], '2026-03-01', '2026-03-29');
  const s = timeShare(tl, TZ, '2026-03-01', '2026-03-29');
  assert.equal(s.pct[A], 100);
  assert.equal(s.overnights[A], 28);
});

test('alternating weekends: Fri 6pm - Sun 6pm every other week', () => {
  const pat = { id: 2, type: 'pattern', status: 'active', config: patternFromTemplate({ template: 'alternating_weekends', anchorDate: '2026-03-06', parentA: A, parentB: B }) };
  const tl = run([def, pat], '2026-03-02', '2026-03-30'); // 4 weeks, 2 weekends for B
  const s = timeShare(tl, TZ, '2026-03-02', '2026-03-30');
  assert.equal(s.overnights[B], 4);
  assert.equal(s.overnights[A], 24);
  // 2 weekends x 48h = 96h of 671h (DST spring-forward on Mar 8 removes an hour)
  assert.equal(Math.round(s.hours[B]), 95); // first weekend spans DST change
  const tr = transitions(tl);
  assert.equal(utcToLocalStamp(tr[0].at, TZ), '2026-03-06T18:00');
  assert.equal(utcToLocalStamp(tr[1].at, TZ), '2026-03-08T18:00'); // still 6pm local after DST
});

test('2-2-3 is 50/50 over a full cycle', () => {
  const pat = { id: 2, type: 'pattern', status: 'active', config: patternFromTemplate({ template: '2-2-3', anchorDate: '2026-06-01', parentA: A, parentB: B }) };
  const s = timeShare(run([def, pat], '2026-06-01', '2026-06-29'), TZ, '2026-06-01', '2026-06-29');
  assert.equal(s.pct[A], 50); assert.equal(s.pct[B], 50);
});

test('holiday beats pattern; override beats holiday; alternation by year', () => {
  const pat = { id: 2, type: 'pattern', status: 'active', config: patternFromTemplate({ template: 'week_on_week_off', anchorDate: '2026-11-02', parentA: A, parentB: B }) };
  const tg = { id: 3, type: 'holiday', status: 'active', config: {
    rule: { type: 'nth_weekday', month: 11, weekday: 4, n: 4 }, start: { dayOffset: -1, time: '18:00' }, end: { dayOffset: 3, time: '18:00' },
    assignment: { mode: 'alternate', evenYears: B, oddYears: A } } };
  let tl = run([def, pat, tg], '2026-11-20', '2026-12-05');
  const at = (stamp) => tl.find(x => x.start <= localToUtc(...stamp.split(' '), TZ) && x.end > localToUtc(...stamp.split(' '), TZ)).parent;
  // Week of Nov 23 belongs to B in the pattern (anchor Nov 2 => A, Nov 9 B, Nov 16 A, Nov 23 B); 2026 even => B anyway.
  assert.equal(at('2026-11-26 12:00'), B);
  const ov = { id: 4, type: 'override', status: 'active', config: { periods: [{ start: '2026-11-26T10:00', end: '2026-11-26T14:00', parent: A }] } };
  tl = run([def, pat, tg, ov], '2026-11-20', '2026-12-05');
  assert.equal(at('2026-11-26 12:00'), A);
  assert.equal(at('2026-11-26 15:00'), B);
  // pending rules are ignored
  tl = run([def, pat, tg, { ...ov, status: 'pending' }], '2026-11-20', '2026-12-05');
  assert.equal(at('2026-11-26 12:00'), B);
});

test('ICS round trip incl. TZID and weekly RRULE with EXDATE', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:soccer', 'SUMMARY:Soccer\\, U10',
    'DTSTART;TZID=America/Los_Angeles:20261103T170000', 'DTEND;TZID=America/Los_Angeles:20261103T180000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6', 'EXDATE;TZID=America/Los_Angeles:20261105T170000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261110', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ev = parseIcs(ics, { defaultTz: TZ, fromMs: Date.UTC(2026, 9, 1), toMs: Date.UTC(2027, 0, 1) });
  const soccer = ev.filter(e => e.title === 'Soccer, U10');
  assert.equal(soccer.length, 5);
  assert.equal(utcToLocalStamp(soccer[0].start, TZ), '2026-11-03T17:00');
  assert.ok(ev.find(e => e.title === 'All day').allDay);
  const out = buildIcs({ name: 'Test', events: [{ uid: 'a', title: 'Kids with me', start: soccer[0].start, end: soccer[0].end }] });
  const back = parseIcs(out, { defaultTz: TZ, fromMs: 0, toMs: Date.UTC(2030, 0, 1) });
  assert.equal(back[0].start, soccer[0].start);
});

test('tone check flags hostile language, passes neutral', () => {
  assert.equal(checkTone('Can we swap the 14th for the 21st? I have a work trip.').ok, true);
  const r = checkTone('You ALWAYS do this, you idiot. See you in court!!!');
  const ids = r.issues.map(i => i.id);
  for (const id of ['insult', 'absolute', 'threat', 'punct']) assert.ok(ids.includes(id), id);
});

test('a pattern does not apply before its start (no rewriting history)', () => {
  const pat = { id: 2, type: 'pattern', status: 'active', config: patternFromTemplate({ template: 'week_on_week_off', anchorDate: '2026-06-15', parentA: B, parentB: A }) };
  const s = timeShare(run([def, pat], '2026-06-01', '2026-06-15'), TZ, '2026-06-01', '2026-06-15');
  assert.equal(s.pct[A], 100);
});
