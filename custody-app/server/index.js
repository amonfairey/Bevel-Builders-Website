import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, token } from './db.js';
import { buildApi } from './api.js';
import { HttpError, parseCookies, readBody, send, serveStatic } from './http.js';
import { buildIcs } from './ics.js';
import { renderReport } from './report.js';
import { addDays, isDate, utcToLocalDate, ymd, parseDate } from './time.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, '..', 'public');
const SESSION_MS = 30 * 86400000;

export function createApp({ dbPath = process.env.DB_PATH || join(ROOT, '..', 'data', 'coparent.db'), secureCookies = process.env.NODE_ENV === 'production', allowPrivateFeeds = !!process.env.ALLOW_PRIVATE_FEEDS } = {}) {
  const db = openDb(dbPath);
  const api = buildApi(db, { allowPrivateFeeds });
  const q = (sql) => db.prepare(sql);

  function sessionUser(req) {
    const t = parseCookies(req.headers.cookie).sid;
    if (!t) return null;
    const s = q('SELECT * FROM sessions WHERE token = ?').get(t);
    if (!s || s.expires < Date.now()) return null;
    return q('SELECT * FROM users WHERE id = ?').get(s.user_id);
  }
  const cookie = (v, maxAge) => `sid=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const extraHeaders = {};

    // Public calendar feed: /ics/<token>.ics?include=custody,events
    const icsMatch = /^\/ics\/([\w-]+)\.ics$/.exec(path);
    if (icsMatch && req.method === 'GET') {
      const user = q('SELECT * FROM users WHERE ics_token = ?').get(icsMatch[1]);
      if (!user) return send(res, 404, 'Not found');
      const c = api.helpers.loadCtx(user);
      if (!c.family) return send(res, 404, 'Not found');
      const include = (url.searchParams.get('include') || 'custody,events').split(',');
      const today = utcToLocalDate(Date.now(), c.tz);
      const from = addDays(today, -90), to = addDays(today, 400);
      const out = [];
      if (include.includes('custody')) {
        for (const iv of api.helpers.timelineFor(c, from, to).timeline) {
          if (iv.parent == null) continue;
          out.push({ uid: `custody-${iv.start}-${iv.parent}@coparent`, start: iv.start, end: iv.end, transparent: true,
            title: iv.parent === user.id ? 'Kids with me' : `Kids with ${api.helpers.nameOf(c, iv.parent)}`,
            description: `Source: ${iv.src.name}` });
        }
      }
      if (include.includes('events')) {
        for (const e of api.helpers.expandEvents(c, from, to)) {
          if (e.status === 'declined') continue;
          const tp = e.transport_parent ? ` (driving: ${api.helpers.nameOf(c, e.transport_parent)})` : '';
          out.push({ uid: `event-${e.id}-${e.instance_date}@coparent`, start: e.start, end: e.end, title: `${e.title}${tp}`, location: e.location,
            description: [e.status === 'proposed' ? 'Not yet acknowledged by both parents.' : '', e.details].filter(Boolean).join('\n') });
        }
      }
      return send(res, 200, buildIcs({ name: `${c.family.name} - co-parenting`, events: out }), { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' });
    }

    if (path.startsWith('/api/') || path === '/report') {
      const user = sessionUser(req);
      const isPublic = ['/api/register', '/api/login'].includes(path);
      if (!user && path === '/api/me' && req.method === 'GET') return send(res, 200, { user: null });
      if (!user && !isPublic) return send(res, 401, { error: 'Sign in required' });
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] !== '0' && req.headers['content-length']) {
        return send(res, 415, { error: 'JSON required' });
      }
      if (path === '/report') {
        const c = api.helpers.loadCtx(user);
        if (!c.family) return send(res, 403, 'No family');
        const y = parseDate(utcToLocalDate(Date.now(), c.tz)).y;
        const from = isDate(url.searchParams.get('start')) ? url.searchParams.get('start') : ymd(y, 1, 1);
        const toIncl = isDate(url.searchParams.get('end')) ? url.searchParams.get('end') : utcToLocalDate(Date.now(), c.tz);
        return send(res, 200, renderReport(db, api, c, from, addDays(toIncl, 1)), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      }
      const m = api.match(req.method, path);
      if (!m) return send(res, 404, { error: 'Not found' });
      let raw = null;
      const ctx = {
        params: m.params, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress,
        body: req.method === 'GET' ? {} : await readBody(req),
        c: user ? api.helpers.loadCtx(user) : null,
        setSession: (uid) => {
          const t = token(32);
          q('INSERT INTO sessions(token, user_id, expires) VALUES(?,?,?)').run(t, uid, Date.now() + SESSION_MS);
          extraHeaders['Set-Cookie'] = cookie(t, SESSION_MS / 1000);
        },
        clearSession: () => {
          const t = parseCookies(req.headers.cookie).sid;
          if (t) q('DELETE FROM sessions WHERE token = ?').run(t);
          extraHeaders['Set-Cookie'] = cookie('', 0);
        },
        raw: (status, buf, headers) => { raw = { status, buf, headers }; },
      };
      const result = await m.handler(ctx);
      if (raw) { res.writeHead(raw.status, { 'X-Content-Type-Options': 'nosniff', ...raw.headers }); return res.end(raw.buf); }
      return send(res, 200, result ?? { ok: true }, extraHeaders);
    }

    if (req.method === 'GET' && await serveStatic(res, PUBLIC, path)) return;
    if (req.method === 'GET' && !path.includes('.')) return serveStatic(res, PUBLIC, '/index.html');
    send(res, 404, 'Not found');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(err => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Something went wrong' });
    });
  });
  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  createApp().server.listen(port, () => console.log(`CoParent Hub running at http://localhost:${port}`));
}
