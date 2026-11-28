// Regression tests for the security / correctness review (finding numbers refer to that review).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.js';
import { openDb, hashPassword, verifyPassword, scryptStats, normalizeCode } from '../server/db.js';
import { buildTimeline, expandRule, patternFromTemplate, timeShare, ACTIVE_STATUSES } from '../server/schedule.js';
import { parseIcs, buildIcs } from '../server/ics.js';
import { isPrivate, fetchCalendar } from '../server/fetch.js';
import { createLimiter } from '../server/limits.js';
import { addDays, dayOfWeek, localToUtc, localStampToUtc, utcToLocalDate, utcToLocalStamp } from '../server/time.js';

const TZ = 'America/Los_Angeles';
const DAY = 86400000;
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const stop = (srv) => { srv.close(); srv.closeAllConnections?.(); };

async function start(t, opts = {}) {
  const app = createApp({ dbPath: ':memory:', pushDisabled: true, reminders: false, ...opts });
  const base = await listen(app.server);
  t.after(() => stop(app.server));
  return { ...app, base };
}

async function call(base, method, path, { body, rawBody, cookie, bearer, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  const res = await fetch(base + path, { method, headers: h, body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

function client(base, mode = 'web', headers = {}) {
  const s = { cookie: '', token: null };
  async function req(method, path, body, extra = {}) {
    const r = await call(base, method, path, { body: method === 'GET' ? undefined : (body ?? {}), cookie: s.cookie, bearer: s.token, headers: { ...headers, ...extra } });
    const set = r.headers.get('set-cookie'); if (set) s.cookie = set.split(';')[0];
    return r;
  }
  async function must(method, path, body) {
    const r = await req(method, path, body);
    if (r.status !== 200) { const e = new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`); e.status = r.status; throw e; }
    return r.data;
  }
  const extra = mode === 'mobile' ? { client: 'mobile' } : {};
  return {
    s, req,
    get: (p) => must('GET', p), post: (p, b) => must('POST', p, b), put: (p, b) => must('PUT', p, b),
    async register(email, name, password) { const d = await must('POST', '/api/register', { email, name, password, ...extra }); if (d.token) s.token = d.token; return d; },
    async login(email, password) { const d = await must('POST', '/api/login', { email, password, ...extra }); if (d.token) s.token = d.token; return d; },
  };
}

let seq = 0;
async function family(base, { withViewer = false, coParent = true } = {}) {
  const k = ++seq;
  const mom = client(base), dad = client(base, 'mobile'), viewer = client(base);
  await mom.register(`mom${k}@example.com`, 'Mom', 'correct-horse-1');
  await mom.post('/api/family', { name: 'Smith', timezone: TZ, children: [{ name: 'Ava' }] });
  const first = await mom.get('/api/me');
  if (coParent) {
    await dad.register(`dad${k}@example.com`, 'Dad', 'correct-horse-2');
    await dad.post('/api/family/join', { code: first.family.invite_code });
  }
  if (withViewer) {
    await viewer.register(`viewer${k}@example.com`, 'Mediator', 'correct-horse-3');
    await viewer.post('/api/family/join', { code: first.family.viewer_code });
  }
  const me = await mom.get('/api/me');
  const id = (name) => me.members.find(m => m.name === name)?.id;
  return { mom, dad, viewer, me, familyId: me.family.id, momId: id('Mom'), dadId: id('Dad'), viewerId: id('Mediator') };
}
const today = () => utcToLocalDate(Date.now(), TZ);
const nights = (share, parentId) => share.byParent.find(p => p.parent === parentId)?.overnights ?? 0;

// ---------------------------------------------------------------------------------------------
// 1. Event-loop DoS: validation, limits, ranges, and an O((n+m) log n) timeline
// ---------------------------------------------------------------------------------------------

test('1a/1b: preview and saved rules share strict validators', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: true });
  const seg = (o = {}) => ({ startDay: 0, startTime: '00:00', endDay: 1, endTime: '00:00', parent: f.momId, ...o });
  const pattern = (cfg) => ({ type: 'pattern', config: { anchorDate: '2026-01-05', cycleDays: 14, segments: [seg()], ...cfg } });
  const cases = [
    pattern({ cycleDays: 1e-6 }), pattern({ cycleDays: 1.5 }), pattern({ cycleDays: 57 }), pattern({ cycleDays: '14' }),
    pattern({ segments: Array.from({ length: 65 }, () => seg()) }),
    pattern({ segments: [seg({ startDay: 0, endDay: 29 })] }), pattern({ segments: [seg({ startDay: 1.5 })] }), pattern({ segments: [seg({ startDay: -1 })] }),
    pattern({ segments: [seg({ startTime: '25:00' })] }), pattern({ anchorDate: '2026-02-30' }),
    { type: 'override', config: { periods: Array.from({ length: 101 }, (_, i) => ({ start: `2026-12-${String(1 + (i % 28)).padStart(2, '0')}T10:00`, end: `2026-12-${String(1 + (i % 28)).padStart(2, '0')}T11:00`, parent: f.momId })) } },
    { type: 'override', config: { periods: [{ start: '2026-01-01T00:00', end: '2027-03-01T00:00', parent: f.momId }] } },
    { type: 'holiday', config: { rule: { type: 'fixed', month: 7, day: 4 }, start: { dayOffset: -61, time: '09:00' }, end: { dayOffset: 0, time: '18:00' }, assignment: { mode: 'fixed', parent: f.momId } } },
    { type: 'holiday', config: { rule: { type: 'fixed', month: 13, day: 4 }, start: { dayOffset: 0, time: '09:00' }, end: { dayOffset: 0, time: '18:00' }, assignment: { mode: 'fixed', parent: f.momId } } },
    { type: 'holiday', config: { rule: { type: 'nth_weekday', month: 5, weekday: 0, n: 9 }, start: { dayOffset: 0, time: '09:00' }, end: { dayOffset: 0, time: '18:00' }, assignment: { mode: 'fixed', parent: f.momId } } },
    { type: 'holiday', config: { rule: { type: 'once', startDate: '2026-01-01', endDate: '2028-01-01' }, start: { dayOffset: 0, time: '09:00' }, end: { dayOffset: 0, time: '18:00' }, assignment: { mode: 'fixed', parent: f.momId } } },
    { type: 'pattern', config: [] }, { type: 'default', config: null },
  ];
  for (const body of cases) {
    const t0 = performance.now();
    const pv = await f.viewer.req('POST', '/api/schedule/preview', body); // view-only members can preview
    assert.equal(pv.status, 400, `preview ${JSON.stringify(body).slice(0, 120)}`);
    assert.ok(performance.now() - t0 < 200, 'rejected without expanding anything');
    assert.equal((await f.mom.req('POST', '/api/rules', body)).status, 400, `save ${JSON.stringify(body).slice(0, 120)}`);
  }
  // A legitimate pattern still previews.
  const ok = await f.mom.post('/api/schedule/preview', { type: 'pattern', template: { template: 'week_on_week_off', anchorDate: '2026-01-05', parentA: f.momId, parentB: f.dadId }, start: '2026-01-05', end: '2026-03-02' });
  assert.equal(nights(ok.share, f.dadId), 28);
});

test('1b: at most 200 open schedule items and 50 call schedules per family', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { coParent: false }); // solo parent: rules take effect at once ("not yet confirmed")
  const swap = (i) => ({ type: 'override', name: `S${i}`, config: { periods: [{ start: `${addDays('2027-01-01', i)}T10:00`, end: `${addDays('2027-01-01', i)}T11:00`, parent: f.momId }] } });
  for (let i = 1; i < 200; i++) await f.mom.post('/api/rules', swap(i)); // + the initial primary-parent rule = 200
  const over = await f.mom.req('POST', '/api/rules', swap(200));
  assert.equal(over.status, 400);
  assert.match(over.data.error, /at most 200/);
  for (let i = 0; i < 50; i++) await f.mom.post('/api/call-rules', { entitled_parent: f.momId, count: 1, period: 'week' });
  assert.equal((await f.mom.req('POST', '/api/call-rules', { entitled_parent: f.momId, count: 1, period: 'week' })).status, 400);
});

test('1c: every date range is bounded', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: true });
  const rule = (await f.mom.get('/api/rules'))[0].id;
  for (const path of ['/api/timeline?start=2026-01-01&end=2028-06-01', '/api/events?start=2026-01-01&end=2106-01-01', `/api/rules/${rule}/impact?start=2026-01-01&end=2036-01-01`,
    '/api/calls/compliance?start=1900-01-01&end=2100-01-01', '/api/events?start=2026-02-01&end=2026-01-01']) {
    assert.equal((await f.viewer.req('GET', path)).status, 400, path);
  }
  assert.equal((await f.viewer.req('POST', '/api/schedule/preview', { type: 'default', config: { parent: f.momId }, start: '2026-01-01', end: '2036-01-01' })).status, 400);
  assert.equal((await f.viewer.req('GET', '/report?start=2026-01-01&end=2036-12-31')).status, 400, 'report: about 10 years at most');
  assert.equal((await f.viewer.req('GET', '/report?start=2026-01-01&end=2035-12-31')).status, 200);
  assert.equal((await f.mom.req('POST', '/api/report-link', { start: '2000-01-01', end: '2026-01-01' })).status, 400);
  assert.equal((await f.viewer.req('GET', '/api/events?start=2026-01-01&end=2027-12-31')).status, 200);
});

/** The engine before this change: for every boundary, scan every block (O(n*m)); one default applies everywhere. */
function referenceTimeline({ rules, tz, fromMs, toMs }) {
  const active = rules.filter(r => ACTIVE_STATUSES.has(r.status));
  const def = active.filter(r => r.type === 'default').sort((a, b) => b.id - a.id)[0];
  const intervals = active.filter(r => r.type !== 'default').flatMap(r => expandRule(r, tz, fromMs, toMs, { left: Infinity }));
  const points = new Set([fromMs, toMs]);
  for (const iv of intervals) {
    if (iv.start > fromMs && iv.start < toMs) points.add(iv.start);
    if (iv.end > fromMs && iv.end < toMs) points.add(iv.end);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    let best = null;
    for (const iv of intervals) if (iv.start <= a && iv.end >= b && (!best || iv.prio > best.prio || (iv.prio === best.prio && iv.order > best.order))) best = iv;
    const parent = best ? best.parent : (def ? def.config.parent : null);
    const src = best ? best.src : { type: 'default', id: def ? def.id : null, name: 'Default (primary parent)' };
    const last = out[out.length - 1];
    if (last && last.parent === parent && last.src.id === src.id && last.src.type === src.type) last.end = b;
    else out.push({ start: a, end: b, parent, src });
  }
  return out;
}

function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
const pad = (n) => String(n).padStart(2, '0');

test('1d: the sweep-line timeline matches the previous engine exactly', () => {
  const r = rng(42);
  const pick = (n) => Math.floor(r() * n);
  for (let round = 0; round < 40; round++) {
    const rules = [{ id: 1, type: 'default', status: 'active', config: { parent: 1 } }];
    let id = 2;
    for (let k = pick(3); k >= 0; k--) {
      const cycleDays = 1 + pick(21);
      const segments = Array.from({ length: 1 + pick(8) }, () => {
        const startDay = pick(cycleDays), endDay = startDay + pick(cycleDays + 1);
        const st = `${pad(pick(24))}:${pad(pick(4) * 15)}`, et = endDay === startDay ? '23:59' : `${pad(pick(24))}:${pad(pick(4) * 15)}`;
        return { startDay, startTime: st, endDay, endTime: et, parent: 1 + pick(2) };
      });
      rules.push({ id: id++, type: 'pattern', status: r() < 0.9 ? 'active' : 'pending', priority: pick(3) - 1, config: { anchorDate: addDays('2026-01-01', pick(60) - 30), cycleDays, segments } });
    }
    for (let k = pick(4); k > 0; k--) {
      rules.push({ id: id++, type: 'holiday', status: 'active', priority: pick(3) - 1, config: { rule: { type: 'fixed', month: 1 + pick(12), day: 1 + pick(28) },
        start: { dayOffset: -pick(3), time: '18:00' }, end: { dayOffset: pick(4), time: '09:00' }, assignment: { mode: 'alternate', evenYears: 1, oddYears: 2 } } });
    }
    for (let k = pick(10); k > 0; k--) {
      const d = addDays('2026-01-01', pick(300));
      rules.push({ id: id++, type: 'override', status: r() < 0.8 ? 'unconfirmed' : 'rejected', config: { periods: Array.from({ length: 1 + pick(3) }, () => ({
        start: `${d}T${pad(pick(24))}:00`, end: `${addDays(d, 1 + pick(3))}T${pad(pick(24))}:00`, parent: 1 + pick(2) })) } });
    }
    const from = addDays('2026-01-01', pick(200)), to = addDays(from, 1 + pick(200));
    const args = { rules, tz: TZ, fromMs: localToUtc(from, '00:00', TZ), toMs: localToUtc(to, '00:00', TZ) };
    const got = buildTimeline(args), want = referenceTimeline(args);
    assert.deepEqual(got, want, `round ${round}`);
    assert.deepEqual(timeShare(got, TZ, from, to), timeShare(want, TZ, from, to));
  }
});

test('1d: 60-block pattern plus 10,000 change periods over 2 years in under 500 ms', () => {
  const segs = Array.from({ length: 60 }, (_, i) => ({ startDay: i % 7, startTime: `${pad(i % 24)}:00`, endDay: (i % 7) + 1 + (i % 3), endTime: `${pad((i * 7) % 24)}:30`, parent: 1 + (i % 2) }));
  const rules = [{ id: 1, type: 'default', status: 'active', config: { parent: 1 } },
    { id: 2, type: 'pattern', status: 'active', config: { anchorDate: '2026-01-05', cycleDays: 7, segments: segs } }];
  for (let k = 0; k < 100; k++) {
    rules.push({ id: 3 + k, type: 'override', status: 'active', config: { periods: Array.from({ length: 100 }, (_, i) => {
      const d = addDays('2026-01-01', (k * 7 + i * 3) % 720);
      return { start: `${d}T${pad((k + i) % 24)}:00`, end: `${addDays(d, 1)}T${pad((k * i) % 24)}:15`, parent: 1 + ((k + i) % 2) };
    }) } });
  }
  const t0 = performance.now();
  const tl = buildTimeline({ rules, tz: TZ, fromMs: localToUtc('2026-01-01', '00:00', TZ), toMs: localToUtc('2028-01-01', '00:00', TZ) });
  const share = timeShare(tl, TZ, '2026-01-01', '2028-01-01');
  const ms = performance.now() - t0;
  assert.ok(tl.length > 1000);
  assert.equal(share.totalNights, 730);
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
});

// ---------------------------------------------------------------------------------------------
// 2. Ending or replacing a rule keeps history
// ---------------------------------------------------------------------------------------------

test('2: ending a pattern or switching the primary parent today leaves past time share unchanged', async (t) => {
  const { base, db } = await start(t);
  const { mom, dad, momId, dadId } = await family(base);
  const rules0 = await dad.get('/api/rules');
  await dad.post(`/api/rules/${rules0[0].id}/decide`, { decision: 'approve' }); // Mom primary
  const td = today();
  let anchor = addDays(td, -294);
  anchor = addDays(anchor, -((dayOfWeek(anchor) + 6) % 7)); // a Monday, 42+ weeks ago
  const past = `start=${anchor}&end=${addDays(anchor, 280)}`;            // 40 weeks, all before today
  const future = `start=${addDays(td, 7)}&end=${addDays(td, 63)}`;
  const share = async (range) => (await mom.get(`/api/timeline?${range}`)).share;

  const { id: pat } = await mom.post('/api/rules', { type: 'pattern', name: 'Week on / week off', template: { template: 'week_on_week_off', anchorDate: anchor, parentA: momId, parentB: dadId } });
  await dad.post(`/api/rules/${pat}/decide`, { decision: 'approve' });
  let s = await share(past);
  assert.deepEqual([nights(s, momId), nights(s, dadId)], [140, 140]);
  assert.ok(nights(await share(future), dadId) > 0);

  // End the pattern today.
  await mom.post(`/api/rules/${pat}/retire`, { note: 'Ending going forward' });
  await dad.post(`/api/rules/${pat}/retire-decide`, { decision: 'approve' });
  const row = db.prepare('SELECT status, ended_at FROM rules WHERE id = ?').get(pat);
  assert.equal(row.status, 'retired');
  assert.ok(Math.abs(row.ended_at - Date.now()) < 60000, 'ended_at = when it was ended');
  s = await share(past);
  assert.deepEqual([nights(s, momId), nights(s, dadId)], [140, 140], 'past unchanged after ending the pattern');
  assert.equal(nights(await share(future), dadId), 0, 'future follows the primary parent');

  // Switch the primary parent to Dad today.
  const { id: d2 } = await mom.post('/api/rules', { type: 'default', name: 'Dad primary', config: { parent: dadId } });
  const pend = await dad.get(`/api/rules/${d2}/impact?${future}`);
  assert.equal(pend.before.byParent.find(p => p.parent === momId).pct, 100);
  assert.equal(pend.after.byParent.find(p => p.parent === dadId).pct, 100);
  const pendPast = await dad.get(`/api/rules/${d2}/impact?${past}`);
  assert.deepEqual(pendPast.before, pendPast.after, 'a pending primary-parent change does not touch the past');
  await dad.post(`/api/rules/${d2}/decide`, { decision: 'approve' });
  s = await share(past);
  assert.deepEqual([nights(s, momId), nights(s, dadId)], [140, 140], 'past unchanged after switching the primary parent');
  const fut = await share(future);
  assert.equal(fut.byParent.find(p => p.parent === dadId).pct, 100, 'future reflects the new primary parent');
  const old = db.prepare('SELECT status, ended_at FROM rules WHERE id = ?').get(rules0[0].id);
  const neu = db.prepare('SELECT effective_from FROM rules WHERE id = ?').get(d2);
  assert.equal(old.status, 'retired');
  assert.equal(old.ended_at, neu.effective_from, 'the old primary parent ends exactly when the new one starts');

  // Impact stays consistent once approved: "before" is with the old primary parent put back.
  const imp = await dad.get(`/api/rules/${d2}/impact?${future}`);
  assert.equal(imp.before.byParent.find(p => p.parent === momId).pct, 100);
  assert.deepEqual(imp.after, pend.after);
  const impPast = await dad.get(`/api/rules/${d2}/impact?${past}`);
  assert.deepEqual(impPast.before, impPast.after);
  assert.equal((await mom.get('/api/me')).primary, dadId);
  assert.equal((await mom.get('/api/audit/verify')).ok, true);
});

test('2: a replaced pattern applies until its replacement starts; a disputed replacement clears ended_at', async (t) => {
  const { base, db } = await start(t);
  const mom = client(base), dad = client(base);
  await mom.register('solo-mom@example.com', 'Mom', 'correct-horse-1');
  await mom.post('/api/family', { name: 'Smith', timezone: TZ });
  const me = await mom.get('/api/me');
  const td = today();
  const { id: a } = await mom.post('/api/rules', { type: 'pattern', name: 'Old', template: { template: 'custom', anchorDate: addDays(td, -60), options: { days: [me.user.id] } } });
  const startB = addDays(td, 30);
  const { id: b } = await mom.post('/api/rules', { type: 'pattern', name: 'New', template: { template: 'custom', anchorDate: startB, options: { days: [me.user.id] } }, supersedes: a });
  const ra = db.prepare('SELECT status, ended_at FROM rules WHERE id = ?').get(a);
  assert.equal(ra.status, 'retired');
  assert.equal(ra.ended_at, localToUtc(startB, '00:00', TZ), 'ends when the replacement starts, not before');
  const tl = await mom.get(`/api/timeline?start=${addDays(td, -10)}&end=${addDays(td, 40)}`);
  const srcAt = (ms) => tl.timeline.find(x => x.start <= ms && x.end > ms).src.id;
  assert.equal(srcAt(localToUtc(addDays(td, -5), '12:00', TZ)), a, 'past: old pattern');
  assert.equal(srcAt(localToUtc(addDays(td, 10), '12:00', TZ)), a, 'until the replacement starts: old pattern');
  assert.equal(srcAt(localToUtc(addDays(td, 35), '12:00', TZ)), b);
  await dad.register('solo-dad@example.com', 'Dad', 'correct-horse-2');
  await dad.post('/api/family/join', { code: me.family.invite_code });
  await dad.post(`/api/rules/${b}/decide`, { decision: 'reject', note: 'Not agreed' });
  const back = db.prepare('SELECT status, ended_at FROM rules WHERE id = ?').get(a);
  assert.deepEqual([back.status, back.ended_at], ['unconfirmed', null]);
});

test('2: migration fills ended_at from the audit log and re-keys files per family', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coparent-mig-'));
  try {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE rules(id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL,
        decided_by INTEGER, decided_at TEXT, decision_note TEXT, retire_requested_by INTEGER, retire_requested_at TEXT, supersedes INTEGER);
      CREATE TABLE call_rules(id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, name TEXT NOT NULL, entitled_parent INTEGER NOT NULL, method TEXT NOT NULL,
        count INTEGER NOT NULL, period TEXT NOT NULL, duration_min INTEGER NOT NULL, window TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, decision_note TEXT,
        retire_requested_by INTEGER, retire_requested_at TEXT);
      CREATE TABLE files(hash TEXT PRIMARY KEY, family_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL,
        uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit(id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL,
        entity TEXT NOT NULL, entity_id TEXT, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, UNIQUE(family_id, seq));
      INSERT INTO rules(id, family_id, type, name, config, status, requested_by, requested_at, decided_by, decided_at) VALUES
        (1, 1, 'default', 'Primary', '{"parent":1}', 'retired', 1, '2026-01-01T00:00:00.000Z', 2, '2026-01-02T00:00:00.000Z'),
        (2, 1, 'default', 'Primary', '{"parent":2}', 'active', 1, '2026-03-01T00:00:00.000Z', 2, '2026-03-05T10:00:00.000Z'),
        (3, 1, 'pattern', 'Gone', '{}', 'retired', 1, '2026-01-01T00:00:00.000Z', NULL, NULL);
      INSERT INTO audit(family_id, seq, ts, user_id, action, entity, entity_id, data, prev_hash, hash) VALUES
        (1, 1, '2026-01-01T00:00:00.000Z', 1, 'request', 'rule', '2', '{"status":"pending"}', 'x', 'y'),
        (1, 2, '2026-03-05T10:00:00.000Z', 2, 'retire', 'rule', '1', '{"by_rule":2,"reason":"Replaced by newer default"}', 'x', 'y');
      INSERT INTO files VALUES ('abc', 1, 'r.pdf', 'application/pdf', 3, x'010203', 1, '2026-01-01T00:00:00.000Z');`);
    old.close();
    const db = openDb(path);
    const r = (id) => db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
    assert.equal(r(1).ended_at, Date.parse('2026-03-05T10:00:00.000Z'));
    assert.equal(r(2).effective_from, Date.parse('2026-03-05T10:00:00.000Z'));
    assert.equal(r(3).ended_at, null, 'no audit entry: stays out of the timeline, as before');
    const pk = db.prepare('PRAGMA table_info(files)').all().filter(c => c.pk > 0).map(c => c.name).sort();
    assert.deepEqual(pk, ['family_id', 'hash']);
    assert.equal(db.prepare('SELECT name FROM files WHERE hash = ?').get('abc').name, 'r.pdf');
    db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?,?)').run('abc', 2, 'other.pdf', 'application/pdf', 3, Buffer.from([1, 2, 3]), 9, 'x');
    // The primary parent before 2026-03-05 10:00 UTC is parent 1, after it parent 2.
    const rules = db.prepare('SELECT * FROM rules').all().map(x => ({ ...x, config: JSON.parse(x.config) }));
    const tl = buildTimeline({ rules, tz: 'UTC', fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2026, 5, 1) });
    assert.deepEqual(tl.map(x => [x.parent, new Date(x.start).toISOString()]), [[1, '2026-01-01T00:00:00.000Z'], [2, '2026-03-05T10:00:00.000Z']]);
    db.close();
    openDb(path).close(); // idempotent
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------
// 3. GPS input, 4. check-ins entered later, 5. payments need a live co-parent
// ---------------------------------------------------------------------------------------------

test('3: exchange GPS needs lat and lng together, in range; the report never crashes on GPS', async (t) => {
  const { base, db } = await start(t);
  const f = await family(base);
  for (const body of [{ lat: 37.1 }, { lng: -121 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 'x', lng: 1 }, { lat: 1, lng: 1, accuracy: -1 }, { lat: 1, lng: 1, accuracy: 'far' }, { lat: true, lng: 1 }]) {
    assert.equal((await f.dad.req('POST', '/api/exchanges', { kind: 'pickup', ...body })).status, 400, JSON.stringify(body));
  }
  const { id } = await f.dad.post('/api/exchanges', { kind: 'pickup', lat: 38.68, lng: -121.08, accuracy: 12 });
  const ex = (await f.mom.get('/api/exchanges')).find(x => x.id === id);
  assert.deepEqual([ex.lat, ex.lng, ex.accuracy], [38.68, -121.08, 12]);
  // A row from before this fix with lat but no lng.
  db.prepare("INSERT INTO exchanges(family_id, kind, at_ms, location, lat, lng, accuracy, logged_by, created_at) VALUES(?, 'pickup', ?, '', 37.1, NULL, NULL, ?, ?)")
    .run(f.familyId, Date.now(), f.dadId, new Date().toISOString());
  const rep = await f.mom.req('GET', `/report?start=${addDays(today(), -1)}&end=${today()}`);
  assert.equal(rep.status, 200);
  assert.match(rep.data, /GPS 38\.68000, -121\.08000/);
});

test('4: check-ins logged later keep the server time and are flagged everywhere', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const threeHoursAgo = utcToLocalStamp(Date.now() - 3 * 3600000, TZ);
  const r = await f.dad.post('/api/exchanges', { kind: 'pickup', at: threeHoursAgo });
  assert.ok(r.entered_late_minutes >= 179 && r.entered_late_minutes <= 181, String(r.entered_late_minutes));
  await f.dad.post('/api/exchanges', { kind: 'dropoff' });
  const list = await f.mom.get('/api/exchanges');
  const late = list.find(x => x.id === r.id), now = list.find(x => x.id !== r.id);
  assert.equal(late.at_ms, localStampToUtc(threeHoursAgo, TZ));
  assert.ok(Math.abs(late.recorded_at_ms - Date.now()) < 60000, 'server receipt time');
  assert.equal(Date.parse(late.created_at), late.recorded_at_ms);
  assert.equal(now.entered_late_minutes, null);
  assert.equal((await f.dad.req('POST', '/api/exchanges', { kind: 'pickup', at: 'yesterday' })).status, 400);
  assert.match((await f.mom.get('/api/notifications')).find(n => n.kind === 'exchange_checkin' && n.entity_id === String(r.id)).body, /entered later/);
  // A call logged and the report.
  await f.mom.post('/api/calls', { started: `${addDays(today(), -2)}T18:00`, status: 'completed', duration_min: 10 });
  const rep = await f.mom.req('GET', `/report?start=${addDays(today(), -3)}&end=${today()}`);
  assert.equal(rep.status, 200);
  assert.doesNotMatch(rep.data, /cannot backdate/);
  assert.match(rep.data, /The server records when each entry was saved/);
  assert.match(rep.data, /Entered later<\/b>: saved/);
  assert.match(rep.data, /Logged \d{4}-\d\d-\d\d \d\d:\d\d \(server time\)/);
});

test('5: a deleted co-parent cannot be sent new payments', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  await f.dad.post('/api/account/delete', { password: 'correct-horse-2' });
  const r = await f.mom.req('POST', '/api/payments', { amount: 10 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /co-parent has not joined/);
});

// ---------------------------------------------------------------------------------------------
// 6. Client IP behind proxies, bounded limiter memory, async scrypt, per-account slow-down
// ---------------------------------------------------------------------------------------------

test('6: TRUST_PROXY uses the right-most X-Forwarded-For entry; TRUST_PROXY_HEADER a platform header', async (t) => {
  const login = (base, headers, i) => call(base, 'POST', '/api/login', { headers, body: { email: 'victim@example.com', password: `wrong-${i}` } });
  const proxied = await start(t, { trustProxy: true });
  await client(proxied.base).register('victim@example.com', 'Victim', 'correct-horse-1');
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await login(proxied.base, { 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.7` }, i)).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429], 'forged left-hand entries do not reset the limit');

  const fly = await start(t, { trustProxyHeader: 'fly-client-ip' });
  await client(fly.base).register('victim@example.com', 'Victim', 'correct-horse-1');
  const codes2 = [];
  for (let i = 0; i < 9; i++) codes2.push((await login(fly.base, { 'Fly-Client-IP': '198.51.100.9', 'X-Forwarded-For': `10.1.0.${i}` }, i)).status);
  assert.equal(codes2[8], 429);
  const other = await call(fly.base, 'POST', '/api/login', { headers: { 'Fly-Client-IP': '198.51.100.10' }, body: { email: 'someone@example.com', password: 'x' } });
  assert.equal(other.status, 401, 'another client is not blocked');
});

test('6: limiter maps are pruned and capped', () => {
  const l = createLimiter({ windowMs: 1000, max: 3, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) l.hit(`k${i}`, 0);
  assert.ok(l.size <= 100, `size ${l.size}`);
  l.hit('fresh', 5000);
  l.prune(5000);
  assert.equal(l.size, 1);
  for (let i = 0; i < 3; i++) l.hit('x', 6000);
  assert.equal(l.limited('x', 6500), true);
  assert.equal(l.limited('x', 7001), false, 'window slides');
});

test('6: async scrypt keeps the stored format; unknown emails run a dummy hash; repeated failures slow down but never lock out', async (t) => {
  const h = await hashPassword('correct-horse-1');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('correct-horse-1', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  // A hash written by the previous (synchronous) code still verifies.
  const { scryptSync } = await import('node:crypto');
  const salt = Buffer.alloc(16, 7);
  assert.equal(await verifyPassword('legacy-pass-1', `scrypt$${salt.toString('hex')}$${scryptSync('legacy-pass-1', salt, 64).toString('hex')}`), true);

  const { base } = await start(t, { trustProxy: true });
  await client(base).register('owner@example.com', 'Owner', 'correct-horse-1');
  const before = scryptStats.verifies;
  assert.equal((await call(base, 'POST', '/api/login', { body: { email: 'nobody@example.com', password: 'x' } })).status, 401);
  assert.equal(scryptStats.verifies, before + 1, 'unknown email still costs one scrypt');

  // Six failures from six different IPs, then the owner signs in from a seventh: slowed down, not refused.
  for (let i = 0; i < 6; i++) await call(base, 'POST', '/api/login', { headers: { 'X-Forwarded-For': `198.51.100.${i}` }, body: { email: 'owner@example.com', password: 'guess' } });
  const t0 = performance.now();
  const ok = await call(base, 'POST', '/api/login', { headers: { 'X-Forwarded-For': '198.51.100.200' }, body: { email: 'owner@example.com', password: 'correct-horse-1' } });
  assert.equal(ok.status, 200);
  assert.ok(performance.now() - t0 >= 450, 'progressive delay after repeated failures');
  // A successful sign-in resets the slow-down.
  const t1 = performance.now();
  await call(base, 'POST', '/api/login', { body: { email: 'owner@example.com', password: 'correct-horse-1' } });
  assert.ok(performance.now() - t1 < 450);
});

// ---------------------------------------------------------------------------------------------
// 7 / 11. Calendar import
// ---------------------------------------------------------------------------------------------

test('7: recurrence from decades ago is expanded arithmetically and correctly', () => {
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:w', 'SUMMARY:Weekly since 1990', 'DTSTART:19900105T170000Z', 'DTEND:19900105T180000Z', 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Daily since 1950', 'DTSTART;TZID=America/Los_Angeles:19500101T080000', 'DURATION:PT30M', 'RRULE:FREQ=DAILY;INTERVAL=3', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:m', 'SUMMARY:Monthly since 1970', 'DTSTART;VALUE=DATE:19700131', 'RRULE:FREQ=MONTHLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:y', 'SUMMARY:Yearly since 1900', 'DTSTART;VALUE=DATE:19000704', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const fromMs = Date.UTC(2026, 0, 1), toMs = Date.UTC(2026, 11, 31);
  const t0 = performance.now();
  const ev = parseIcs(ics, { defaultTz: TZ, fromMs, toMs });
  assert.ok(performance.now() - t0 < 100);
  const by = (title) => ev.filter(e => e.title === title);
  const fridays = by('Weekly since 1990');
  assert.equal(fridays.length, 52);
  assert.ok(fridays.every(e => new Date(e.start).getUTCDay() === 5 && new Date(e.start).getUTCHours() === 17));
  const daily = by('Daily since 1950');
  const firstDaily = localToUtc('1950-01-01', '08:00', TZ);
  assert.ok(daily.length >= 120 && daily.length <= 122, String(daily.length));
  assert.ok(daily.every(e => utcToLocalStamp(e.start, TZ).endsWith('T08:00')));
  assert.ok(daily.every(e => Math.round((localToUtc(utcToLocalDate(e.start, TZ), '00:00', TZ) - localToUtc('1950-01-01', '00:00', TZ)) / DAY) % 3 === 0), 'every third day from the first');
  assert.ok(daily[0].start > firstDaily);
  assert.equal(by('Monthly since 1970').length, 7, 'months with a 31st');
  assert.equal(by('Yearly since 1900').length, 1);
});

test('7: event count and recurrence work are capped', () => {
  const many = ['BEGIN:VCALENDAR', ...Array.from({ length: 5001 }, (_, i) => `BEGIN:VEVENT\r\nUID:${i}\r\nDTSTART:20260101T000000Z\r\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');
  assert.throws(() => parseIcs(many, { fromMs: 0, toMs: Date.UTC(2030, 0, 1) }), /more than 5000 events/);
  // COUNT prevents skipping ahead; the shared iteration budget still bounds the work.
  const heavy = ['BEGIN:VCALENDAR', ...Array.from({ length: 4000 }, (_, i) => `BEGIN:VEVENT\r\nUID:${i}\r\nDTSTART:19000101T000000Z\r\nRRULE:FREQ=DAILY;COUNT=1000000\r\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');
  const t0 = performance.now();
  parseIcs(heavy, { fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2027, 0, 1) });
  assert.ok(performance.now() - t0 < 1500, `${(performance.now() - t0).toFixed(0)} ms`);
});

test('7/11: feed download capped at 5 MB, sync rate-limited, family-visible feeds for parents only', async (t) => {
  const big = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' }); // no Content-Length: the cap is enforced while streaming
    const chunk = Buffer.alloc(64 * 1024, 'A');
    let sent = 0;
    const pump = () => { while (sent < 8 * 1024 * 1024) { sent += chunk.length; if (!res.write(chunk)) return res.once('drain', pump); } res.end(); };
    res.write('BEGIN:VCALENDAR\r\n'); pump();
  });
  const bigBase = await listen(big);
  t.after(() => stop(big));
  const small = createServer((_, res) => { res.writeHead(200); res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'); });
  const smallBase = await listen(small);
  t.after(() => stop(small));

  await assert.rejects(fetchCalendar(`${bigBase}/x.ics`, { allowPrivate: true }), /too large/);
  const { base } = await start(t, { allowPrivateFeeds: true });
  const f = await family(base, { withViewer: true });
  const r1 = await f.mom.post('/api/feeds', { url: `${bigBase}/x.ics`, name: 'Big' });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /too large/);
  assert.equal((await f.viewer.req('POST', '/api/feeds', { url: `${smallBase}/a.ics`, visibility: 'family' })).status, 403);
  const own = await f.viewer.post('/api/feeds', { url: `${smallBase}/a.ics`, visibility: 'me' });
  assert.equal(own.ok, true);
  const b2 = await f.mom.post('/api/feeds', { url: `${smallBase}/b.ics` });
  assert.equal(b2.ok, true);
  assert.equal((await f.mom.post(`/api/feeds/${b2.id}/sync`)).ok, true); // third fetch this minute
  assert.equal((await f.mom.req('POST', `/api/feeds/${b2.id}/sync`)).status, 429);
  assert.equal((await f.mom.req('POST', '/api/feeds', { url: `${smallBase}/c.ics` })).status, 429);
});

test('14: SSRF guard covers mapped, NAT64, site-local and reserved ranges and pins the checked address', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.0.8', '240.0.0.1', '0.0.0.0', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', 'fe80::1', 'fe90::1', 'febf::1', 'fec0::1', 'fd12::1', 'ff02::1', '2002:7f00:1::1']) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '64:ff9b::808:808', '2606:4700::1111']) assert.equal(isPrivate(ip), false, ip);
  for (const url of ['https://127.0.0.1/a.ics', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fe90::1]/', 'https://[64:ff9b::7f00:1]/', 'webcal://169.254.169.254/latest']) {
    await assert.rejects(fetchCalendar(url), /not allowed/, url);
  }
  // A host name that resolves to a private address is refused by the lookup used for the connection itself.
  await assert.rejects(fetchCalendar('https://localhost:1/a.ics'), /not allowed/);
  await assert.rejects(fetchCalendar('http://example.com/a.ics'), /must use https/);
});

// ---------------------------------------------------------------------------------------------
// 8. Invite codes, join rate limit, removing view-only members
// ---------------------------------------------------------------------------------------------

test('8: 80-bit codes, join attempts limited, parents can remove view-only members', async (t) => {
  const { base, db } = await start(t);
  const f = await family(base, { withViewer: true });
  const codes = await f.mom.post('/api/family/viewer-code');
  assert.match(codes.viewer_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeCode(' abcd efgh-jklm ').length, 12);
  // Typed in lower case without dashes still works.
  const v2 = client(base);
  await v2.register('v2@example.com', 'Attorney', 'correct-horse-5');
  assert.equal((await v2.post('/api/family/join', { code: codes.viewer_code.toLowerCase().replace(/-/g, '') })).role, 'viewer');

  const guesser = client(base);
  await guesser.register('guess@example.com', 'Guess', 'correct-horse-6');
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await guesser.req('POST', '/api/family/join', { code: `AAAA-AAAA-AAAA-AA${String(i).padStart(2, '2')}` })).status);
  assert.deepEqual(statuses, [...Array(10).fill(400), 429]);

  const me = await f.mom.get('/api/me');
  const attorney = me.members.find(m => m.name === 'Attorney').id;
  assert.equal((await f.viewer.req('POST', `/api/members/${attorney}/remove`)).status, 403, 'viewers cannot remove anyone');
  assert.equal((await f.mom.req('POST', `/api/members/${f.dadId}/remove`)).status, 400, 'parents cannot be removed this way');
  assert.equal((await f.mom.req('POST', '/api/members/999999/remove')).status, 404);
  await f.mom.post(`/api/members/${attorney}/remove`);
  assert.equal(db.prepare('SELECT 1 FROM members WHERE user_id = ?').get(attorney), undefined);
  assert.equal((await v2.get('/api/me')).family, null);
  assert.equal((await v2.req('GET', '/api/rules')).status, 403);
  const n = (await f.dad.get('/api/notifications')).find(x => x.kind === 'member_removed');
  assert.equal(n.title, 'Mom removed Attorney');
  assert.equal(n.link, 'settings');
  assert.ok((await f.mom.get('/api/audit')).some(a => a.action === 'remove_member' && a.entity_id === String(attorney)));
  assert.equal((await f.mom.get('/api/audit/verify')).ok, true);
});

// ---------------------------------------------------------------------------------------------
// 9. Activity responses, 10. files per family, 12. read receipts
// ---------------------------------------------------------------------------------------------

test('9: activities can only be answered while proposed; cancelling notifies the other parent', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const { id } = await f.mom.post('/api/events', { title: 'Soccer', start: '2026-12-05T10:00', end: '2026-12-05T11:00' });
  await f.dad.post(`/api/events/${id}/respond`, { response: 'accepted' });
  assert.equal((await f.dad.req('POST', `/api/events/${id}/respond`, { response: 'declined' })).status, 400);
  await f.mom.post(`/api/events/${id}/cancel`, { note: 'Field closed' });
  const n = (await f.dad.get('/api/notifications')).find(x => x.kind === 'event_cancelled');
  assert.deepEqual([n.title, n.body, n.link], ['Mom cancelled an activity', 'Soccer: Field closed', 'activities']);
  assert.equal((await f.dad.req('POST', `/api/events/${id}/respond`, { response: 'accepted' })).status, 400);
  assert.equal((await f.mom.req('POST', `/api/events/${id}/cancel`)).status, 400);
  assert.equal((await f.mom.get('/api/events?start=2026-12-01&end=2026-12-10')).events.length, 0);
});

test('10: the same bytes uploaded by two families stay separate', async (t) => {
  const { base } = await start(t);
  const a = await family(base), b = await family(base);
  const pdf = Buffer.from('%PDF-1.4 same receipt bytes').toString('base64');
  await b.mom.post('/api/expenses', { description: 'Theirs', amount: 5, receipt: { data: pdf, type: 'application/pdf', name: 'SQUATTED.pdf' } });
  const { id } = await a.mom.post('/api/expenses', { description: 'Mine', amount: 5, receipt: { data: pdf, type: 'application/pdf', name: 'mine.pdf' } });
  const mine = (await a.mom.get('/api/expenses')).find(x => x.id === id);
  assert.equal(mine.receipt_name, 'mine.pdf');
  assert.equal((await a.mom.req('GET', `/api/files/${mine.receipt_hash}`)).status, 200);
  assert.equal((await b.mom.get('/api/expenses'))[0].receipt_name, 'SQUATTED.pdf');
  await a.mom.post('/api/notes', { target_type: 'general', target_id: '', body: 'n', attachment: { data: pdf, type: 'application/pdf', name: 'note.pdf' } });
  assert.equal((await a.mom.get('/api/notes'))[0].attachment_name, 'mine.pdf', 'same family, same bytes: one stored file');
  assert.equal((await b.mom.get('/api/notes')).length, 0);
});

test('14: per-family file storage quota', async (t) => {
  const { base } = await start(t, { fileQuotaBytes: 40 });
  const f = await family(base);
  const file = (s) => ({ data: Buffer.from(s).toString('base64'), type: 'image/png', name: 'a.png' });
  await f.mom.post('/api/expenses', { description: 'A', amount: 1, receipt: file('x'.repeat(30)) });
  await f.mom.post('/api/expenses', { description: 'A again', amount: 1, receipt: file('x'.repeat(30)) }); // same bytes: no extra space
  const r = await f.mom.req('POST', '/api/expenses', { description: 'B', amount: 1, receipt: file('y'.repeat(30)) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /file storage/);
});

test('12: loading a thread records no read receipt; POST /read does', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: true });
  const { id } = await f.mom.post('/api/threads', { subject: 'S', body: 'hello' });
  await f.dad.get(`/api/threads/${id}`);
  await f.viewer.get(`/api/threads/${id}`);
  assert.deepEqual((await f.mom.get(`/api/threads/${id}`)).messages[0].reads, []);
  assert.equal((await f.dad.get('/api/dashboard')).pending.messages, 1);
  assert.equal((await f.dad.get('/api/me')).unread_notifications, 2); // member_joined (viewer) + message
  const v = await f.viewer.post(`/api/threads/${id}/read`);
  assert.equal(v.marked, 0, 'view-only members record nothing');
  const r = await f.dad.post(`/api/threads/${id}/read`);
  assert.equal(r.marked, 1);
  assert.equal(r.unread, 1);
  assert.equal((await f.mom.get(`/api/threads/${id}`)).messages[0].reads[0].user, 'Dad');
  assert.equal((await f.dad.post(`/api/threads/${id}/read`)).marked, 0, 'idempotent');
  assert.equal((await f.dad.req('POST', '/api/threads/99999/read')).status, 404);
});

// ---------------------------------------------------------------------------------------------
// 13. Content type and body shape, 14. input hygiene, money, DST, family settings, integrity
// ---------------------------------------------------------------------------------------------

test('13: exact JSON media type for any request with a body; body must be an object; bad %-encoding is a 400', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const cookie = f.mom.s.cookie;
  const post = (headers, rawBody, path = '/api/notes') => call(base, 'POST', path, { cookie, headers, rawBody });
  const note = JSON.stringify({ target_type: 'general', body: 'csrf note' });
  assert.equal((await post({ 'Content-Type': 'text/plain; x=application/json' }, note)).status, 415);
  assert.equal((await post({ 'Content-Type': 'application/json-patch+json' }, note)).status, 415);
  assert.equal((await post({}, new Blob([note]))).status, 415, 'no content type');
  // Chunked body (no Content-Length) without a JSON content type.
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(note)); c.close(); } });
  const chunked = await fetch(`${base}/api/notes`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: stream, duplex: 'half' });
  assert.equal(chunked.status, 415);
  assert.equal((await post({ 'Content-Type': 'Application/JSON; charset=utf-8' }, note)).status, 200);
  for (const raw of ['null', '[]', '"x"', '42']) assert.equal((await post({ 'Content-Type': 'application/json' }, raw)).status, 400, raw);
  assert.equal((await call(base, 'POST', '/api/login', { headers: { 'Content-Type': 'application/json' }, rawBody: 'null' })).status, 400);
  // An empty body needs no content type.
  const empty = await fetch(`${base}/api/family/viewer-code`, { method: 'POST', headers: { Cookie: cookie } }); // sends Content-Length: 0
  assert.equal(empty.status, 200);
  assert.equal((await call(base, 'GET', '/api/files/%E0%A4%A', { cookie })).status, 400);
});

test('14: control characters are stripped from text; ICS output has no stray CR', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const { id } = await f.mom.post('/api/threads', { subject: 'A\rB\u0000C', body: 'line1\r\nline2\u0007\tend' });
  const th = await f.dad.get(`/api/threads/${id}`);
  assert.equal(th.thread.subject, 'ABC');
  assert.equal(th.messages[0].body, 'line1\nline2\tend');
  const ics = buildIcs({ name: 'X\r\nY', events: [{ uid: 'u', title: 'Pickup\rBEGIN:VALARM', start: 0, end: 3600000, description: 'a\r\nb\u0001' }] });
  assert.equal(ics.replace(/\r\n/g, '').includes('\r'), false);
  assert.ok(!/\r\nBEGIN:VALARM/.test(ics));
  assert.match(ics, /DESCRIPTION:a\\nb\r\n/);
});

test('14: money is parsed exactly and capped', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const amount = async (v) => {
    const r = await f.mom.req('POST', '/api/expenses', { description: 'x', amount: v, request_reimbursement: false });
    return r.status === 200 ? (await f.mom.get('/api/expenses')).find(e => e.id === r.data.id).amount_cents : r.status;
  };
  assert.equal(await amount('19.99'), 1999);
  assert.equal(await amount(' 0.1 '), 10);
  assert.equal(await amount(60), 6000);
  assert.equal(await amount(1.15), 115);
  assert.equal(await amount('1000000'), 100000000);
  for (const v of ['12.345', 12.345, '1000000.01', 1e21, '1e3', '-5', '0', 'abc', '', null, '$5', Infinity]) assert.equal(await amount(v), 400, String(v));
});

test('14: a DST gap shifts forward (02:30 on spring-forward day is 03:30)', () => {
  assert.equal(utcToLocalStamp(localStampToUtc('2026-03-08T02:30', TZ), TZ), '2026-03-08T03:30');
  assert.equal(utcToLocalStamp(localStampToUtc('2026-03-29T02:30', 'Europe/Berlin'), 'Europe/Berlin'), '2026-03-29T03:30');
  assert.equal(utcToLocalStamp(localStampToUtc('2026-11-01T01:30', TZ), TZ), '2026-11-01T01:30');
  assert.equal(localStampToUtc('2026-11-01T01:30', TZ), Date.UTC(2026, 10, 1, 8, 30), 'overlap: the first 01:30 (PDT)');
});

test('14: changing the family time zone or split notifies the other parent and audits before/after', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  await f.mom.put('/api/family', { timezone: 'America/New_York', default_split: 60 });
  const n = (await f.dad.get('/api/notifications')).find(x => x.kind === 'family_updated');
  assert.equal(n.body, 'time zone America/Los_Angeles → America/New_York; default split 50% → 60%');
  const a = (await f.mom.get('/api/audit')).find(x => x.action === 'update' && x.entity === 'family');
  assert.deepEqual(a.data.before, { name: 'Smith', timezone: 'America/Los_Angeles', default_split: 50 });
  await f.mom.put('/api/family', { name: 'Smith-Jones' });
  assert.equal((await f.dad.get('/api/notifications')).filter(x => x.kind === 'family_updated').length, 1, 'a name change alone is not announced');
});

test('integrity: exchange check-ins and call logs are fingerprinted and cross-checked', async (t) => {
  const { base, db } = await start(t);
  const f = await family(base);
  const { id: ex } = await f.dad.post('/api/exchanges', { kind: 'pickup', location: 'School' });
  const { id: cl } = await f.mom.post('/api/calls', { started: '2026-11-20T18:00', status: 'completed', duration_min: 12 });
  await f.dad.post(`/api/calls/${cl}/confirm`, { agree: true }); // the answer columns may change
  assert.equal((await f.mom.get('/api/audit/verify')).ok, true);
  assert.throws(() => db.prepare('UPDATE exchanges SET at_ms = 0 WHERE id = ?').run(ex), /append-only/);
  assert.throws(() => db.prepare('UPDATE calls SET duration_min = 60 WHERE id = ?').run(cl), /cannot be edited/);
  // Someone with direct database access removes the triggers and edits both rows.
  db.exec('DROP TRIGGER exchanges_no_update; DROP TRIGGER calls_fixed_no_update;');
  db.prepare("UPDATE exchanges SET location = 'Park' WHERE id = ?").run(ex);
  db.prepare('UPDATE calls SET duration_min = 60 WHERE id = ?').run(cl);
  const v = await f.mom.get('/api/audit/verify');
  assert.equal(v.ok, false);
  assert.ok(v.problems.includes(`exchange ${ex} no longer matches the record saved when it was logged`));
  assert.ok(v.problems.includes(`call ${cl} no longer matches the record saved when it was logged`));
});
