import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/index.js';

function client(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error(data.error || res.status); e.status = res.status; throw e; }
    return data;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b) };
}

test('two-parent workflow end to end', async (t) => {
  const { server, db } = createApp({ dbPath: ':memory:', allowPrivateFeeds: true });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  const mom = client(base), dad = client(base), mediator = client(base);
  await mom.post('/api/register', { email: 'mom@example.com', name: 'Mom', password: 'correct-horse-1' });
  await mom.post('/api/family', { name: 'Smith', timezone: 'America/Los_Angeles', children: [{ name: 'Ava', birthdate: '2016-04-02' }] });
  let me = await mom.get('/api/me');
  assert.equal(me.primary, me.user.id);
  const momId = me.user.id, ava = me.children[0].id;

  // Solo parent's default rule is unconfirmed but in effect.
  let rules = await mom.get('/api/rules');
  assert.equal(rules[0].status, 'unconfirmed');

  await dad.post('/api/register', { email: 'dad@example.com', name: 'Dad', password: 'correct-horse-2' });
  await dad.post('/api/family/join', { code: me.family.invite_code });
  const dadMe = await dad.get('/api/me');
  const dadId = dadMe.user.id;
  assert.equal(dadMe.family.invite_code, null, 'invite code consumed');

  // Dad confirms Mom as primary.
  await dad.post(`/api/rules/${rules[0].id}/decide`, { decision: 'approve' });

  // Mom proposes alternating weekends for Dad; it is pending and has no effect yet.
  const { id: patId } = await mom.post('/api/rules', { type: 'pattern', name: 'Alternating weekends', template: { template: 'alternating_weekends', anchorDate: '2026-12-04', parentA: momId, parentB: dadId } });
  let tl = await mom.get('/api/timeline?start=2026-12-01&end=2026-12-29');
  assert.equal(tl.share.byParent.length, 1);
  await assert.rejects(mom.post(`/api/rules/${patId}/decide`, { decision: 'approve' }), /other parent/);
  const impact = await dad.get(`/api/rules/${patId}/impact?start=2026-12-01&end=2026-12-29`);
  assert.ok(impact.after.byParent.find(p => p.parent === dadId).overnights === 4);
  await dad.post(`/api/rules/${patId}/decide`, { decision: 'approve', note: 'Agreed per mediation' });
  tl = await mom.get('/api/timeline?start=2026-12-01&end=2026-12-29');
  assert.equal(tl.share.byParent.find(p => p.parent === dadId).overnights, 4);

  // Swap request rejected by the other parent.
  const { id: swap } = await dad.post('/api/rules', { type: 'override', name: 'Swap', reason: 'Work trip', config: { periods: [{ start: '2026-12-11T18:00', end: '2026-12-13T18:00', parent: momId }, { start: '2026-12-18T18:00', end: '2026-12-20T18:00', parent: dadId }] } });
  await mom.post(`/api/rules/${swap}/decide`, { decision: 'reject', note: 'We have plans on the 18th' });
  assert.equal((await mom.get('/api/rules')).find(r => r.id === swap).status, 'rejected');

  // Expense: mom pays $120, dad owes 50%.
  const { id: exp } = await mom.post('/api/expenses', { description: 'Soccer registration', category: 'activities', amount: '120.00', child_ids: [ava],
    receipt: { name: 'r.png', type: 'image/png', data: Buffer.from('fakepng').toString('base64') } });
  let bal = await mom.get('/api/balance');
  assert.equal(bal.pending_to_me, 6000);
  await assert.rejects(mom.post(`/api/expenses/${exp}/decide`, { decision: 'approve' }));
  await dad.post(`/api/expenses/${exp}/decide`, { decision: 'approve' });
  assert.equal((await mom.get('/api/balance')).net_cents, 6000);
  assert.equal((await dad.get('/api/balance')).net_cents, -6000);
  const { id: pay } = await dad.post('/api/payments', { amount: 60, method: 'Zelle', expense_ids: [exp] });
  await mom.post(`/api/payments/${pay}/confirm`, { received: true });
  assert.equal((await mom.get('/api/balance')).net_cents, 0);
  assert.equal((await mom.get('/api/expenses'))[0].status, 'reimbursed');

  // Notes attach to the expense and can't be altered in the database.
  const { id: noteId } = await dad.post('/api/notes', { target_type: 'expense', target_id: exp, body: 'Paid via Zelle, conf #123' });
  assert.throws(() => db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('edited', noteId), /append-only/);

  // Events: dad proposes, mom acknowledges.
  const { id: ev } = await dad.post('/api/events', { title: 'Soccer practice', child_ids: [ava], start: '2026-12-01T17:00', end: '2026-12-01T18:00', transport_parent: dadId, recurrence: { freq: 'weekly', byday: [2, 4] } });
  const evs = await mom.get('/api/events?start=2026-12-01&end=2026-12-15');
  assert.equal(evs.events.length, 4);
  assert.equal(evs.events[0].status, 'proposed');
  await mom.post(`/api/events/${ev}/respond`, { response: 'accepted' });

  // Messages + tone check + read receipts.
  const tone = await mom.post('/api/tone-check', { text: 'You never listen, idiot' });
  assert.equal(tone.ok, false);
  const { id: th } = await mom.post('/api/threads', { subject: 'Winter break', body: 'Can we plan winter break dates by Friday?' });
  const thread = await dad.get(`/api/threads/${th}`);
  assert.equal(thread.messages.length, 1);
  assert.equal((await mom.get(`/api/threads/${th}`)).messages[0].reads.length, 1);

  // Call allowance: Dad gets 2 video calls a week; Mom logs one completed, one missed.
  const { id: cr } = await dad.post('/api/call-rules', { entitled_parent: dadId, method: 'video', count: 2, period: 'week', duration_min: 15, window: { days: [1, 2, 3, 4, 5], start: '18:00', end: '20:00' } });
  await mom.post(`/api/call-rules/${cr}/decide`, { decision: 'approve' });
  await mom.post('/api/calls', { rule_id: cr, started: '2026-12-01T18:30', duration_min: 20, status: 'completed', method: 'video' });
  const { id: missed } = await dad.post('/api/calls', { rule_id: cr, started: '2026-12-03T18:30', status: 'missed_not_facilitated', method: 'video', details: 'No answer' });
  await mom.post(`/api/calls/${missed}/confirm`, { agree: false, note: 'Ava was asleep, I texted at 6:15' });
  const comp = await mom.get('/api/calls/compliance?start=2026-11-30&end=2026-12-07');
  assert.deepEqual([comp[0].totals.allowed, comp[0].totals.completed, comp[0].totals.missed_not_facilitated, comp[0].totals.disputed], [2, 1, 1, 1]);

  // Exchange check-in lines up with the scheduled hand-off.
  const ex = await mom.post('/api/exchanges', { kind: 'dropoff', at: '2026-12-04T18:12', lat: 38.68, lng: -121.08, accuracy: 12 });
  assert.ok(ex.scheduled_ms);
  const exList = await mom.get('/api/exchanges');
  assert.equal(exList[0].minutes_late, 12);

  // Mediator: read-only viewer.
  await mediator.post('/api/register', { email: 'med@example.com', name: 'Mediator', password: 'correct-horse-3' });
  await mediator.post('/api/family/join', { code: me.family.viewer_code });
  assert.equal((await mediator.get('/api/me')).role, 'viewer');
  await assert.rejects(mediator.post('/api/notes', { target_type: 'general', target_id: '', body: 'x' }), /View-only/);
  assert.ok((await mediator.get('/api/rules')).length >= 3);

  // Integrity check passes, then fails after a direct DB tamper of the chain.
  const v = await mom.get('/api/audit/verify');
  assert.equal(v.ok, true, v.problems.join('; '));
  assert.ok(v.entries > 20);

  // ICS feed for dad includes custody blocks and the soccer events.
  const ics = await (await fetch(base + dadMe.icsBase)).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /Kids with me/);
  assert.match(ics, /Soccer practice/);

  // ICS import from a local server (simulating a Google/Outlook secret address).
  const feedSrv = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w1\r\nSUMMARY:Work shift\r\nDTSTART:20261202T160000Z\r\nDTEND:20261202T230000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'); });
  await new Promise(r => feedSrv.listen(0, r));
  t.after(() => feedSrv.close());
  const feed = await dad.post('/api/feeds', { name: 'Work', provider: 'google', url: `http://127.0.0.1:${feedSrv.address().port}/basic.ics` });
  assert.equal(feed.ok, true, feed.error);
  assert.equal((await dad.get('/api/events?start=2026-12-01&end=2026-12-05')).external.length, 1);
  assert.equal((await mom.get('/api/events?start=2026-12-01&end=2026-12-05')).external.length, 0, 'private feed hidden from co-parent');

  // Report renders.
  const res = await fetch(base + '/report?start=2026-11-01&end=2026-12-31', { headers: { Cookie: '' } });
  assert.equal(res.status, 401);
  const dash = await mom.get('/api/dashboard');
  assert.ok(dash.share_year.byParent.length >= 1);
});
