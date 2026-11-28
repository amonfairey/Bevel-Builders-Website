import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb, token } from './db.js';
import { buildApi } from './api.js';
import { HttpError, parseCookies, readBody, send, serveStatic } from './http.js';
import { buildIcs } from './ics.js';
import { renderReport } from './report.js';
import { createPush, DEFAULT_PUSH_URL } from './push.js';
import { createNotifier } from './notify.js';
import { createReminderSweep } from './reminders.js';
import { dropPrivileges } from './privileges.js';
import { addDays, isDate, utcToLocalDate, ymd, parseDate } from './time.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, '..', 'public');
export const DEFAULT_DB_PATH = join(ROOT, '..', 'data', 'coparent.db');
const SESSION_MS = 30 * 86400000;
const REMINDER_EVERY_MS = 5 * 60000;
// Routes that work signed out (an invalid bearer token is ignored on these, so a stale token can't block signing in).
const PUBLIC_ROUTES = new Set(['/api/register', '/api/login', '/api/public-config']);

const env = process.env;
const flag = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const csv = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Every option falls back to an environment variable (see DEPLOY.md for the full table).
 * Returns { server, db, sweepReminders(nowMs) }.
 */
export function createApp({
  dbPath = env.DB_PATH || DEFAULT_DB_PATH,
  secureCookies = env.NODE_ENV === 'production',
  allowPrivateFeeds = flag(env.ALLOW_PRIVATE_FEEDS),
  corsOrigins = csv(env.CORS_ORIGINS),
  pushUrl = env.PUSH_URL || DEFAULT_PUSH_URL,
  pushDisabled = flag(env.PUSH_DISABLED),
  pushAccessToken = env.EXPO_ACCESS_TOKEN || null,
  reminders = env.REMINDERS ? flag(env.REMINDERS) : env.NODE_ENV === 'production',
  trustProxy = flag(env.TRUST_PROXY),
  appStoreUrl = env.APP_STORE_URL || null,
  testflightUrl = env.TESTFLIGHT_URL || null,
} = {}) {
  const db = openDb(dbPath);
  const push = createPush(db, { url: pushUrl, disabled: pushDisabled, accessToken: pushAccessToken });
  const notifier = createNotifier(db, push);
  const api = buildApi(db, { allowPrivateFeeds, notifier, publicConfig: { appStoreUrl, testflightUrl } });
  const sweepReminders = createReminderSweep({ db, api, notifier });
  const q = (sql) => db.prepare(sql);
  const allowedOrigins = new Set(corsOrigins);

  function liveSession(t) {
    if (!t || t.length > 200) return null;
    const s = q('SELECT * FROM sessions WHERE token = ?').get(t);
    if (!s) return null;
    if (s.expires < Date.now()) { q('DELETE FROM sessions WHERE token = ?').run(t); return null; }
    return s;
  }
  /** Bearer (iPhone app) takes precedence over the cookie (web portal). */
  function authenticate(req) {
    const h = req.headers.authorization;
    if (typeof h === 'string' && /^bearer(\s|$)/i.test(h.trim())) {
      const t = h.trim().slice(6).trim();
      const s = liveSession(t);
      const user = s && q('SELECT * FROM users WHERE id = ?').get(s.user_id);
      return user ? { user, token: t, via: 'bearer' } : { user: null, invalidBearer: true };
    }
    const t = parseCookies(req.headers.cookie).sid;
    const s = liveSession(t);
    const user = s && q('SELECT * FROM users WHERE id = ?').get(s.user_id);
    return user ? { user, token: t, via: 'cookie' } : { user: null };
  }
  const clientIp = (req) => {
    if (trustProxy) { const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (first) return first; }
    return req.socket.remoteAddress;
  };
  const cookie = (v, maxAge) => `sid=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  // CORS exists only for the iPhone app's web preview during development: exact origins, no credentials.
  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const extraHeaders = {};

    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      q('SELECT 1').get();
      return send(res, 200, { ok: true }, { 'Cache-Control': 'no-store' });
    }
    if (req.method === 'OPTIONS' && path.startsWith('/api/')) { res.writeHead(204); return res.end(); }

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
      const auth = authenticate(req);
      const user = auth.user;
      const isPublic = PUBLIC_ROUTES.has(path);
      const rt = path === '/report' ? url.searchParams.get('rt') : null;
      if (auth.invalidBearer && !isPublic && rt === null) return send(res, 401, { error: 'Session expired. Sign in again.' });

      if (path === '/report') {
        // ?rt=<report link token> (from POST /api/report-link) replaces session auth, e.g. when the iPhone app opens Safari.
        let reportUser = user;
        if (rt !== null) {
          const link = q('SELECT * FROM report_links WHERE token = ?').get(rt);
          reportUser = link && link.expires > Date.now() ? q('SELECT * FROM users WHERE id = ?').get(link.user_id) : null;
          if (!reportUser) return send(res, 401, { error: 'This report link has expired. Open the report again from the app.' });
        }
        if (!reportUser) return send(res, 401, { error: 'Sign in required' });
        const c = api.helpers.loadCtx(reportUser);
        if (!c.family) return send(res, 403, 'No family');
        const y = parseDate(utcToLocalDate(Date.now(), c.tz)).y;
        const from = isDate(url.searchParams.get('start')) ? url.searchParams.get('start') : ymd(y, 1, 1);
        const toIncl = isDate(url.searchParams.get('end')) ? url.searchParams.get('end') : utcToLocalDate(Date.now(), c.tz);
        return send(res, 200, renderReport(db, api, c, from, addDays(toIncl, 1)), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      }

      if (!user && path === '/api/me' && req.method === 'GET') return send(res, 200, { user: null });
      if (!user && !isPublic) return send(res, 401, { error: 'Sign in required' });
      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] !== '0' && req.headers['content-length']) {
        return send(res, 415, { error: 'JSON required' });
      }
      const m = api.match(req.method, path);
      if (!m) return send(res, 404, { error: 'Not found' });
      let raw = null;
      const ctx = {
        params: m.params, query: Object.fromEntries(url.searchParams), ip: clientIp(req),
        body: req.method === 'GET' ? {} : await readBody(req),
        c: user ? api.helpers.loadCtx(user) : null,
        sessionToken: user ? auth.token : null,
        /** Starts a session; returns its token. cookie:false is the native-client flow (token goes in the body). */
        setSession: (uid, { cookie: withCookie = true } = {}) => {
          const t = token(32);
          q('INSERT INTO sessions(token, user_id, expires) VALUES(?,?,?)').run(t, uid, Date.now() + SESSION_MS);
          if (withCookie) extraHeaders['Set-Cookie'] = cookie(t, SESSION_MS / 1000);
          return t;
        },
        /** Ends the session that authenticated this request (bearer or cookie) and stops pushes to its device. */
        clearSession: () => {
          if (user && auth.token) {
            q('DELETE FROM push_tokens WHERE session_token = ?').run(auth.token);
            q('DELETE FROM sessions WHERE token = ?').run(auth.token);
          }
          if (auth.via !== 'bearer') extraHeaders['Set-Cookie'] = cookie('', 0);
        },
        clearCookie: () => { extraHeaders['Set-Cookie'] = cookie('', 0); },
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
    applyCors(req, res); // before anything else, so error responses carry the headers too
    handle(req, res).catch(err => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Something went wrong' });
    });
  });

  if (reminders) {
    let interval = null, first = null;
    const run = () => { try { sweepReminders(Date.now()); } catch (e) { console.error('reminders: sweep failed', e); } };
    server.on('listening', () => {
      first = setTimeout(run, 5000); first.unref();
      interval = setInterval(run, REMINDER_EVERY_MS); interval.unref();
    });
    server.on('close', () => { clearTimeout(first); clearInterval(interval); first = interval = null; });
  }

  return { server, db, sweepReminders };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +env.PORT || 3000;
  // In Docker: started as root only so the data volume can be handed to RUN_AS_USER (see privileges.js).
  const dbPath = env.DB_PATH || DEFAULT_DB_PATH;
  if (dropPrivileges(dbPath === ':memory:' ? null : dirname(resolve(dbPath)))) console.log(`Running as ${env.RUN_AS_USER}`);
  const { server, db } = createApp({ dbPath });
  server.listen(port, () => console.log(`CoParent Hub running at http://localhost:${port}`));
  // Graceful stop (docker stop, platform redeploys): finish requests, then close SQLite cleanly.
  const stop = () => {
    server.close(() => { try { db.close(); } catch { /* already closed */ } process.exit(0); });
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
