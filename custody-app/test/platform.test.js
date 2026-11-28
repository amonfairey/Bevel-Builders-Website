// Platform features for the web portal + iPhone app: bearer auth, CORS, report links,
// notifications, push, exchange reminders, password change and account deletion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/index.js';
import { localToUtc } from '../server/time.js';

const TZ = 'America/Los_Angeles';
const HOUR = 3600000;

const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const stop = (srv) => { srv.close(); srv.closeAllConnections?.(); };

async function start(t, opts = {}) {
  const app = createApp({ dbPath: ':memory:', pushDisabled: true, ...opts });
  const base = await listen(app.server);
  t.after(() => stop(app.server));
  return { ...app, base };
}

async function call(base, method, path, { body, cookie, bearer, origin, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (origin) h.Origin = origin;
  const res = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

/** mode 'web' keeps the cookie (the portal); mode 'mobile' keeps the bearer token (the iPhone app). */
function client(base, mode = 'web') {
  const s = { cookie: '', token: null };
  async function req(method, path, body) {
    const r = await call(base, method, path, { body: method === 'GET' ? undefined : (body ?? {}), cookie: s.cookie, bearer: s.token });
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

const PW = { mom: 'correct-horse-1', dad: 'correct-horse-2', viewer: 'correct-horse-3' };

/** Mom on the web portal (cookie), Dad on the iPhone app (bearer), optional view-only mediator. */
async function family(base, { withViewer = true } = {}) {
  const mom = client(base), dad = client(base, 'mobile'), viewer = client(base);
  await mom.register('mom@example.com', 'Mom', PW.mom);
  await mom.post('/api/family', { name: 'Smith', timezone: TZ, children: [{ name: 'Ava', birthdate: '2016-04-02' }] });
  const first = await mom.get('/api/me');
  await dad.register('dad@example.com', 'Dad', PW.dad);
  await dad.post('/api/family/join', { code: first.family.invite_code });
  if (withViewer) {
    await viewer.register('med@example.com', 'Mediator', PW.viewer);
    await viewer.post('/api/family/join', { code: first.family.viewer_code });
  }
  const me = await mom.get('/api/me');
  const id = (name) => me.members.find(m => m.name === name)?.id;
  return { mom, dad, viewer, me, familyId: me.family.id, momId: id('Mom'), dadId: id('Dad'), viewerId: id('Mediator'), ava: me.children[0].id };
}

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 15));
  }
}

const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

test('native clients: bearer tokens instead of cookies', async (t) => {
  const { base, db } = await start(t);

  // Web flow is unchanged: cookie, no token in the body.
  const web = await call(base, 'POST', '/api/register', { body: { email: 'web@example.com', name: 'Web', password: 'correct-horse-1' } });
  assert.equal(web.status, 200);
  assert.deepEqual(web.data, { ok: true });
  assert.match(web.headers.get('set-cookie'), /^sid=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/);
  const webCookie = web.headers.get('set-cookie').split(';')[0];

  const reg = await call(base, 'POST', '/api/register', { body: { email: 'app@example.com', name: 'App', password: 'correct-horse-2', client: 'mobile' } });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.ok, true);
  assert.ok(reg.data.token.length >= 32);
  assert.equal(reg.headers.get('set-cookie'), null, 'no cookie for native clients');
  const me = await call(base, 'GET', '/api/me', { bearer: reg.data.token });
  assert.equal(me.data.user.name, 'App');
  assert.equal(me.data.unread_notifications, 0);
  assert.equal(me.data.family, null);

  const login = await call(base, 'POST', '/api/login', { body: { email: 'app@example.com', password: 'correct-horse-2', client: 'mobile' } });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('set-cookie'), null);
  const t2 = login.data.token;
  assert.ok(t2 && t2 !== reg.data.token);
  const webLogin = await call(base, 'POST', '/api/login', { body: { email: 'web@example.com', password: 'correct-horse-1' } });
  assert.ok(webLogin.headers.get('set-cookie'));
  assert.equal(webLogin.data.token, undefined);

  // Bearer takes precedence over another user's cookie.
  assert.equal((await call(base, 'GET', '/api/me', { bearer: t2, cookie: webCookie })).data.user.name, 'App');
  assert.equal((await call(base, 'GET', '/api/me', { cookie: webCookie })).data.user.name, 'Web');

  // Garbage bearer -> 401 (even with a valid cookie); no credentials -> {user:null}.
  assert.equal((await call(base, 'GET', '/api/me', { bearer: 'garbage' })).status, 401);
  assert.equal((await call(base, 'GET', '/api/notifications', { bearer: 'garbage', cookie: webCookie })).status, 401);
  assert.equal((await call(base, 'GET', '/api/me', { headers: { Authorization: 'Bearer' } })).status, 401);
  assert.deepEqual((await call(base, 'GET', '/api/me')).data, { user: null });
  // A stale token never blocks signing in again.
  assert.equal((await call(base, 'POST', '/api/login', { bearer: 'garbage', body: { email: 'app@example.com', password: 'correct-horse-2', client: 'mobile' } })).status, 200);

  // Bearer works for /report and family routes too.
  await call(base, 'POST', '/api/family', { bearer: t2, body: { name: 'App family', timezone: TZ } });
  const rep = await call(base, 'GET', '/report?start=2026-01-01&end=2026-12-31', { bearer: t2 });
  assert.equal(rep.status, 200);
  assert.match(rep.data, /Co-parenting record/);
  assert.equal((await call(base, 'GET', '/api/rules', { bearer: t2 })).status, 200);

  // Logout with a bearer deletes exactly that session and sets no cookie.
  const out = await call(base, 'POST', '/api/logout', { bearer: t2, body: {} });
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('set-cookie'), null);
  assert.equal((await call(base, 'GET', '/api/me', { bearer: t2 })).status, 401);
  assert.equal((await call(base, 'GET', '/api/me', { bearer: reg.data.token })).data.user.name, 'App');

  // Expired bearer -> 401 (30-day sessions, same table as cookies).
  db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() - 1000, reg.data.token);
  assert.equal((await call(base, 'GET', '/api/me', { bearer: reg.data.token })).status, 401);

  // Cookie logout still clears the cookie.
  const webOut = await call(base, 'POST', '/api/logout', { cookie: webCookie, body: {} });
  assert.match(webOut.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual((await call(base, 'GET', '/api/me', { cookie: webCookie })).data, { user: null });
});

test('CORS only for the configured dev origins', async (t) => {
  const { base } = await start(t, { corsOrigins: ['http://localhost:8081', 'http://localhost:19006'] });
  const ok = 'http://localhost:8081', evil = 'https://evil.example';
  const hasCors = (r, origin = ok) => {
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.match(r.headers.get('vary') || '', /Origin/);
    assert.equal(r.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
    assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, OPTIONS');
    assert.equal(r.headers.get('access-control-max-age'), '600');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  };
  const noCors = (r) => {
    for (const h of ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'access-control-max-age', 'access-control-allow-credentials']) assert.equal(r.headers.get(h), null, h);
  };

  const r200 = await call(base, 'GET', '/api/me', { origin: ok });
  assert.equal(r200.status, 200); hasCors(r200);
  const r401 = await call(base, 'GET', '/api/notifications', { origin: ok });
  assert.equal(r401.status, 401); hasCors(r401);
  const r400 = await call(base, 'POST', '/api/register', { origin: ok, body: { email: 'not-an-email' } });
  assert.equal(r400.status, 400); hasCors(r400);
  const reg = await call(base, 'POST', '/api/register', { origin: ok, body: { email: 'a@example.com', name: 'A', password: 'correct-horse-1', client: 'mobile' } });
  hasCors(reg);
  const r404 = await call(base, 'GET', '/api/does-not-exist', { origin: ok, bearer: reg.data.token });
  assert.equal(r404.status, 404); hasCors(r404);
  const pre = await call(base, 'OPTIONS', '/api/login', { origin: ok, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(pre.status, 204); hasCors(pre);
  hasCors(await call(base, 'GET', '/api/me', { origin: 'http://localhost:19006' }), 'http://localhost:19006');

  noCors(await call(base, 'GET', '/api/me', { origin: evil }));
  noCors(await call(base, 'GET', '/api/notifications', { origin: evil }));
  noCors(await call(base, 'GET', '/api/me', { origin: 'http://localhost:8081.evil.example' }));
  const evilPre = await call(base, 'OPTIONS', '/api/login', { origin: evil });
  assert.equal(evilPre.status, 204); noCors(evilPre);
  noCors(await call(base, 'GET', '/api/me'));

  const plain = await start(t); // CORS_ORIGINS unset: never any CORS headers
  noCors(await call(plain.base, 'GET', '/api/me', { origin: ok }));
});

test('report links open the printable report without a session', async (t) => {
  const { base, db } = await start(t);
  const { mom, dad } = await family(base, { withViewer: false });
  const link = await dad.post('/api/report-link', { start: '2026-01-01', end: '2026-12-31' });
  assert.match(link.url, /^\/report\?rt=[\w-]{32,}&start=2026-01-01&end=2026-12-31$/);
  const exp = Date.parse(link.expires_at);
  assert.ok(exp > Date.now() + 14 * 60000 && exp <= Date.now() + 15 * 60000 + 1000);

  const r = await call(base, 'GET', link.url); // no cookie, no bearer (Safari)
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.data, /Co-parenting record/);
  assert.equal((await call(base, 'GET', link.url)).status, 200, 'reusable inside the window');

  assert.equal((await call(base, 'GET', '/report?rt=not-a-real-token&start=2026-01-01')).status, 401);
  assert.equal((await call(base, 'GET', '/report?start=2026-01-01')).status, 401);
  const rt = new URL(link.url, base).searchParams.get('rt');
  db.prepare('UPDATE report_links SET expires = ? WHERE token = ?').run(Date.now() - 1000, rt);
  assert.equal((await call(base, 'GET', link.url)).status, 401, 'expired');

  const def = await mom.post('/api/report-link', {});
  assert.match(def.url, /^\/report\?rt=[\w-]+&start=\d{4}-01-01&end=\d{4}-\d{2}-\d{2}$/);
  assert.equal((await mom.req('POST', '/api/report-link', { start: 'last week' })).status, 400);
  assert.equal((await mom.req('POST', '/api/report-link', { start: '2026-05-01', end: '2026-04-01' })).status, 400);
  const solo = client(base, 'mobile');
  await solo.register('solo@example.com', 'Solo', 'correct-horse-9');
  assert.equal((await solo.req('POST', '/api/report-link', {})).status, 403, 'family membership required');
});

test('notifications reach the other parent only', async (t) => {
  const { base } = await start(t);
  const { mom, dad, viewer, momId, dadId } = await family(base);
  const kinds = async (cl) => (await cl.get('/api/notifications')).map(n => n.kind).reverse(); // oldest first

  // Dad confirms Mom as primary, then proposes a swap that Mom declines.
  const rules = await dad.get('/api/rules');
  await dad.post(`/api/rules/${rules[0].id}/decide`, { decision: 'approve' });
  const { id: swap } = await dad.post('/api/rules', { type: 'override', name: 'Swap', reason: 'Work trip', config: { periods: [{ start: '2026-12-11T18:00', end: '2026-12-13T18:00', parent: momId }] } });
  await mom.post(`/api/rules/${swap}/decide`, { decision: 'reject', note: 'We have plans' });
  // Expense and payment round trip.
  const { id: exp } = await mom.post('/api/expenses', { description: 'Soccer registration', amount: '120.00' });
  await dad.post(`/api/expenses/${exp}/decide`, { decision: 'approve' });
  const { id: pay } = await dad.post('/api/payments', { amount: 60, method: 'Zelle', expense_ids: [exp] });
  await mom.post(`/api/payments/${pay}/confirm`, { received: true });
  // Message (body is the first 120 characters).
  const long = 'Can we plan winter break? '.repeat(10);
  const { id: th } = await mom.post('/api/threads', { subject: 'Winter break', body: long });
  // Activity proposed and acknowledged.
  const { id: ev } = await dad.post('/api/events', { title: 'Soccer practice', start: '2026-12-01T17:00', end: '2026-12-01T18:00' });
  await mom.post(`/api/events/${ev}/respond`, { response: 'accepted' });
  // Calls.
  const { id: cr } = await dad.post('/api/call-rules', { entitled_parent: dadId, method: 'video', count: 2, period: 'week' });
  await mom.post(`/api/call-rules/${cr}/decide`, { decision: 'approve' });
  const { id: callId } = await mom.post('/api/calls', { rule_id: cr, started: '2026-12-01T18:30', duration_min: 20, status: 'completed', method: 'video' });
  await dad.post(`/api/calls/${callId}/confirm`, { agree: true });
  // Exchange check-in and a request to end a schedule item.
  await mom.post('/api/exchanges', { kind: 'dropoff' });
  await dad.post(`/api/rules/${rules[0].id}/retire`, { note: 'New order' });
  await mom.post(`/api/rules/${rules[0].id}/retire-decide`, { decision: 'reject' });

  assert.deepEqual(await kinds(mom), ['member_joined', 'member_joined', 'rule_decided', 'rule_requested', 'expense_decided', 'payment_sent',
    'event_proposed', 'call_rule_requested', 'call_confirmed', 'rule_retire_requested']);
  assert.deepEqual(await kinds(dad), ['member_joined', 'rule_decided', 'expense_requested', 'payment_confirmed', 'message', 'event_responded',
    'call_rule_decided', 'call_logged', 'exchange_checkin', 'rule_retire_decided']);
  assert.deepEqual(await kinds(viewer), [], 'viewers get no notifications');

  const momN = await mom.get('/api/notifications'), dadN = await dad.get('/api/notifications');
  const byKind = (list, k) => list.find(n => n.kind === k);
  const msg = byKind(dadN, 'message');
  assert.equal(msg.title, 'New message from Mom');
  assert.equal(msg.body, long.trim().slice(0, 120).trim());
  assert.equal(msg.link, `messages/${th}`);
  assert.equal(msg.entity, 'message');
  assert.equal(msg.read_at, null);
  assert.deepEqual(Object.keys(msg).sort(), ['body', 'created_at', 'entity', 'entity_id', 'id', 'kind', 'link', 'read_at', 'title']);
  assert.equal(byKind(momN, 'rule_requested').title, 'Dad requested a schedule change');
  assert.equal(byKind(momN, 'rule_requested').link, 'schedule');
  assert.equal(byKind(momN, 'rule_requested').entity_id, String(swap));
  assert.equal(byKind(dadN, 'rule_decided').title, 'Mom declined your schedule request');
  assert.equal(byKind(dadN, 'expense_requested').body, 'Soccer registration: $60.00 of $120.00');
  assert.equal(byKind(dadN, 'expense_requested').link, 'expenses');
  assert.equal(byKind(momN, 'expense_decided').title, 'Dad approved an expense');
  assert.equal(byKind(momN, 'payment_sent').link, 'expenses');
  assert.equal(byKind(dadN, 'payment_confirmed').title, 'Mom confirmed your payment');
  assert.equal(byKind(momN, 'event_proposed').link, 'activities');
  assert.match(byKind(momN, 'event_proposed').body, /^Soccer practice · Tue, Dec 1, 5:00 PM$/);
  assert.equal(byKind(dadN, 'event_responded').title, 'Mom accepted an activity');
  assert.equal(byKind(dadN, 'call_logged').link, 'calls');
  assert.equal(byKind(dadN, 'exchange_checkin').link, 'exchanges');
  assert.equal(byKind(momN, 'member_joined').link, 'settings');

  // Unread counts on /api/me, mark-read by ids and all, scoped to the caller.
  assert.equal((await mom.get('/api/me')).unread_notifications, 10);
  assert.equal((await dad.get('/api/me')).unread_notifications, 10);
  assert.equal((await viewer.get('/api/me')).unread_notifications, 0);
  const r1 = await mom.post('/api/notifications/read', { ids: [momN[0].id, momN[1].id, dadN[0].id] });
  assert.deepEqual(r1, { ok: true, unread: 8 });
  assert.equal((await dad.get('/api/me')).unread_notifications, 10, "another user's ids are not affected");
  assert.ok((await mom.get('/api/notifications'))[0].read_at);
  assert.equal((await mom.req('POST', '/api/notifications/read', { ids: 'all' })).status, 400);
  assert.deepEqual(await mom.post('/api/notifications/read', { all: true }), { ok: true, unread: 0 });
  assert.equal((await dad.get('/api/me')).unread_notifications, 10);
  assert.deepEqual(await viewer.post('/api/notifications/read', { all: true }), { ok: true, unread: 0 });

  // Opening the thread marks its message notification read.
  await dad.get(`/api/threads/${th}`);
  assert.equal((await dad.get('/api/me')).unread_notifications, 9);

  // Paging: newest first, `before` continues.
  const p1 = await dad.get('/api/notifications?limit=4');
  const p2 = await dad.get(`/api/notifications?limit=4&before=${p1[3].id}`);
  assert.equal(p1.length, 4);
  assert.ok(p1.every((n, i) => i === 0 || n.id < p1[i - 1].id));
  assert.ok(p2.every(n => n.id < p1[3].id));
  assert.deepEqual([...p1, ...p2, ...(await dad.get(`/api/notifications?before=${p2[3].id}`))].map(n => n.id), dadN.map(n => n.id));
});

test('push goes to the recipient devices in Expo format', async (t) => {
  const received = [];
  let notRegistered = new Set();
  const mock = createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const msgs = JSON.parse(raw);
      received.push({ headers: req.headers, url: req.url, msgs });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: msgs.map(m => (notRegistered.has(m.to)
        ? { status: 'error', message: `"${m.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: `ticket-${m.data.notification_id}` })) }));
    });
  });
  const mockBase = await listen(mock);
  t.after(() => stop(mock));
  const { base, db } = await start(t, { pushDisabled: false, pushUrl: `${mockBase}/--/api/v2/push/send` });
  const f = await family(base);
  const phone = 'ExponentPushToken[dad-phone_1]', ipad = 'ExponentPushToken[dad-ipad]', momTok = 'ExpoPushToken[mom-phone]', viewerTok = 'ExponentPushToken[viewer-1]';
  const tokenRow = (tk) => db.prepare('SELECT * FROM push_tokens WHERE token = ?').get(tk);

  // Validation.
  for (const bad of ['abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'ExponentPushToken[x]; DROP TABLE users', 42]) {
    assert.equal((await f.dad.req('POST', '/api/push-tokens', { token: bad, platform: 'ios' })).status, 400, String(bad));
  }
  assert.equal((await f.dad.req('POST', '/api/push-tokens', { token: phone, platform: 'windows' })).status, 400);

  await f.dad.post('/api/push-tokens', { token: phone, platform: 'ios' });
  await f.dad.post('/api/push-tokens', { token: phone, platform: 'ios' }); // idempotent upsert
  const dadIpad = client(base, 'mobile');
  await dadIpad.login('dad@example.com', PW.dad);
  await dadIpad.post('/api/push-tokens', { token: ipad, platform: 'ios' });
  await f.mom.post('/api/push-tokens', { token: momTok, platform: 'android' });
  await f.viewer.post('/api/push-tokens', { token: viewerTok, platform: 'ios' });
  assert.equal(count(db, 'SELECT COUNT(*) n FROM push_tokens WHERE user_id = ?', f.dadId), 2);
  await new Promise(r => setTimeout(r, 50));
  received.length = 0;

  notRegistered = new Set([ipad]);
  const { id: th } = await f.mom.post('/api/threads', { subject: 'Pickup', body: 'Running 10 minutes late today.' });
  await waitFor(() => received.length >= 1);
  const msgs = received.flatMap(r => r.msgs);
  assert.deepEqual(msgs.map(m => m.to).sort(), [ipad, phone].sort(), 'only the recipient, never the actor or the viewer');
  assert.equal(received[0].url, '/--/api/v2/push/send');
  assert.equal(received[0].headers['content-type'], 'application/json');
  assert.equal(received[0].headers.accept, 'application/json');
  const dadList = await f.dad.get('/api/notifications');
  const m = msgs.find(x => x.to === phone);
  assert.deepEqual(m, {
    to: phone, title: 'New message from Mom', body: 'Running 10 minutes late today.', sound: 'default',
    badge: dadList.filter(n => !n.read_at).length, data: { link: `messages/${th}`, notification_id: dadList[0].id },
  });
  assert.equal(m.badge, 2, 'member_joined (viewer) + this message');

  // DeviceNotRegistered removes that token; the other stays.
  await waitFor(() => !tokenRow(ipad));
  assert.ok(tokenRow(phone));

  // The next notification to Dad carries the higher badge and only goes to the live device.
  received.length = 0;
  await f.mom.post(`/api/threads/${th}/messages`, { body: 'Here now.' });
  await waitFor(() => received.length >= 1);
  assert.deepEqual(received.flatMap(r => r.msgs).map(x => [x.to, x.badge]), [[phone, 3]]);

  // Push to Mom when Dad acts.
  received.length = 0;
  await f.dad.post(`/api/threads/${th}/messages`, { body: 'Thanks, see you soon.' });
  await waitFor(() => received.length >= 1);
  assert.deepEqual(received.flatMap(r => r.msgs).map(x => x.to), [momTok]);

  // A token registered by another user moves to them; remove only affects the caller's own token.
  await f.mom.post('/api/push-tokens', { token: phone, platform: 'ios' });
  assert.equal(tokenRow(phone).user_id, f.momId);
  await f.dad.post('/api/push-tokens/remove', { token: momTok });
  assert.ok(tokenRow(momTok));
  await f.mom.post('/api/push-tokens/remove', { token: momTok });
  assert.equal(tokenRow(momTok), undefined);

  // Signing out on a device stops pushes to it.
  const again = 'ExponentPushToken[dad-phone-2]';
  await f.dad.post('/api/push-tokens', { token: again, platform: 'ios' });
  await f.dad.post('/api/logout');
  assert.equal(tokenRow(again), undefined);
});

test('push failures never break the request', async (t) => {
  const { base } = await start(t, { pushDisabled: false, pushUrl: 'http://127.0.0.1:9/unreachable' });
  const f = await family(base, { withViewer: false });
  await f.dad.post('/api/push-tokens', { token: 'ExponentPushToken[dad]', platform: 'ios' });
  const { id } = await f.mom.post('/api/threads', { subject: 'Hi', body: 'Hello' });
  assert.ok(id);
  assert.equal((await f.dad.get('/api/notifications'))[0].kind, 'message');
  await new Promise(r => setTimeout(r, 100)); // let the failed push settle (logged, swallowed)
});

test('exchange reminders: a day before and an hour before, once each', async (t) => {
  const { base, sweepReminders } = await start(t);
  const f = await family(base);
  const rules = await f.dad.get('/api/rules');
  await f.dad.post(`/api/rules/${rules[0].id}/decide`, { decision: 'approve' });
  const { id } = await f.mom.post('/api/rules', { type: 'pattern', name: 'Alternating weekends', template: { template: 'alternating_weekends', anchorDate: '2026-12-04', parentA: f.momId, parentB: f.dadId } });
  await f.dad.post(`/api/rules/${id}/decide`, { decision: 'approve' });
  const friday = localToUtc('2026-12-04', '18:00', TZ), sunday = localToUtc('2026-12-06', '18:00', TZ);
  const reminders = async (cl) => (await cl.get('/api/notifications')).filter(n => n.kind === 'exchange_reminder');

  assert.equal(sweepReminders(friday - 23 * HOUR), 1);
  for (const p of [f.mom, f.dad]) {
    const r = await reminders(p);
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'Exchange tomorrow');
    assert.equal(r[0].body, 'Mom → Dad at 6:00 PM');
    assert.equal(r[0].link, 'calendar');
    assert.equal(r[0].entity_id, String(friday));
  }
  assert.equal((await reminders(f.viewer)).length, 0);
  assert.equal(sweepReminders(friday - 23 * HOUR), 0, 'no duplicates');
  assert.equal(sweepReminders(friday - 22 * HOUR), 0, 'no duplicates on the next sweep');

  assert.equal(sweepReminders(friday - 50 * 60000), 1);
  for (const p of [f.mom, f.dad]) {
    const r = await reminders(p);
    assert.equal(r.length, 2);
    assert.equal(r[0].title, 'Exchange in 1 hour');
  }
  assert.equal(sweepReminders(friday - 45 * 60000), 0);
  assert.equal(sweepReminders(friday - 5 * 60000), 0);

  // Same-day reminder for the Sunday return.
  assert.equal(sweepReminders(sunday - 10 * HOUR), 1);
  const r = await reminders(f.dad);
  assert.equal(r[0].title, 'Exchange today');
  assert.equal(r[0].body, 'Dad → Mom at 6:00 PM');
  assert.equal((await f.dad.get('/api/me')).unread_notifications, (await f.dad.get('/api/notifications')).filter(n => !n.read_at).length);
});

test('change password signs out every other device', async (t) => {
  const { base, db } = await start(t);
  const web = client(base);
  await web.register('pat@example.com', 'Pat', 'old-password-1');
  await web.post('/api/family', { name: 'Pat family', timezone: TZ });
  const phone = client(base, 'mobile'), tablet = client(base, 'mobile');
  await phone.login('pat@example.com', 'old-password-1');
  await tablet.login('pat@example.com', 'old-password-1');
  await tablet.post('/api/push-tokens', { token: 'ExponentPushToken[tablet]', platform: 'ios' });
  await phone.post('/api/push-tokens', { token: 'ExponentPushToken[phone]', platform: 'ios' });

  assert.equal((await phone.req('POST', '/api/account/password', { current: 'wrong-password', next: 'new-password-1' })).status, 400);
  assert.equal((await phone.req('POST', '/api/account/password', { current: 'old-password-1', next: 'short' })).status, 400);
  assert.deepEqual(await phone.post('/api/account/password', { current: 'old-password-1', next: 'new-password-1' }), { ok: true });

  assert.equal((await phone.get('/api/me')).user.name, 'Pat', 'the session used for the change keeps working');
  assert.equal((await tablet.req('GET', '/api/me')).status, 401);
  assert.deepEqual((await web.req('GET', '/api/me')).data, { user: null });
  assert.equal((await web.req('GET', '/api/rules')).status, 401);
  assert.equal(count(db, "SELECT COUNT(*) n FROM push_tokens WHERE token = 'ExponentPushToken[tablet]'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM push_tokens WHERE token = 'ExponentPushToken[phone]'"), 1);

  assert.equal((await call(base, 'POST', '/api/login', { body: { email: 'pat@example.com', password: 'old-password-1' } })).status, 401);
  assert.equal((await call(base, 'POST', '/api/login', { body: { email: 'pat@example.com', password: 'new-password-1' } })).status, 200);

  const auditRows = await phone.get('/api/audit');
  const entry = auditRows.find(a => a.action === 'change_password');
  assert.ok(entry);
  assert.deepEqual(entry.data, {});
  assert.ok(!JSON.stringify(auditRows).includes('password-1'), 'no password material in the audit log');
  assert.equal((await phone.get('/api/audit/verify')).ok, true);
});

test('delete account with a co-parent: anonymized, shared records kept', async (t) => {
  const { base, db } = await start(t);
  const f = await family(base);
  const { id: th } = await f.mom.post('/api/threads', { subject: 'School', body: 'Parent-teacher night is Thursday.' });
  await f.dad.post(`/api/threads/${th}/messages`, { body: 'I will be there.' });
  await f.dad.get(`/api/threads/${th}`);
  await f.dad.post('/api/notes', { target_type: 'general', target_id: '', body: 'Journal entry' });
  await f.dad.post('/api/push-tokens', { token: 'ExponentPushToken[dad]', platform: 'ios' });
  const link = await f.dad.post('/api/report-link', {});
  const { id: exp } = await f.dad.post('/api/expenses', { description: 'Dentist', amount: 80 });
  const momUnreadBefore = (await f.mom.get('/api/me')).unread_notifications;

  assert.equal((await f.dad.req('POST', '/api/account/delete', { password: 'not-my-password' })).status, 400);
  assert.equal((await f.dad.req('POST', '/api/account/delete', {})).status, 400);
  const del = await f.dad.req('POST', '/api/account/delete', { password: PW.dad });
  assert.equal(del.status, 200);
  assert.deepEqual(del.data, { ok: true });
  assert.match(del.headers.get('set-cookie'), /^sid=; .*Max-Age=0/);

  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(f.dadId);
  assert.equal(u.name, 'Deleted user');
  assert.equal(u.email, `deleted-${f.dadId}@invalid`);
  for (const tbl of ['sessions', 'push_tokens', 'report_links', 'notifications']) assert.equal(count(db, `SELECT COUNT(*) n FROM ${tbl} WHERE user_id = ?`, f.dadId), 0, tbl);
  assert.equal(db.prepare('SELECT role FROM members WHERE user_id = ?').get(f.dadId).role, 'parent', 'parent keeps the members row');

  assert.equal((await f.dad.req('GET', '/api/me')).status, 401);
  assert.equal((await call(base, 'POST', '/api/login', { body: { email: 'dad@example.com', password: PW.dad } })).status, 401);
  assert.equal((await call(base, 'GET', link.url)).status, 401);

  // The other parent's record is intact and still attributed.
  const thread = await f.mom.get(`/api/threads/${th}`);
  assert.deepEqual(thread.messages.map(m => [m.author_name, m.body]), [['Mom', 'Parent-teacher night is Thursday.'], ['Deleted user', 'I will be there.']]);
  assert.equal(thread.messages[0].reads[0].user, 'Deleted user');
  assert.equal((await f.mom.get('/api/expenses')).find(e => e.id === exp).paid_by, f.dadId);
  const v = await f.mom.get('/api/audit/verify');
  assert.equal(v.ok, true, v.problems.join('; '));
  assert.ok((await f.mom.get('/api/audit')).some(a => a.action === 'delete_account' && a.entity_id === String(f.dadId)));
  const left = (await f.mom.get('/api/notifications')).filter(n => n.kind === 'member_left');
  assert.equal(left.length, 1);
  assert.equal(left[0].title, 'Dad deleted their account');
  assert.equal(left[0].link, 'settings');
  assert.equal(left[0].read_at, null);
  assert.equal((await f.mom.get('/api/me')).unread_notifications, momUnreadBefore, '+1 member_left, -1 message read by opening the thread');
  assert.equal((await f.viewer.get('/api/notifications')).length, 0);

  // The email address is free again.
  assert.equal((await call(base, 'POST', '/api/register', { body: { email: 'dad@example.com', name: 'Dad', password: PW.dad } })).status, 200);

  // A viewer leaving loses the members row; parents are told.
  await f.viewer.post('/api/account/delete', { password: PW.viewer });
  assert.equal(db.prepare('SELECT 1 FROM members WHERE user_id = ?').get(f.viewerId), undefined);
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get(f.viewerId).name, 'Deleted user');
  assert.equal((await f.mom.get('/api/notifications')).filter(n => n.kind === 'member_left').length, 2);
  assert.equal((await f.mom.get('/api/audit/verify')).ok, true);
  assert.equal((await f.mom.get('/api/me')).members.length, 2);
  // The viewer's members row is gone, but their audit entry still resolves to the users row.
  const viewerLeft = (await f.mom.get('/api/audit')).find(a => a.action === 'delete_account' && a.entity_id === String(f.viewerId));
  assert.equal(viewerLeft.user_name, 'Deleted user');
});

test('delete account as the last member purges the whole family', async (t) => {
  const icsSrv = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w1\r\nSUMMARY:Work shift\r\nDTSTART:20261202T160000Z\r\nDTEND:20261202T230000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  });
  const icsBase = await listen(icsSrv);
  t.after(() => stop(icsSrv));
  const { base, db, sweepReminders } = await start(t, { allowPrivateFeeds: true });

  // An unrelated family whose records must survive.
  const olive = client(base);
  await olive.register('olive@example.com', 'Olive', 'correct-horse-7');
  await olive.post('/api/family', { name: 'Other', timezone: TZ });
  await olive.post('/api/threads', { subject: 'Kept', body: 'This stays.' });
  await olive.post('/api/notes', { target_type: 'general', target_id: '', body: 'Kept note' });
  const otherFid = (await olive.get('/api/me')).family.id;
  const otherMsg = db.prepare('SELECT id FROM messages WHERE family_id = ?').get(otherFid).id;

  // A family with a record of everything.
  const f = await family(base);
  const { mom, dad, viewer, momId, dadId, ava, familyId: fid } = f;
  const rules = await dad.get('/api/rules');
  await dad.post(`/api/rules/${rules[0].id}/decide`, { decision: 'approve' });
  const { id: pat } = await mom.post('/api/rules', { type: 'pattern', name: 'Alternating weekends', template: { template: 'alternating_weekends', anchorDate: '2026-12-04', parentA: momId, parentB: dadId } });
  await dad.post(`/api/rules/${pat}/decide`, { decision: 'approve' });
  const { id: ev } = await dad.post('/api/events', { title: 'Soccer', child_ids: [ava], start: '2026-12-01T17:00', end: '2026-12-01T18:00' });
  await mom.post(`/api/events/${ev}/respond`, { response: 'accepted' });
  const { id: exp } = await mom.post('/api/expenses', { description: 'Cleats', amount: 50, child_ids: [ava], receipt: { name: 'r.png', type: 'image/png', data: Buffer.from('png').toString('base64') } });
  await dad.post(`/api/expenses/${exp}/decide`, { decision: 'approve' });
  const { id: pay } = await dad.post('/api/payments', { amount: 25, expense_ids: [exp] });
  await mom.post(`/api/payments/${pay}/confirm`, { received: true });
  await mom.post('/api/notes', { target_type: 'expense', target_id: exp, body: 'Receipt attached', attachment: { name: 'n.pdf', type: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } });
  const { id: th } = await mom.post('/api/threads', { subject: 'Hi', body: 'First' });
  await dad.post(`/api/threads/${th}/messages`, { body: 'Second' });
  await dad.get(`/api/threads/${th}`);
  await mom.get(`/api/threads/${th}`);
  const { id: cr } = await dad.post('/api/call-rules', { entitled_parent: dadId, count: 1, period: 'day' });
  await mom.post(`/api/call-rules/${cr}/decide`, { decision: 'approve' });
  await mom.post('/api/calls', { rule_id: cr, started: '2026-12-01T19:00', status: 'completed', duration_min: 10 });
  await mom.post('/api/exchanges', { kind: 'pickup', lat: 38.6, lng: -121.1 });
  const feed = await mom.post('/api/feeds', { name: 'Work', provider: 'google', url: `${icsBase}/w.ics`, visibility: 'family' });
  assert.equal(feed.ok, true, feed.error);
  await mom.post('/api/push-tokens', { token: 'ExponentPushToken[mom]', platform: 'ios' });
  await mom.post('/api/report-link', {});
  assert.equal(sweepReminders(localToUtc('2026-12-04', '18:00', TZ) - 23 * HOUR), 1);
  for (const tbl of ['rules', 'events', 'expenses', 'payments', 'notes', 'files', 'threads', 'messages', 'call_rules', 'calls', 'exchanges', 'feeds', 'children', 'audit', 'notifications', 'reminders_sent']) {
    assert.ok(count(db, `SELECT COUNT(*) n FROM ${tbl} WHERE family_id = ?`, fid) > 0, `fixture has ${tbl}`);
  }
  assert.ok(count(db, 'SELECT COUNT(*) n FROM message_reads') > 0);
  assert.ok(count(db, 'SELECT COUNT(*) n FROM feed_events') > 0);

  // Viewer and Dad leave first (anonymized); Mom is then the last real member, so everything goes.
  await viewer.post('/api/account/delete', { password: PW.viewer });
  await dad.post('/api/account/delete', { password: PW.dad });
  const del = await mom.req('POST', '/api/account/delete', { password: PW.mom });
  assert.equal(del.status, 200);
  assert.match(del.headers.get('set-cookie'), /Max-Age=0/);

  const familyTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(x => x.name)
    .filter(tbl => db.prepare(`PRAGMA table_info(${tbl})`).all().some(col => col.name === 'family_id'));
  assert.ok(familyTables.length >= 17, familyTables.join(','));
  for (const tbl of familyTables) assert.equal(count(db, `SELECT COUNT(*) n FROM ${tbl} WHERE family_id = ?`, fid), 0, tbl);
  assert.equal(db.prepare('SELECT 1 FROM families WHERE id = ?').get(fid), undefined);
  for (const uid of [momId, dadId, f.viewerId]) {
    assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid), undefined, `user ${uid}`);
    for (const tbl of ['sessions', 'push_tokens', 'report_links', 'notifications']) assert.equal(count(db, `SELECT COUNT(*) n FROM ${tbl} WHERE user_id = ?`, uid), 0, tbl);
  }
  assert.equal(count(db, 'SELECT COUNT(*) n FROM message_reads'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM feed_events'), 0);
  assert.equal((await mom.req('GET', '/api/me')).data.user, null);

  // The append-only protections are back and still guard everyone else's records.
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map(x => x.name);
  assert.deepEqual(triggers, ['audit_no_delete', 'audit_no_update', 'messages_no_delete', 'messages_no_update', 'notes_no_delete', 'notes_no_update']);
  assert.throws(() => db.prepare('UPDATE messages SET body = ? WHERE id = ?').run('edited', otherMsg), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM messages WHERE id = ?').run(otherMsg), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM notes WHERE family_id = ?').run(otherFid), /append-only/);
  assert.throws(() => db.prepare('UPDATE audit SET data = ? WHERE family_id = ?').run('{}', otherFid), /append-only/);
  assert.equal((await olive.get('/api/audit/verify')).ok, true);
  assert.equal((await olive.get('/api/threads')).length, 1);

  // Never had a co-parent: same purge.
  const solo = client(base, 'mobile');
  await solo.register('solo@example.com', 'Solo', 'correct-horse-8');
  await solo.post('/api/family', { name: 'Solo', timezone: TZ, children: [{ name: 'Kid' }] });
  await solo.post('/api/threads', { subject: 'Note to self', body: 'Hello' });
  const soloMe = await solo.get('/api/me');
  await solo.post('/api/account/delete', { password: 'correct-horse-8' });
  for (const tbl of familyTables) assert.equal(count(db, `SELECT COUNT(*) n FROM ${tbl} WHERE family_id = ?`, soloMe.family.id), 0, tbl);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(soloMe.user.id), undefined);

  // No family at all.
  const lone = client(base, 'mobile');
  await lone.register('lone@example.com', 'Lone', 'correct-horse-6');
  const loneId = (await lone.get('/api/me')).user.id;
  await lone.post('/api/account/delete', { password: 'correct-horse-6' });
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(loneId), undefined);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM sessions WHERE user_id = ?', loneId), 0);
});

test('health check and public config need no sign-in', async (t) => {
  const a = await start(t);
  const h = await call(a.base, 'GET', '/healthz');
  assert.equal(h.status, 200);
  assert.deepEqual(h.data, { ok: true });
  assert.deepEqual((await call(a.base, 'GET', '/api/public-config')).data, { appStoreUrl: null, testflightUrl: null });
  assert.equal((await call(a.base, 'GET', '/api/public-config', { bearer: 'stale-token' })).status, 200);

  const b = await start(t, { appStoreUrl: 'https://apps.apple.com/app/id123', testflightUrl: 'https://testflight.apple.com/join/abc' });
  assert.deepEqual((await call(b.base, 'GET', '/api/public-config')).data, { appStoreUrl: 'https://apps.apple.com/app/id123', testflightUrl: 'https://testflight.apple.com/join/abc' });
});

test('sign-up is rate limited per IP', async (t) => {
  const reg = (base, i, ip) => call(base, 'POST', '/api/register', { headers: { 'X-Forwarded-For': `${ip}, 10.0.0.1` }, body: { email: `u${i}@example.com`, name: 'U', password: 'correct-horse-1' } });
  const proxied = await start(t, { trustProxy: true });
  for (let i = 0; i < 10; i++) assert.equal((await reg(proxied.base, i, '203.0.113.5')).status, 200);
  assert.equal((await reg(proxied.base, 10, '203.0.113.5')).status, 429);
  assert.equal((await reg(proxied.base, 11, '198.51.100.7')).status, 200, 'separate client IP behind the proxy');

  const direct = await start(t); // X-Forwarded-For is ignored unless TRUST_PROXY is set
  for (let i = 0; i < 10; i++) assert.equal((await reg(direct.base, i, `192.0.2.${i}`)).status, 200);
  assert.equal((await reg(direct.base, 10, '192.0.2.99')).status, 429);
});

test('a deleted co-parent stops counting: unconfirmed requests, fresh invite code, a new co-parent confirms', async (t) => {
  const { base } = await start(t);
  const f = await family(base);
  const { mom, dad, viewer, momId, dadId } = f;
  const rules0 = await dad.get('/api/rules');
  await dad.post(`/api/rules/${rules0[0].id}/decide`, { decision: 'approve' });
  assert.equal(f.me.family.invite_code, null, 'consumed when Dad joined');
  // Before the deletion: two pending requests from Mom that need Dad, an approved expense Dad owes on.
  const dd = (n) => String(n).padStart(2, '0');
  const swap = (d) => ({ type: 'override', name: `Swap ${d}`, config: { periods: [{ start: `2026-12-${dd(d)}T18:00`, end: `2026-12-${dd(d + 1)}T18:00`, parent: momId }] } });
  const { id: p1 } = await mom.post('/api/rules', swap(11));
  const { id: p2 } = await mom.post('/api/rules', swap(18));
  const { id: exp } = await mom.post('/api/expenses', { description: 'Dentist', amount: 100 });
  await dad.post(`/api/expenses/${exp}/decide`, { decision: 'approve' });
  // Viewers never record reads, so their unread count stays 0 (parents' counts still work).
  const { id: th } = await mom.post('/api/threads', { subject: 'School', body: 'Report cards are out.' });
  assert.equal((await viewer.get('/api/threads')).find(x => x.id === th).unread, 0);
  await viewer.get(`/api/threads/${th}`);
  assert.equal((await viewer.get('/api/threads')).find(x => x.id === th).unread, 0);
  assert.equal((await dad.get('/api/threads')).find(x => x.id === th).unread, 1);
  assert.equal((await viewer.get('/api/dashboard')).pending.messages, 0);

  await dad.post('/api/account/delete', { password: PW.dad });

  let me = await mom.get('/api/me');
  const dadRow = me.members.find(m => m.id === dadId);
  assert.equal(dadRow.name, 'Deleted user');
  assert.equal(dadRow.deleted, true);
  assert.equal(me.members.find(m => m.id === momId).deleted, false);
  assert.ok(me.family.invite_code, 'a fresh invite code for a new co-parent');
  assert.equal((await viewer.get('/api/me')).family.invite_code, undefined, 'viewers never see it');

  // Mom's old pending requests can't be approved by anyone yet; she can withdraw one.
  await mom.post(`/api/rules/${p1}/withdraw`);
  // New requests take effect as "not yet confirmed" while there is no live co-parent.
  const { id: u1 } = await mom.post('/api/rules', swap(25));
  let rules = await mom.get('/api/rules');
  assert.equal(rules.find(r => r.id === u1).status, 'unconfirmed');
  assert.equal(rules.find(r => r.id === p2).status, 'pending');
  assert.equal(rules.find(r => r.id === rules0[0].id).decided_by_name, 'Deleted user', 'history still resolves');
  const { id: ev } = await mom.post('/api/events', { title: 'Piano', start: '2026-12-02T16:00', end: '2026-12-02T17:00' });
  assert.equal((await mom.get('/api/events?start=2026-12-01&end=2026-12-05')).events.find(e => e.id === ev).status, 'accepted');
  // The deleted parent can't be given new custody time.
  assert.equal((await mom.req('POST', '/api/rules', { type: 'override', config: { periods: [{ start: '2026-12-30T18:00', end: '2026-12-31T18:00', parent: dadId }] } })).status, 400);
  // Ending an item applies at once, and payments have nobody to go to.
  assert.equal((await mom.req('POST', '/api/payments', { amount: 5 })).status, 400);
  // The deleted parent's records still count in the balance.
  assert.equal((await mom.get('/api/balance')).net_cents, 5000);

  // A new co-parent joins with the fresh code (the deleted parent's place is free again).
  const pat = client(base);
  await pat.register('pat@example.com', 'Pat', 'correct-horse-9');
  assert.equal((await pat.post('/api/family/join', { code: me.family.invite_code })).role, 'parent');
  const patMe = await pat.get('/api/me');
  assert.deepEqual(patMe.members.filter(m => m.role === 'parent').map(m => [m.name, m.deleted]), [['Mom', false], ['Deleted user', true], ['Pat', false]]);
  me = await mom.get('/api/me');
  assert.equal(me.family.invite_code, null, 'both parent places are taken again');
  const third = client(base);
  await third.register('third@example.com', 'Third', 'correct-horse-10');
  assert.equal((await third.req('POST', '/api/family/join', { code: patMe.family.invite_code || 'NOPE' })).status, 400);
  assert.ok((await mom.get('/api/notifications')).some(n => n.kind === 'member_joined' && n.title === 'Pat joined the family'));

  // Pat sees both waiting items and decides them.
  const dash = await pat.get('/api/dashboard');
  assert.ok(dash.pending.rules >= 2);
  assert.equal((await pat.post(`/api/rules/${u1}/decide`, { decision: 'approve' })).status, 'active');
  assert.equal((await pat.post(`/api/rules/${p2}/decide`, { decision: 'reject', note: 'No' })).status, 'rejected');
  // Mom's next request needs Pat again.
  const { id: next } = await mom.post('/api/rules', swap(4));
  assert.equal((await mom.get('/api/rules')).find(r => r.id === next).status, 'pending');
  assert.ok((await pat.get('/api/notifications')).some(n => n.kind === 'rule_requested'));
  assert.equal((await mom.get('/api/audit/verify')).ok, true);
});

test('schedule preview: validation errors are 400, not 500', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: false });
  const bad1 = await f.mom.req('POST', '/api/schedule/preview', { type: 'pattern', template: { template: 'bogus', anchorDate: '2026-12-04', parentA: f.momId, parentB: f.dadId } });
  assert.equal(bad1.status, 400);
  assert.equal(bad1.data.error, 'Unknown template: bogus');
  const bad2 = await f.mom.req('POST', '/api/schedule/preview', { type: 'pattern', config: { cycleDays: 14, segments: [] } });
  assert.deepEqual([bad2.status, bad2.data.error], [400, 'Pattern needs an anchor date']);
  const bad3 = await f.mom.req('POST', '/api/schedule/preview', { type: 'pattern', template: { template: 'custom', anchorDate: '2026-12-04', options: { days: [] } } });
  assert.deepEqual([bad3.status, bad3.data.error], [400, 'Custom cycle needs 1-56 days']);
  assert.equal((await f.mom.req('POST', '/api/schedule/preview', { type: 'nonsense' })).status, 400);
  assert.equal((await f.mom.req('POST', '/api/schedule/preview', { type: 'override', config: { periods: [{ start: '2026-12-01T10:00', end: '2026-12-01T09:00', parent: f.momId }] } })).status, 400);
  const ok = await f.mom.post('/api/schedule/preview', { type: 'pattern', template: { template: 'alternating_weekends', anchorDate: '2026-12-04', parentA: f.momId, parentB: f.dadId }, start: '2026-12-01', end: '2026-12-29' });
  assert.equal(ok.share.byParent.find(p => p.parent === f.dadId).overnights, 4);
});

test('replacing a regular schedule: impact excludes the replaced pattern, approval retires it', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: false });
  const { mom, dad, momId, dadId } = f;
  const rules0 = await dad.get('/api/rules');
  await dad.post(`/api/rules/${rules0[0].id}/decide`, { decision: 'approve' });
  const range = 'start=2026-12-07&end=2027-01-04';
  const { id: a } = await mom.post('/api/rules', { type: 'pattern', name: 'Alternating weekends', template: { template: 'alternating_weekends', anchorDate: '2026-12-04', parentA: momId, parentB: dadId } });
  await dad.post(`/api/rules/${a}/decide`, { decision: 'approve' });
  const shareA = (await mom.get(`/api/timeline?${range}`)).share.byParent;

  // Week on / week off replacing it.
  const wk = { template: 'week_on_week_off', anchorDate: '2026-12-07', parentA: momId, parentB: dadId, exchangeTime: '18:00' };
  const { id: b } = await mom.post('/api/rules', { type: 'pattern', name: 'Week on / week off', template: wk, supersedes: a });
  let rules = await dad.get('/api/rules');
  assert.equal(rules.find(r => r.id === b).supersedes, a);
  assert.equal(rules.find(r => r.id === b).supersedes_name, 'Alternating weekends');
  const imp = await dad.get(`/api/rules/${b}/impact?${range}`);
  assert.deepEqual(imp.before.byParent, shareA);
  await dad.post(`/api/rules/${b}/decide`, { decision: 'approve' });
  rules = await dad.get('/api/rules');
  assert.equal(rules.find(r => r.id === a).status, 'retired');
  assert.equal(rules.find(r => r.id === b).status, 'active');
  const shareB = (await mom.get(`/api/timeline?${range}`)).share.byParent;
  assert.deepEqual(imp.after.byParent, shareB, 'impact "after" matches the schedule once approved');
  assert.equal(shareB.find(p => p.parent === dadId).overnights, 14);
  // After approval the impact view still compares against the schedule it replaced.
  const imp2 = await dad.get(`/api/rules/${b}/impact?${range}`);
  assert.deepEqual(imp2.before.byParent, shareA);
  assert.deepEqual(imp2.after.byParent, shareB);

  // "Keep the current schedule too" (no supersedes): nothing is retired.
  const { id: c } = await mom.post('/api/rules', { type: 'pattern', name: 'Extra', template: { ...wk, anchorDate: '2027-06-07' } });
  await dad.post(`/api/rules/${c}/decide`, { decision: 'approve' });
  assert.equal((await dad.get('/api/rules')).find(r => r.id === b).status, 'active');
});

test('disputing a not-yet-confirmed replacement restores the schedule it replaced', async (t) => {
  const { base } = await start(t);
  const mom = client(base), dad = client(base);
  await mom.register('mom@example.com', 'Mom', PW.mom);
  await mom.post('/api/family', { name: 'Smith', timezone: TZ });
  const me = await mom.get('/api/me');
  const momId = me.user.id;
  // Before the co-parent joins: a custom pattern, then a replacement that retires it at once.
  const { id: a } = await mom.post('/api/rules', { type: 'pattern', name: 'Old', template: { template: 'custom', anchorDate: '2026-12-07', options: { days: [momId] } } });
  const { id: b } = await mom.post('/api/rules', { type: 'pattern', name: 'New', template: { template: 'custom', anchorDate: '2026-12-14', options: { days: [momId] } }, supersedes: a });
  let rules = await mom.get('/api/rules');
  assert.deepEqual([rules.find(r => r.id === a).status, rules.find(r => r.id === b).status], ['retired', 'unconfirmed']);
  await dad.register('dad@example.com', 'Dad', PW.dad);
  await dad.post('/api/family/join', { code: me.family.invite_code });
  await dad.post(`/api/rules/${b}/decide`, { decision: 'reject', note: 'Not agreed' });
  rules = await mom.get('/api/rules');
  assert.deepEqual([rules.find(r => r.id === a).status, rules.find(r => r.id === b).status], ['unconfirmed', 'rejected']);
  assert.ok((await mom.get('/api/audit')).some(x => x.action === 'restore' && x.entity_id === String(a)));
});

test('default split is the payer\'s share, the same for both parents', async (t) => {
  const { base } = await start(t);
  const f = await family(base, { withViewer: false });
  await f.mom.put('/api/family', { default_split: 70 });
  assert.equal((await f.dad.get('/api/me')).family.default_split, 70, 'one family-wide value');
  const { id: e1 } = await f.mom.post('/api/expenses', { description: 'Shoes', amount: 100 });
  const { id: e2 } = await f.dad.post('/api/expenses', { description: 'Books', amount: 100 });
  const ex = await f.mom.get('/api/expenses');
  assert.deepEqual([ex.find(e => e.id === e1).other_share_pct, ex.find(e => e.id === e2).other_share_pct], [30, 30]);
});
