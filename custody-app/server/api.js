import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Router, bad, forbidden, notFound, HttpError } from './http.js';
import { audit, verifyFamily, nowIso, sha256, token, code, hashPassword, verifyPassword } from './db.js';
import {
  buildTimeline, timeShare, transitions, ownerAt, patternFromTemplate, validatePattern, validateHoliday,
  validateOverride, validateDefault, HOLIDAY_PRESETS, ACTIVE_STATUSES,
} from './schedule.js';
import {
  addDays, isDate, isLocal, isValidTz, localToUtc, localStampToUtc, utcToLocalDate, utcToLocalStamp, dayOfWeek, parseDate, ymd, diffDays,
} from './time.js';
import { parseIcs, buildIcs } from './ics.js';
import { checkTone } from './tone.js';
import { createNotifier, notificationRoutes, fmtLocal, fmtTime, money } from './notify.js';
import { accountRoutes, isDeletedUser } from './account.js';

const COLORS = ['#2f6f9f', '#b4572e', '#6b5ea8', '#2e8a6a'];
const SESSION_DAYS = 30;
const MAX_FILE = 8 * 1024 * 1024;
const REPORT_LINK_MS = 15 * 60000;

const j = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cents = (v) => { const n = Math.round(Number(v) * 100); if (!Number.isFinite(n) || n <= 0) throw bad('Enter an amount greater than zero'); return n; };
const intOr = (v, d) => (Number.isInteger(+v) ? +v : d);

export function buildApi(db, opts = {}) {
  const r = new Router();
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => { db.exec('BEGIN'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const loginAttempts = new Map(), registerAttempts = new Map();
  const notifier = opts.notifier || createNotifier(db, null);

  // ---------- context ----------
  /** Family-only context (no signed-in user): used by the reminder sweep. */
  function familyCtx(familyId) {
    const family = q('SELECT * FROM families WHERE id = ?').get(familyId);
    if (!family) return null;
    const members = q(`SELECT m.user_id id, u.name, u.email, m.role, m.color FROM members m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? ORDER BY m.joined_at`).all(family.id);
    const parents = members.filter(m => m.role === 'parent').map(m => m.id);
    return { user: null, member: null, family, members, parents, tz: family.timezone, coParent: null };
  }
  function loadCtx(user) {
    const member = q('SELECT * FROM members WHERE user_id = ?').get(user.id);
    if (!member) return { user, member: null, family: null };
    const f = familyCtx(member.family_id);
    return { ...f, user, member, coParent: f.parents.find(p => p !== user.id) ?? null };
  }
  const needFamily = (c) => { if (!c.family) throw forbidden('Set up or join a family first'); return c; };
  const needParent = (c) => { needFamily(c); if (c.member.role !== 'parent') throw forbidden('View-only access'); return c; };
  const log = (c, action, entity, id, data) => audit(db, c.family.id, c.user.id, action, entity, id, data);
  const nameOf = (c, id) => c.members.find(m => m.id === id)?.name || 'Unknown';
  /**
   * Notify the other parent(s): never the actor, never viewers, never deleted accounts.
   * `to` narrows recipients (e.g. the requester of a decision). See notify.js for the inbox/push side.
   */
  function notify(c, kind, { to = null, title, body = '', link, entity = null, entityId = null }) {
    const others = c.members.filter(m => m.role === 'parent' && m.id !== c.user.id && !isDeletedUser(m)).map(m => m.id);
    const userIds = to == null ? others : [].concat(to).filter(id => others.includes(id));
    if (userIds.length) notifier.notify({ familyId: c.family.id, userIds, kind, title, body, link, entity, entityId });
  }
  const actor = (c) => c.user.name;
  const childIds = (c, v) => {
    const ids = Array.isArray(v) ? v.map(Number) : [];
    const valid = new Set(q('SELECT id FROM children WHERE family_id = ?').all(c.family.id).map(x => x.id));
    for (const id of ids) if (!valid.has(id)) throw bad('Unknown child');
    return ids;
  };
  const fileFrom = (c, f) => {
    if (!f || !f.data) return null;
    const buf = Buffer.from(String(f.data), 'base64');
    if (buf.length > MAX_FILE) throw bad('File must be under 8 MB');
    const type = str(f.type, 100) || 'application/octet-stream';
    if (!/^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/.test(type)) throw bad('Attach an image or PDF');
    const hash = sha256(buf);
    q('INSERT OR IGNORE INTO files(hash, family_id, name, type, size, data, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(hash, c.family.id, str(f.name, 200) || 'file', type, buf.length, buf, c.user.id, nowIso());
    return hash;
  };

  // ---------- timeline helpers ----------
  const loadRules = (familyId) => q('SELECT * FROM rules WHERE family_id = ? ORDER BY id').all(familyId).map(x => ({ ...x, config: j(x.config, {}) }));
  function timelineFor(c, fromDate, toDateExcl, extra = {}) {
    const fromMs = localToUtc(fromDate, '00:00', c.tz), toMs = localToUtc(toDateExcl, '00:00', c.tz);
    return { fromMs, toMs, timeline: buildTimeline({ rules: loadRules(c.family.id), tz: c.tz, fromMs, toMs, ...extra }) };
  }
  const shareWithNames = (c, share) => {
    const label = (k) => (k === 'unassigned' ? 'Unassigned' : nameOf(c, +k));
    return {
      ...share,
      byParent: Object.keys(share.hours).map(k => ({ parent: k === 'unassigned' ? null : +k, name: label(k),
        hours: +share.hours[k].toFixed(1), pct: share.pct[k], overnights: share.overnights[k] || 0, nightPct: share.nightPct[k] || 0 })),
    };
  };

  // ---------- auth ----------
  // Native clients (client: "mobile") get the session token in the body instead of a cookie,
  // and send it back as "Authorization: Bearer <token>".
  const startSession = (uid, body, setSession) => {
    const mobile = body.client === 'mobile';
    const t = setSession(uid, { cookie: !mobile });
    return mobile ? { ok: true, token: t } : { ok: true };
  };
  r.post('/api/register', ({ body, setSession, ip }) => {
    const now = Date.now();
    const tries = (registerAttempts.get(ip) || []).filter(t => now - t < 3600000);
    if (tries.length >= 10) throw new HttpError(429, 'Too many sign-ups from this network. Try again in an hour.');
    tries.push(now); registerAttempts.set(ip, tries);
    const email = str(body.email, 200).toLowerCase(), name = str(body.name, 100), pw = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email');
    if (!name) throw bad('Enter your name');
    if (pw.length < 10) throw bad('Password must be at least 10 characters');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with that email exists');
    const { lastInsertRowid: id } = q('INSERT INTO users(email, name, pass, ics_token, created_at) VALUES(?,?,?,?,?)')
      .run(email, name, hashPassword(pw), token(), nowIso());
    return startSession(Number(id), body, setSession);
  });
  r.post('/api/login', ({ body, setSession, ip }) => {
    const email = str(body.email, 200).toLowerCase();
    const key = `${ip}|${email}`, now = Date.now();
    const a = (loginAttempts.get(key) || []).filter(t => now - t < 15 * 60000);
    if (a.length >= 8) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const u = q('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !verifyPassword(String(body.password || ''), u.pass)) { a.push(now); loginAttempts.set(key, a); throw new HttpError(401, 'Wrong email or password'); }
    loginAttempts.delete(key);
    q('DELETE FROM sessions WHERE user_id = ? AND expires < ?').run(u.id, now);
    return startSession(u.id, body, setSession);
  });
  r.post('/api/logout', ({ clearSession }) => { clearSession(); return { ok: true }; });

  r.get('/api/me', ({ c }) => {
    const out = { user: { id: c.user.id, name: c.user.name, email: c.user.email }, family: null, unread_notifications: notifier.unreadCount(c.user.id) };
    if (!c.family) return out;
    out.family = { id: c.family.id, name: c.family.name, timezone: c.family.timezone, default_split: c.family.default_split,
      ...(c.member.role === 'parent' ? { invite_code: c.family.invite_code, viewer_code: c.family.viewer_code } : {}) };
    out.role = c.member.role;
    out.members = c.members;
    out.children = q('SELECT id, name, birthdate, info FROM children WHERE family_id = ? ORDER BY id').all(c.family.id).map(x => ({ ...x, info: j(x.info, {}) }));
    const def = loadRules(c.family.id).filter(x => x.type === 'default' && ACTIVE_STATUSES.has(x.status)).pop();
    out.primary = def ? def.config.parent : null;
    out.icsBase = `/ics/${c.user.ics_token}.ics`;
    return out;
  });

  // ---------- family ----------
  r.post('/api/family', ({ c, body }) => {
    if (c.family) throw bad('You already belong to a family');
    const name = str(body.name, 100) || 'Our family', tz = str(body.timezone, 60) || 'America/Los_Angeles';
    if (!isValidTz(tz)) throw bad('Unknown time zone');
    return tx(() => {
      const fid = Number(q('INSERT INTO families(name, timezone, default_split, invite_code, viewer_code, created_at) VALUES(?,?,?,?,?,?)')
        .run(name, tz, 50, code(), code(), nowIso()).lastInsertRowid);
      q('INSERT INTO members(family_id, user_id, role, color, joined_at) VALUES(?,?,?,?,?)').run(fid, c.user.id, 'parent', COLORS[0], nowIso());
      const c2 = loadCtx(c.user);
      log(c2, 'create', 'family', fid, { name, timezone: tz });
      for (const ch of (Array.isArray(body.children) ? body.children : [])) {
        const n = str(ch.name, 80); if (!n) continue;
        const id = q('INSERT INTO children(family_id, name, birthdate, created_at) VALUES(?,?,?,?)').run(fid, n, isDate(ch.birthdate) ? ch.birthdate : null, nowIso()).lastInsertRowid;
        log(c2, 'create', 'child', id, { name: n });
      }
      // Background default: the creator is primary unless they say otherwise; marked unconfirmed until the co-parent confirms.
      createRule(c2, { type: 'default', name: 'Primary custodial parent', config: { parent: c.user.id }, reason: 'Initial setup' });
      return { ok: true, family_id: fid };
    });
  });
  r.post('/api/family/join', ({ c, body }) => {
    if (c.family) throw bad('You already belong to a family');
    const cd = str(body.code, 20).toUpperCase();
    let fam = q('SELECT * FROM families WHERE invite_code = ?').get(cd), role = 'parent';
    if (!fam) { fam = q('SELECT * FROM families WHERE viewer_code = ?').get(cd); role = 'viewer'; }
    if (!fam) throw bad('Invite code not found');
    const count = q("SELECT COUNT(*) n FROM members WHERE family_id = ? AND role = 'parent'").get(fam.id).n;
    if (role === 'parent' && count >= 2) throw bad('This family already has two parents');
    const used = q('SELECT COUNT(*) n FROM members WHERE family_id = ?').get(fam.id).n;
    q('INSERT INTO members(family_id, user_id, role, color, joined_at) VALUES(?,?,?,?,?)').run(fam.id, c.user.id, role, COLORS[used % COLORS.length], nowIso());
    if (role === 'parent') q('UPDATE families SET invite_code = NULL WHERE id = ?').run(fam.id); // one co-parent only
    const c2 = loadCtx(c.user);
    log(c2, 'join', 'member', c.user.id, { role, name: c.user.name });
    notify(c2, 'member_joined', { link: 'settings', entity: 'member', entityId: c.user.id,
      title: role === 'parent' ? `${c.user.name} joined the family` : `${c.user.name} joined as view-only`,
      body: role === 'parent' ? 'Anything you set up before they joined is waiting for their confirmation.' : 'They can see the calendar and records but cannot change anything.' });
    return { ok: true, role };
  });
  r.put('/api/family', ({ c, body }) => {
    needParent(c);
    const name = str(body.name, 100) || c.family.name;
    const tz = str(body.timezone, 60) || c.family.timezone;
    if (!isValidTz(tz)) throw bad('Unknown time zone');
    const split = Math.min(100, Math.max(0, intOr(body.default_split, c.family.default_split)));
    q('UPDATE families SET name = ?, timezone = ?, default_split = ? WHERE id = ?').run(name, tz, split, c.family.id);
    log(c, 'update', 'family', c.family.id, { name, timezone: tz, default_split: split });
    return { ok: true };
  });
  r.post('/api/family/viewer-code', ({ c }) => {
    needParent(c);
    const cd = code();
    q('UPDATE families SET viewer_code = ? WHERE id = ?').run(cd, c.family.id);
    log(c, 'rotate', 'viewer_code', c.family.id, {});
    return { viewer_code: cd };
  });
  r.post('/api/children', ({ c, body }) => {
    needParent(c);
    const n = str(body.name, 80); if (!n) throw bad('Enter a name');
    const id = q('INSERT INTO children(family_id, name, birthdate, created_at) VALUES(?,?,?,?)').run(c.family.id, n, isDate(body.birthdate) ? body.birthdate : null, nowIso()).lastInsertRowid;
    log(c, 'create', 'child', id, { name: n, birthdate: body.birthdate || null });
    return { id: Number(id) };
  });
  r.put('/api/children/:id', ({ c, body, params }) => {
    needParent(c);
    const ch = q('SELECT * FROM children WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!ch) throw notFound();
    const info = typeof body.info === 'object' && body.info ? Object.fromEntries(Object.entries(body.info).slice(0, 30).map(([k, v]) => [str(k, 40), str(String(v ?? ''), 1000)])) : j(ch.info, {});
    const n = str(body.name, 80) || ch.name;
    const bd = isDate(body.birthdate) ? body.birthdate : ch.birthdate;
    q('UPDATE children SET name = ?, birthdate = ?, info = ? WHERE id = ?').run(n, bd, JSON.stringify(info), ch.id);
    log(c, 'update', 'child', ch.id, { name: n, birthdate: bd, info });
    return { ok: true };
  });

  // ---------- approvals (shared by custody rules and call rules) ----------
  const initialStatus = (c) => (c.coParent ? 'pending' : 'unconfirmed');

  function createRule(c, { type, name, config, priority = 0, reason = '', supersedes = null }) {
    const ids = c.parents;
    if (type === 'pattern') validatePattern(config, ids);
    else if (type === 'holiday') validateHoliday(config, ids);
    else if (type === 'override') validateOverride(config, ids);
    else if (type === 'default') validateDefault(config, ids);
    else throw bad('Unknown rule type');
    if (supersedes && !q('SELECT 1 FROM rules WHERE id = ? AND family_id = ?').get(supersedes, c.family.id)) throw bad('Superseded rule not found');
    const status = initialStatus(c);
    const id = Number(q(`INSERT INTO rules(family_id, type, name, config, priority, reason, status, requested_by, requested_at, supersedes)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(c.family.id, type, name, JSON.stringify(config), priority, reason, status, c.user.id, nowIso(), supersedes).lastInsertRowid);
    log(c, 'request', 'rule', id, { type, name, config, priority, reason, status, supersedes });
    if (status === 'unconfirmed') activateSideEffects(c, id);
    else notify(c, 'rule_requested', { title: `${actor(c)} requested a schedule change`, body: reason ? `${name}: ${reason}` : name, link: 'schedule', entity: 'rule', entityId: id });
    return id;
  }

  function activateSideEffects(c, id) {
    const rule = q('SELECT * FROM rules WHERE id = ?').get(id);
    const retire = (oid, why) => { q("UPDATE rules SET status = 'retired' WHERE id = ?").run(oid); log(c, 'retire', 'rule', oid, { reason: why, by_rule: id }); };
    if (rule.type === 'default') {
      for (const o of q("SELECT id FROM rules WHERE family_id = ? AND type = 'default' AND id <> ? AND status IN ('active','unconfirmed')").all(rule.family_id, id)) retire(o.id, 'Replaced by newer default');
    }
    if (rule.supersedes) {
      const o = q('SELECT status FROM rules WHERE id = ?').get(rule.supersedes);
      if (o && ACTIVE_STATUSES.has(o.status)) retire(rule.supersedes, 'Superseded');
    }
  }

  function decide(c, table, id, decision, note) {
    needParent(c);
    const row = q(`SELECT * FROM ${table} WHERE id = ? AND family_id = ?`).get(id, c.family.id);
    if (!row) throw notFound();
    if (!['approve', 'reject'].includes(decision)) throw bad('Decision must be approve or reject');
    if (!['pending', 'unconfirmed'].includes(row.status)) throw bad('This request has already been decided');
    if (row.requested_by === c.user.id) throw forbidden('The other parent has to approve your request');
    const status = decision === 'approve' ? 'active' : 'rejected';
    q(`UPDATE ${table} SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`).run(status, c.user.id, nowIso(), str(note, 2000), id);
    log(c, decision, table === 'rules' ? 'rule' : 'call_rule', id, { previous: row.status, note: str(note, 2000) });
    if (table === 'rules' && status === 'active' && row.status === 'pending') activateSideEffects(c, id);
    const isRule = table === 'rules', verb = decision === 'approve' ? 'approved' : 'declined';
    notify(c, isRule ? 'rule_decided' : 'call_rule_decided', { to: row.requested_by, link: isRule ? 'schedule' : 'calls', entity: isRule ? 'rule' : 'call_rule', entityId: id,
      title: `${actor(c)} ${verb} your ${isRule ? 'schedule request' : 'call schedule'}`, body: str(note, 200) ? `${row.name}: ${str(note, 200)}` : row.name });
    return { ok: true, status };
  }
  function withdraw(c, table, id) {
    needParent(c);
    const row = q(`SELECT * FROM ${table} WHERE id = ? AND family_id = ?`).get(id, c.family.id);
    if (!row) throw notFound();
    if (row.requested_by !== c.user.id || row.status !== 'pending') throw bad('Only your own pending requests can be withdrawn');
    q(`UPDATE ${table} SET status = 'withdrawn' WHERE id = ?`).run(id);
    log(c, 'withdraw', table === 'rules' ? 'rule' : 'call_rule', id, {});
    return { ok: true };
  }
  function retireRequest(c, table, id, note) {
    needParent(c);
    const row = q(`SELECT * FROM ${table} WHERE id = ? AND family_id = ?`).get(id, c.family.id);
    if (!row) throw notFound();
    if (!ACTIVE_STATUSES.has(row.status)) throw bad('Only active items can be ended');
    const entity = table === 'rules' ? 'rule' : 'call_rule';
    if (!c.coParent) {
      q(`UPDATE ${table} SET status = 'retired' WHERE id = ?`).run(id);
      log(c, 'retire', entity, id, { note: str(note) });
      return { ok: true, status: 'retired' };
    }
    if (row.retire_requested_by) throw bad('Ending this is already requested');
    q(`UPDATE ${table} SET retire_requested_by = ?, retire_requested_at = ? WHERE id = ?`).run(c.user.id, nowIso(), id);
    log(c, 'request_retire', entity, id, { note: str(note) });
    const isRule = table === 'rules';
    notify(c, isRule ? 'rule_retire_requested' : 'call_rule_requested', { link: isRule ? 'schedule' : 'calls', entity, entityId: id,
      title: `${actor(c)} asked to end ${isRule ? 'a schedule item' : 'a call schedule'}`, body: str(note, 200) ? `${row.name}: ${str(note, 200)}` : row.name });
    return { ok: true, status: row.status, retire_pending: true };
  }
  function retireDecide(c, table, id, decision, note) {
    needParent(c);
    const row = q(`SELECT * FROM ${table} WHERE id = ? AND family_id = ?`).get(id, c.family.id);
    if (!row || !row.retire_requested_by) throw notFound('No end request');
    if (row.retire_requested_by === c.user.id) throw forbidden('The other parent has to approve this');
    const entity = table === 'rules' ? 'rule' : 'call_rule';
    if (decision === 'approve') q(`UPDATE ${table} SET status = 'retired', retire_requested_by = NULL WHERE id = ?`).run(id);
    else q(`UPDATE ${table} SET retire_requested_by = NULL, retire_requested_at = NULL WHERE id = ?`).run(id);
    log(c, decision === 'approve' ? 'approve_retire' : 'reject_retire', entity, id, { note: str(note) });
    const isRule = table === 'rules';
    notify(c, isRule ? 'rule_retire_decided' : 'call_rule_decided', { to: row.retire_requested_by, link: isRule ? 'schedule' : 'calls', entity, entityId: id,
      title: `${actor(c)} ${decision === 'approve' ? 'agreed to end' : 'declined to end'} ${isRule ? 'a schedule item' : 'a call schedule'}`,
      body: str(note, 200) ? `${row.name}: ${str(note, 200)}` : row.name });
    return { ok: true };
  }

  // ---------- custody rules ----------
  r.get('/api/holiday-presets', () => HOLIDAY_PRESETS);
  r.get('/api/rules', ({ c }) => {
    needFamily(c);
    return loadRules(c.family.id).map(x => ({ ...x, requested_by_name: nameOf(c, x.requested_by), decided_by_name: x.decided_by ? nameOf(c, x.decided_by) : null }));
  });
  r.post('/api/rules', ({ c, body }) => {
    needParent(c);
    const type = body.type;
    let config = body.config || {};
    if (type === 'pattern' && body.template) {
      try { config = { ...patternFromTemplate({ ...body.template }), effectiveFrom: body.template.effectiveFrom || null, effectiveTo: body.template.effectiveTo || null }; }
      catch (e) { throw bad(e.message); }
    }
    const name = str(body.name, 120) || { default: 'Primary custodial parent', pattern: 'Regular schedule', holiday: 'Holiday', override: 'Schedule change' }[type] || 'Rule';
    try {
      const id = createRule(c, { type, name, config, priority: intOr(body.priority, type === 'holiday' && config.rule?.type === 'range' ? -10 : 0), reason: str(body.reason, 2000), supersedes: body.supersedes ? +body.supersedes : null });
      return { id };
    } catch (e) { if (e instanceof HttpError) throw e; throw bad(e.message); }
  });
  r.post('/api/rules/:id/decide', ({ c, body, params }) => decide(c, 'rules', +params.id, body.decision, body.note));
  r.post('/api/rules/:id/withdraw', ({ c, params }) => withdraw(c, 'rules', +params.id));
  r.post('/api/rules/:id/retire', ({ c, body, params }) => retireRequest(c, 'rules', +params.id, body.note));
  r.post('/api/rules/:id/retire-decide', ({ c, body, params }) => retireDecide(c, 'rules', +params.id, body.decision, body.note));
  /** How a pending rule would change time share over the next 12 months. */
  r.get('/api/rules/:id/impact', ({ c, params, query }) => {
    needFamily(c);
    const rule = loadRules(c.family.id).find(x => x.id === +params.id);
    if (!rule) throw notFound();
    const from = isDate(query.start) ? query.start : utcToLocalDate(Date.now(), c.tz);
    const to = isDate(query.end) ? query.end : addDays(from, 365);
    const isActive = ACTIVE_STATUSES.has(rule.status);
    const without = timelineFor(c, from, to, { excludeRuleIds: [rule.id] });
    const withR = timelineFor(c, from, to, isActive ? {} : { extraRules: [{ ...rule, status: 'active', id: 1e9 }] });
    return {
      start: from, end: to,
      before: shareWithNames(c, timeShare(without.timeline, c.tz, from, to)),
      after: shareWithNames(c, timeShare(withR.timeline, c.tz, from, to)),
    };
  });
  r.post('/api/schedule/preview', ({ c, body }) => {
    needFamily(c);
    let config = body.config || {};
    if (body.type === 'pattern' && body.template) config = patternFromTemplate(body.template);
    const from = isDate(body.start) ? body.start : utcToLocalDate(Date.now(), c.tz);
    const to = isDate(body.end) ? body.end : addDays(from, 28);
    const t = timelineFor(c, from, to, { extraRules: [{ id: 1e9, type: body.type, name: 'Preview', config, priority: intOr(body.priority, 0), status: 'active' }] });
    return { timeline: t.timeline, share: shareWithNames(c, timeShare(t.timeline, c.tz, from, to)) };
  });

  r.get('/api/timeline', ({ c, query }) => {
    needFamily(c);
    const from = isDate(query.start) ? query.start : utcToLocalDate(Date.now(), c.tz);
    const to = isDate(query.end) ? query.end : addDays(from, 42);
    if (diffDays(to, from) > 800 || to <= from) throw bad('Range must be 1-800 days');
    const { timeline } = timelineFor(c, from, to);
    return { start: from, end: to, timezone: c.tz, timeline, share: shareWithNames(c, timeShare(timeline, c.tz, from, to)),
      transitions: transitions(timeline) };
  });

  // ---------- events (extracurriculars, appointments) ----------
  function expandEvents(c, from, to) {
    const rows = q("SELECT * FROM events WHERE family_id = ? AND status <> 'cancelled'").all(c.family.id);
    const out = [];
    for (const e of rows) {
      const rec = j(e.recurrence, null);
      const durMin = (localStampToUtc(e.end_local, c.tz) - localStampToUtc(e.start_local, c.tz)) / 60000;
      const [sd, st] = e.start_local.split('T');
      const pushAt = (date) => {
        const startMs = localToUtc(date, st, c.tz);
        const endMs = startMs + durMin * 60000;
        out.push({ ...e, child_ids: j(e.child_ids, []), recurrence: rec, instance_date: date, start: startMs, end: endMs });
      };
      if (!rec || !rec.freq) { if (sd >= addDays(from, -1) && sd < to) pushAt(sd); continue; }
      const until = rec.until && isDate(rec.until) ? rec.until : addDays(sd, 730);
      const skip = new Set(rec.exdates || []);
      const interval = Math.max(1, rec.interval || 1);
      const days = rec.freq === 'weekly' ? (rec.byday?.length ? rec.byday : [dayOfWeek(sd)]) : null;
      for (let d = sd, i = 0; d <= until && d < to && i < 3000; d = addDays(d, 1), i++) {
        if (d < from || skip.has(d)) continue;
        const delta = diffDays(d, sd);
        if (rec.freq === 'daily' && delta % interval === 0) pushAt(d);
        if (rec.freq === 'weekly' && days.includes(dayOfWeek(d)) && Math.floor((delta + dayOfWeek(sd)) / 7) % interval === 0) pushAt(d);
        if (rec.freq === 'monthly' && parseDate(d).d === parseDate(sd).d && (diffMonths(d, sd) % interval === 0)) pushAt(d);
      }
    }
    return out;
  }
  const diffMonths = (a, b) => { const x = parseDate(a), y = parseDate(b); return (x.y - y.y) * 12 + (x.m - y.m); };

  function eventInput(c, body, existing = {}) {
    const title = str(body.title, 200) || existing.title;
    if (!title) throw bad('Enter a title');
    const start = body.start ?? existing.start_local, end = body.end ?? existing.end_local;
    if (!isLocal(start) || !isLocal(end) || end <= start) throw bad('Enter a valid start and end');
    let rec = body.recurrence === undefined ? j(existing.recurrence, null) : body.recurrence;
    if (rec && rec.freq) {
      if (!['daily', 'weekly', 'monthly'].includes(rec.freq)) throw bad('Repeat must be daily, weekly or monthly');
      rec = { freq: rec.freq, interval: Math.max(1, Math.min(8, intOr(rec.interval, 1))), byday: (rec.byday || []).map(Number).filter(d => d >= 0 && d <= 6),
        until: isDate(rec.until) ? rec.until : null, exdates: (rec.exdates || []).filter(isDate) };
    } else rec = null;
    const tp = body.transport_parent === undefined ? (existing.transport_parent ?? null) : (body.transport_parent ? +body.transport_parent : null);
    if (tp && !c.parents.includes(tp)) throw bad('Unknown parent');
    return {
      title, start, end, rec, tp,
      category: str(body.category, 40) || existing.category || 'activity',
      child_ids: body.child_ids ? childIds(c, body.child_ids) : j(existing.child_ids, []),
      location: body.location !== undefined ? str(body.location, 300) : existing.location || '',
      details: body.details !== undefined ? str(body.details, 4000) : existing.details || '',
      cost_cents: body.cost !== undefined && body.cost !== '' && body.cost !== null ? cents(body.cost) : (existing.cost_cents ?? null),
    };
  }

  r.get('/api/events', ({ c, query }) => {
    needFamily(c);
    const from = isDate(query.start) ? query.start : utcToLocalDate(Date.now(), c.tz);
    const to = isDate(query.end) ? query.end : addDays(from, 42);
    const { timeline } = timelineFor(c, addDays(from, -1), addDays(to, 1));
    const events = expandEvents(c, from, to).map(e => ({ ...e, custody_parent: ownerAt(timeline, e.start),
      note_count: q("SELECT COUNT(*) n FROM notes WHERE family_id = ? AND target_type = 'event' AND target_id = ?").get(c.family.id, String(e.id)).n }));
    const fromMs = localToUtc(from, '00:00', c.tz), toMs = localToUtc(to, '00:00', c.tz);
    const external = q(`SELECT fe.*, f.name feed_name, f.provider, f.user_id owner FROM feed_events fe JOIN feeds f ON f.id = fe.feed_id
      WHERE f.family_id = ? AND (f.user_id = ? OR f.visibility = 'family') AND fe.end_ms > ? AND fe.start_ms < ?`).all(c.family.id, c.user.id, fromMs, toMs);
    return { events: events.sort((a, b) => a.start - b.start), external };
  });
  r.post('/api/events', ({ c, body }) => {
    needParent(c);
    const e = eventInput(c, body);
    const status = c.coParent ? 'proposed' : 'accepted';
    const id = Number(q(`INSERT INTO events(family_id, title, category, child_ids, start_local, end_local, location, transport_parent, recurrence, details, cost_cents, status, created_by, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.family.id, e.title, e.category, JSON.stringify(e.child_ids), e.start, e.end, e.location, e.tp, e.rec ? JSON.stringify(e.rec) : null, e.details, e.cost_cents, status, c.user.id, nowIso()).lastInsertRowid);
    log(c, 'create', 'event', id, { ...e, status });
    if (status === 'proposed') notify(c, 'event_proposed', { title: `${actor(c)} added an activity`, body: `${e.title} · ${fmtLocal(e.start)}`, link: 'activities', entity: 'event', entityId: id });
    return { id };
  });
  r.put('/api/events/:id', ({ c, body, params }) => {
    needParent(c);
    const ex = q('SELECT * FROM events WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!ex) throw notFound();
    const e = eventInput(c, body, ex);
    // A material change by one parent goes back to the other for acknowledgement.
    const status = c.coParent ? 'proposed' : 'accepted';
    q(`UPDATE events SET title=?, category=?, child_ids=?, start_local=?, end_local=?, location=?, transport_parent=?, recurrence=?, details=?, cost_cents=?, status=?, created_by=?, updated_at=?, responded_by=NULL, responded_at=NULL, response_note=NULL WHERE id=?`)
      .run(e.title, e.category, JSON.stringify(e.child_ids), e.start, e.end, e.location, e.tp, e.rec ? JSON.stringify(e.rec) : null, e.details, e.cost_cents, status, c.user.id, nowIso(), ex.id);
    log(c, 'update', 'event', ex.id, { before: { ...ex }, after: { ...e, status } });
    if (status === 'proposed') notify(c, 'event_proposed', { title: `${actor(c)} changed an activity`, body: `${e.title} · ${fmtLocal(e.start)}`, link: 'activities', entity: 'event', entityId: ex.id });
    return { ok: true };
  });
  r.post('/api/events/:id/respond', ({ c, body, params }) => {
    needParent(c);
    const ex = q('SELECT * FROM events WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!ex) throw notFound();
    if (ex.created_by === c.user.id) throw forbidden('The other parent responds to this');
    if (!['accepted', 'declined'].includes(body.response)) throw bad('Response must be accepted or declined');
    q('UPDATE events SET status = ?, responded_by = ?, responded_at = ?, response_note = ? WHERE id = ?').run(body.response, c.user.id, nowIso(), str(body.note), ex.id);
    log(c, body.response === 'accepted' ? 'accept' : 'decline', 'event', ex.id, { note: str(body.note) });
    notify(c, 'event_responded', { to: ex.created_by, title: `${actor(c)} ${body.response} an activity`,
      body: str(body.note, 200) ? `${ex.title}: ${str(body.note, 200)}` : ex.title, link: 'activities', entity: 'event', entityId: ex.id });
    return { ok: true };
  });
  r.post('/api/events/:id/cancel', ({ c, body, params }) => {
    needParent(c);
    const ex = q('SELECT * FROM events WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!ex) throw notFound();
    if (body.date && isDate(body.date) && ex.recurrence) {
      const rec = j(ex.recurrence, {}); rec.exdates = [...new Set([...(rec.exdates || []), body.date])];
      q('UPDATE events SET recurrence = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(rec), nowIso(), ex.id);
      log(c, 'cancel_instance', 'event', ex.id, { date: body.date, note: str(body.note) });
    } else {
      q("UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), ex.id);
      log(c, 'cancel', 'event', ex.id, { note: str(body.note) });
    }
    return { ok: true };
  });

  // ---------- calendar feeds (import) ----------
  async function safeFetch(url) {
    let u;
    try { u = new URL(url.replace(/^webcals?:\/\//i, 'https://')); } catch { throw bad('Enter a valid calendar URL'); }
    if (u.protocol !== 'https:' && !opts.allowPrivateFeeds) throw bad('Calendar URL must use https');
    if (!opts.allowPrivateFeeds) {
      const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => { throw bad('Could not resolve calendar host'); });
      for (const { address } of addrs) if (isPrivate(address)) throw bad('That calendar address is not allowed');
    }
    const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'CoParentHub/1.0 (calendar sync)' } });
    if (!res.ok) throw bad(`Calendar server returned ${res.status}`);
    const text = await res.text();
    if (text.length > 10 * 1024 * 1024) throw bad('Calendar is too large');
    if (!text.includes('BEGIN:VCALENDAR')) throw bad('That URL did not return an iCalendar (.ics) feed');
    return text;
  }
  async function syncFeed(c, feed) {
    try {
      const text = await safeFetch(feed.url);
      const now = Date.now();
      const items = parseIcs(text, { defaultTz: c.tz, fromMs: now - 90 * 86400000, toMs: now + 400 * 86400000 });
      tx(() => {
        q('DELETE FROM feed_events WHERE feed_id = ?').run(feed.id);
        const ins = q('INSERT INTO feed_events(feed_id, uid, title, start_ms, end_ms, all_day, location) VALUES(?,?,?,?,?,?,?)');
        for (const it of items) ins.run(feed.id, it.uid, it.title.slice(0, 300), it.start, it.end, it.allDay ? 1 : 0, it.location.slice(0, 300));
        q('UPDATE feeds SET last_sync = ?, last_error = NULL WHERE id = ?').run(nowIso(), feed.id);
      });
      return { ok: true, count: items.length };
    } catch (e) {
      q('UPDATE feeds SET last_error = ? WHERE id = ?').run(String(e.message).slice(0, 300), feed.id);
      return { ok: false, error: e.message };
    }
  }
  r.get('/api/feeds', ({ c }) => {
    needFamily(c);
    return q(`SELECT f.id, f.name, f.provider, f.visibility, f.last_sync, f.last_error, f.user_id, (SELECT COUNT(*) FROM feed_events WHERE feed_id = f.id) events
      FROM feeds f WHERE f.family_id = ? AND (f.user_id = ? OR f.visibility = 'family')`).all(c.family.id, c.user.id);
  });
  r.post('/api/feeds', async ({ c, body }) => {
    needFamily(c);
    const url = str(body.url, 2000);
    if (!url) throw bad('Paste the calendar\'s secret iCal address');
    const provider = ['google', 'apple', 'outlook', 'other'].includes(body.provider) ? body.provider : 'other';
    const vis = body.visibility === 'family' ? 'family' : 'me';
    const id = Number(q('INSERT INTO feeds(family_id, user_id, name, provider, url, visibility, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(c.family.id, c.user.id, str(body.name, 100) || `${provider} calendar`, provider, url, vis, nowIso()).lastInsertRowid);
    const result = await syncFeed(c, q('SELECT * FROM feeds WHERE id = ?').get(id));
    return { id, ...result };
  });
  r.post('/api/feeds/:id/sync', async ({ c, params }) => {
    needFamily(c);
    const f = q('SELECT * FROM feeds WHERE id = ? AND family_id = ? AND user_id = ?').get(+params.id, c.family.id, c.user.id);
    if (!f) throw notFound();
    return syncFeed(c, f);
  });
  r.del('/api/feeds/:id', ({ c, params }) => {
    needFamily(c);
    const f = q('SELECT * FROM feeds WHERE id = ? AND family_id = ? AND user_id = ?').get(+params.id, c.family.id, c.user.id);
    if (!f) throw notFound();
    q('DELETE FROM feeds WHERE id = ?').run(f.id);
    return { ok: true };
  });
  r.post('/api/ics-token/rotate', ({ c }) => {
    q('UPDATE users SET ics_token = ? WHERE id = ?').run(token(), c.user.id);
    return { ok: true };
  });

  // ---------- expenses & reimbursement ----------
  r.get('/api/expenses', ({ c }) => {
    needFamily(c);
    const rows = q('SELECT e.*, f.name receipt_name, f.type receipt_type FROM expenses e LEFT JOIN files f ON f.hash = e.receipt_hash WHERE e.family_id = ? ORDER BY e.date DESC, e.id DESC').all(c.family.id);
    return rows.map(e => ({ ...e, child_ids: j(e.child_ids, []), owed_cents: Math.round(e.amount_cents * e.other_share_pct / 100),
      note_count: q("SELECT COUNT(*) n FROM notes WHERE family_id = ? AND target_type = 'expense' AND target_id = ?").get(c.family.id, String(e.id)).n }));
  });
  r.post('/api/expenses', ({ c, body }) => {
    needParent(c);
    const description = str(body.description, 300); if (!description) throw bad('Describe the expense');
    const amount = cents(body.amount);
    const date = isDate(body.date) ? body.date : utcToLocalDate(Date.now(), c.tz);
    const share = Math.min(100, Math.max(0, intOr(body.other_share_pct, 100 - c.family.default_split)));
    const receipt = fileFrom(c, body.receipt);
    const status = body.request_reimbursement === false ? 'logged' : 'requested';
    const ev = body.event_id ? q('SELECT id FROM events WHERE id = ? AND family_id = ?').get(+body.event_id, c.family.id) : null;
    const id = Number(q(`INSERT INTO expenses(family_id, description, category, amount_cents, date, child_ids, event_id, paid_by, other_share_pct, receipt_hash, status, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.family.id, description, str(body.category, 40) || 'other', amount, date, JSON.stringify(childIds(c, body.child_ids)), ev ? ev.id : null, c.user.id, share, receipt, status, nowIso()).lastInsertRowid);
    log(c, 'create', 'expense', id, { description, amount_cents: amount, date, other_share_pct: share, receipt_hash: receipt, status });
    if (status === 'requested') notifyExpenseRequest(c, { id, description, amount_cents: amount, other_share_pct: share });
    return { id };
  });
  function notifyExpenseRequest(c, e) {
    notify(c, 'expense_requested', { title: `${actor(c)} requested reimbursement`, link: 'expenses', entity: 'expense', entityId: e.id,
      body: `${e.description}: ${money(Math.round(e.amount_cents * e.other_share_pct / 100))} of ${money(e.amount_cents)}` });
  }
  r.post('/api/expenses/:id/request', ({ c, params }) => {
    needParent(c);
    const e = q('SELECT * FROM expenses WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!e || e.paid_by !== c.user.id) throw notFound();
    if (e.status !== 'logged') throw bad('Already requested');
    q("UPDATE expenses SET status = 'requested' WHERE id = ?").run(e.id);
    log(c, 'request', 'expense', e.id, {});
    notifyExpenseRequest(c, e);
    return { ok: true };
  });
  r.post('/api/expenses/:id/decide', ({ c, body, params }) => {
    needParent(c);
    const e = q('SELECT * FROM expenses WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!e) throw notFound();
    if (e.paid_by === c.user.id) throw forbidden('The other parent approves reimbursement');
    if (!['requested', 'disputed'].includes(e.status)) throw bad('Nothing to decide');
    const status = body.decision === 'approve' ? 'approved' : body.decision === 'dispute' ? 'disputed' : null;
    if (!status) throw bad('Decision must be approve or dispute');
    if (status === 'disputed' && !str(body.note)) throw bad('Say why you are disputing it');
    q('UPDATE expenses SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(status, c.user.id, nowIso(), str(body.note), e.id);
    log(c, body.decision, 'expense', e.id, { note: str(body.note) });
    notify(c, 'expense_decided', { to: e.paid_by, title: `${actor(c)} ${status} an expense`, link: 'expenses', entity: 'expense', entityId: e.id,
      body: str(body.note, 200) ? `${e.description}: ${str(body.note, 200)}` : e.description });
    return { ok: true };
  });

  function balance(c) {
    const me = c.user.id, other = c.coParent;
    const ex = q("SELECT * FROM expenses WHERE family_id = ? AND status IN ('approved','reimbursed','requested','disputed')").all(c.family.id);
    // 'reimbursed' still counts as owed; the confirmed payment is what offsets it.
    const owed = (payer, status) => ex.filter(e => e.paid_by === payer && (e.status === status || (status === 'approved' && e.status === 'reimbursed'))).reduce((s, e) => s + Math.round(e.amount_cents * e.other_share_pct / 100), 0);
    const pay = (from, to) => q("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE family_id = ? AND from_user = ? AND to_user = ? AND status = 'confirmed'").get(c.family.id, from, to ?? -1).s;
    const net = owed(me, 'approved') - owed(other, 'approved') - pay(other, me) + pay(me, other);
    return { net_cents: net, /* >0: co-parent owes me */ pending_to_me: owed(me, 'requested'), pending_from_me: owed(other, 'requested'),
      disputed_cents: owed(me, 'disputed') + owed(other, 'disputed'),
      unconfirmed_payments: q("SELECT COUNT(*) n FROM payments WHERE family_id = ? AND to_user = ? AND status = 'sent'").get(c.family.id, me).n };
  }
  r.get('/api/balance', ({ c }) => { needFamily(c); return balance(c); });
  r.get('/api/payments', ({ c }) => {
    needFamily(c);
    return q('SELECT * FROM payments WHERE family_id = ? ORDER BY date DESC, id DESC').all(c.family.id).map(p => ({ ...p, expense_ids: j(p.expense_ids, []) }));
  });
  r.post('/api/payments', ({ c, body }) => {
    needParent(c);
    if (!c.coParent) throw bad('Your co-parent has not joined yet');
    const amount = cents(body.amount);
    const expIds = (Array.isArray(body.expense_ids) ? body.expense_ids : []).map(Number);
    for (const id of expIds) if (!q('SELECT 1 FROM expenses WHERE id = ? AND family_id = ?').get(id, c.family.id)) throw bad('Unknown expense');
    const id = Number(q('INSERT INTO payments(family_id, from_user, to_user, amount_cents, date, method, note, expense_ids, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(c.family.id, c.user.id, c.coParent, amount, isDate(body.date) ? body.date : utcToLocalDate(Date.now(), c.tz), str(body.method, 60), str(body.note, 1000), JSON.stringify(expIds), 'sent', nowIso()).lastInsertRowid);
    log(c, 'create', 'payment', id, { amount_cents: amount, to: c.coParent, method: str(body.method, 60), expense_ids: expIds });
    notify(c, 'payment_sent', { to: c.coParent, title: `${actor(c)} recorded a payment to you`, link: 'expenses', entity: 'payment', entityId: id,
      body: `${money(amount)}${str(body.method, 60) ? ` via ${str(body.method, 60)}` : ''}. Confirm when you receive it.` });
    return { id };
  });
  r.post('/api/payments/:id/confirm', ({ c, body, params }) => {
    needParent(c);
    const p = q('SELECT * FROM payments WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!p || p.to_user !== c.user.id) throw notFound();
    if (p.status !== 'sent') throw bad('Already handled');
    const status = body.received === false ? 'disputed' : 'confirmed';
    tx(() => {
      q('UPDATE payments SET status = ?, confirmed_at = ? WHERE id = ?').run(status, nowIso(), p.id);
      if (status === 'confirmed') for (const eid of j(p.expense_ids, [])) q("UPDATE expenses SET status = 'reimbursed' WHERE id = ? AND status = 'approved'").run(eid);
      log(c, status === 'confirmed' ? 'confirm' : 'dispute', 'payment', p.id, { note: str(body.note) });
    });
    notify(c, 'payment_confirmed', { to: p.from_user, link: 'expenses', entity: 'payment', entityId: p.id,
      title: status === 'confirmed' ? `${actor(c)} confirmed your payment` : `${actor(c)} says your payment was not received`,
      body: `${money(p.amount_cents)}${str(body.note, 200) ? `: ${str(body.note, 200)}` : ''}` });
    return { ok: true };
  });

  // ---------- files ----------
  r.get('/api/files/:hash', ({ c, params, raw }) => {
    needFamily(c);
    const f = q('SELECT * FROM files WHERE hash = ? AND family_id = ?').get(params.hash, c.family.id);
    if (!f) throw notFound();
    raw(200, Buffer.from(f.data), { 'Content-Type': f.type, 'Content-Disposition': `inline; filename="${f.name.replace(/[^\w.-]/g, '_')}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
  });

  // ---------- notes (append-only, attach to anything) ----------
  const NOTE_TARGETS = { event: 'events', expense: 'expenses', rule: 'rules', call: 'calls', exchange: 'exchanges', payment: 'payments', call_rule: 'call_rules' };
  r.get('/api/notes', ({ c, query }) => {
    needFamily(c);
    const rows = query.target_type
      ? q('SELECT n.*, f.name attachment_name, f.type attachment_type FROM notes n LEFT JOIN files f ON f.hash = n.attachment_hash WHERE n.family_id = ? AND n.target_type = ? AND n.target_id = ? ORDER BY n.id').all(c.family.id, String(query.target_type), String(query.target_id))
      : q('SELECT n.*, f.name attachment_name, f.type attachment_type FROM notes n LEFT JOIN files f ON f.hash = n.attachment_hash WHERE n.family_id = ? ORDER BY n.id DESC LIMIT 500').all(c.family.id);
    return rows.map(n => ({ ...n, author_name: nameOf(c, n.author) }));
  });
  r.post('/api/notes', ({ c, body }) => {
    needParent(c);
    const tt = String(body.target_type || ''), tid = String(body.target_id ?? '');
    if (tt === 'day') { if (!isDate(tid)) throw bad('Bad date'); }
    else if (tt === 'general') { /* free-standing journal entry */ }
    else if (NOTE_TARGETS[tt]) { if (!q(`SELECT 1 FROM ${NOTE_TARGETS[tt]} WHERE id = ? AND family_id = ?`).get(+tid, c.family.id)) throw notFound('Item not found'); }
    else throw bad('Unknown note target');
    const text = str(body.body, 10000); if (!text) throw bad('Write a note');
    const att = fileFrom(c, body.attachment);
    const content_hash = sha256(text);
    const id = Number(q('INSERT INTO notes(family_id, target_type, target_id, body, author, created_at, attachment_hash, content_hash) VALUES(?,?,?,?,?,?,?,?)')
      .run(c.family.id, tt, tid, text, c.user.id, nowIso(), att, content_hash).lastInsertRowid);
    log(c, 'create', 'note', id, { target_type: tt, target_id: tid, content_hash, attachment_hash: att });
    return { id };
  });

  // ---------- messaging ----------
  r.post('/api/tone-check', ({ body }) => checkTone(body.text));
  r.get('/api/threads', ({ c }) => {
    needFamily(c);
    return q(`SELECT t.*, (SELECT MAX(created_at) FROM messages WHERE thread_id = t.id) last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) count,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.author <> ? AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = ?)) unread
      FROM threads t WHERE t.family_id = ? ORDER BY last_at DESC`).all(c.user.id, c.user.id, c.family.id);
  });
  function addMessage(c, threadId, text) {
    const body = str(text, 8000); if (!body) throw bad('Write a message');
    const content_hash = sha256(body);
    const id = Number(q('INSERT INTO messages(thread_id, family_id, author, body, created_at, content_hash) VALUES(?,?,?,?,?,?)').run(threadId, c.family.id, c.user.id, body, nowIso(), content_hash).lastInsertRowid);
    log(c, 'create', 'message', id, { thread_id: threadId, content_hash });
    notify(c, 'message', { title: `New message from ${actor(c)}`, body: body.slice(0, 120), link: `messages/${threadId}`, entity: 'message', entityId: id });
    return id;
  }
  r.post('/api/threads', ({ c, body }) => {
    needParent(c);
    const subject = str(body.subject, 150); if (!subject) throw bad('Add a subject');
    const topic = ['general', 'schedule', 'expenses', 'school', 'medical', 'activities', 'other'].includes(body.topic) ? body.topic : 'general';
    return tx(() => {
      const id = Number(q('INSERT INTO threads(family_id, subject, topic, created_by, created_at) VALUES(?,?,?,?,?)').run(c.family.id, subject, topic, c.user.id, nowIso()).lastInsertRowid);
      log(c, 'create', 'thread', id, { subject, topic });
      addMessage(c, id, body.body);
      return { id };
    });
  });
  r.get('/api/threads/:id', ({ c, params }) => {
    needFamily(c);
    const t = q('SELECT * FROM threads WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!t) throw notFound();
    const msgs = q('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(t.id);
    const mark = q('INSERT OR IGNORE INTO message_reads(message_id, user_id, read_at) VALUES(?,?,?)');
    if (c.member.role === 'parent') for (const m of msgs) if (m.author !== c.user.id) mark.run(m.id, c.user.id, nowIso());
    notifier.markReadByLink(c.user.id, `messages/${t.id}`);
    const reads = q('SELECT r.* FROM message_reads r JOIN messages m ON m.id = r.message_id WHERE m.thread_id = ?').all(t.id);
    return { thread: t, messages: msgs.map(m => ({ ...m, author_name: nameOf(c, m.author), reads: reads.filter(x => x.message_id === m.id).map(x => ({ user: nameOf(c, x.user_id), at: x.read_at })) })) };
  });
  r.post('/api/threads/:id/messages', ({ c, body, params }) => {
    needParent(c);
    const t = q('SELECT * FROM threads WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!t) throw notFound();
    return { id: addMessage(c, t.id, body.body) };
  });

  // ---------- call / video allowances ----------
  r.get('/api/call-rules', ({ c }) => {
    needFamily(c);
    return q('SELECT * FROM call_rules WHERE family_id = ? ORDER BY id').all(c.family.id).map(x => ({ ...x, window: j(x.window, {}), entitled_name: nameOf(c, x.entitled_parent), requested_by_name: nameOf(c, x.requested_by) }));
  });
  r.post('/api/call-rules', ({ c, body }) => {
    needParent(c);
    const ent = +body.entitled_parent;
    if (!c.parents.includes(ent)) throw bad('Choose which parent the calls are for');
    const count = intOr(body.count, 0); if (count < 1 || count > 50) throw bad('Calls per period must be 1-50');
    const period = ['day', 'week', 'month'].includes(body.period) ? body.period : 'week';
    const method = ['phone', 'video', 'either'].includes(body.method) ? body.method : 'either';
    const dur = Math.max(0, Math.min(600, intOr(body.duration_min, 15)));
    const w = body.window || {};
    const window = { days: (w.days || []).map(Number).filter(d => d >= 0 && d <= 6), start: /^\d\d:\d\d$/.test(w.start) ? w.start : null, end: /^\d\d:\d\d$/.test(w.end) ? w.end : null, only_other_parents_time: w.only_other_parents_time !== false };
    const status = initialStatus(c);
    const name = str(body.name, 120) || `${count} ${method} call${count > 1 ? 's' : ''} per ${period}`;
    const id = Number(q(`INSERT INTO call_rules(family_id, name, entitled_parent, method, count, period, duration_min, window, reason, status, requested_by, requested_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.family.id, name, ent, method, count, period, dur, JSON.stringify(window), str(body.reason, 2000), status, c.user.id, nowIso()).lastInsertRowid);
    log(c, 'request', 'call_rule', id, { name, entitled_parent: ent, method, count, period, duration_min: dur, window, status });
    if (status === 'pending') notify(c, 'call_rule_requested', { title: `${actor(c)} proposed a call schedule`, body: name, link: 'calls', entity: 'call_rule', entityId: id });
    return { id };
  });
  r.post('/api/call-rules/:id/decide', ({ c, body, params }) => decide(c, 'call_rules', +params.id, body.decision, body.note));
  r.post('/api/call-rules/:id/withdraw', ({ c, params }) => withdraw(c, 'call_rules', +params.id));
  r.post('/api/call-rules/:id/retire', ({ c, body, params }) => retireRequest(c, 'call_rules', +params.id, body.note));
  r.post('/api/call-rules/:id/retire-decide', ({ c, body, params }) => retireDecide(c, 'call_rules', +params.id, body.decision, body.note));

  const CALL_STATUSES = ['completed', 'short', 'missed_not_facilitated', 'missed_not_called', 'declined_by_child', 'rescheduled', 'cancelled'];
  const CALL_LABELS = { completed: 'Completed', short: 'Cut short', missed_not_facilitated: 'Child not made available', missed_not_called: 'Parent did not call',
    declined_by_child: 'Child declined', rescheduled: 'Rescheduled', cancelled: 'Cancelled' };
  r.get('/api/calls', ({ c }) => {
    needFamily(c);
    return q('SELECT * FROM calls WHERE family_id = ? ORDER BY started_local DESC LIMIT 500').all(c.family.id).map(x => ({ ...x, child_ids: j(x.child_ids, []), logged_by_name: nameOf(c, x.logged_by) }));
  });
  r.post('/api/calls', ({ c, body }) => {
    needParent(c);
    if (!isLocal(body.started)) throw bad('Enter when the call was (or was supposed to be)');
    const status = CALL_STATUSES.includes(body.status) ? body.status : null; if (!status) throw bad('Choose what happened');
    const rule = body.rule_id ? q('SELECT id FROM call_rules WHERE id = ? AND family_id = ?').get(+body.rule_id, c.family.id) : null;
    const method = ['phone', 'video'].includes(body.method) ? body.method : 'phone';
    const id = Number(q('INSERT INTO calls(family_id, rule_id, child_ids, started_local, duration_min, status, method, details, logged_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(c.family.id, rule ? rule.id : null, JSON.stringify(childIds(c, body.child_ids)), body.started, Math.max(0, intOr(body.duration_min, 0)), status, method, str(body.details, 2000), c.user.id, nowIso()).lastInsertRowid);
    log(c, 'create', 'call', id, { rule_id: rule?.id ?? null, started: body.started, status, duration_min: intOr(body.duration_min, 0), method });
    notify(c, 'call_logged', { title: `${actor(c)} logged a call`, body: `${CALL_LABELS[status]} · ${fmtLocal(body.started)}`, link: 'calls', entity: 'call', entityId: id });
    return { id };
  });
  r.post('/api/calls/:id/confirm', ({ c, body, params }) => {
    needParent(c);
    const call = q('SELECT * FROM calls WHERE id = ? AND family_id = ?').get(+params.id, c.family.id);
    if (!call) throw notFound();
    if (call.logged_by === c.user.id) throw forbidden('The other parent confirms this');
    if (call.confirm_result) throw bad('Already answered');
    const result = body.agree ? 'agreed' : 'disputed';
    q('UPDATE calls SET confirm_result = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?').run(result, c.user.id, nowIso(), call.id);
    log(c, result === 'agreed' ? 'confirm' : 'dispute', 'call', call.id, { note: str(body.note) });
    notify(c, 'call_confirmed', { to: call.logged_by, title: `${actor(c)} ${result === 'agreed' ? 'agreed with' : 'disputed'} your call log`,
      body: `${CALL_LABELS[call.status] || call.status} · ${fmtLocal(call.started_local)}${str(body.note, 200) ? `: ${str(body.note, 200)}` : ''}`, link: 'calls', entity: 'call', entityId: call.id });
    return { ok: true };
  });

  function compliance(c, from, to) {
    const rules = q("SELECT * FROM call_rules WHERE family_id = ? AND status IN ('active','unconfirmed')").all(c.family.id).map(x => ({ ...x, window: j(x.window, {}) }));
    const calls = q('SELECT * FROM calls WHERE family_id = ? AND started_local >= ? AND started_local < ?').all(c.family.id, `${from}T00:00`, `${to}T00:00`);
    return rules.map(rule => {
      const periods = [];
      let p = from;
      if (rule.period === 'week') p = addDays(from, -((dayOfWeek(from) + 6) % 7)); // weeks start Monday
      if (rule.period === 'month') p = ymd(parseDate(from).y, parseDate(from).m, 1);
      while (p < to) {
        const next = rule.period === 'day' ? addDays(p, 1) : rule.period === 'week' ? addDays(p, 7)
          : (() => { const d = parseDate(p); return d.m === 12 ? ymd(d.y + 1, 1, 1) : ymd(d.y, d.m + 1, 1); })();
        const inP = calls.filter(x => x.rule_id === rule.id && x.started_local >= `${p}T00:00` && x.started_local < `${next}T00:00`);
        const count = (s) => inP.filter(x => x.status === s).length;
        const outside = inP.filter(x => {
          const [d, t] = x.started_local.split('T');
          return (rule.window.days?.length && !rule.window.days.includes(dayOfWeek(d))) || (rule.window.start && t < rule.window.start) || (rule.window.end && t > rule.window.end);
        }).length;
        periods.push({ start: p, end: next, allowed: rule.count, completed: count('completed'), short: count('short') + inP.filter(x => x.status === 'completed' && rule.duration_min && x.duration_min < rule.duration_min).length,
          missed_not_facilitated: count('missed_not_facilitated'), missed_not_called: count('missed_not_called'), declined_by_child: count('declined_by_child'),
          disputed: inP.filter(x => x.confirm_result === 'disputed').length, outside_window: outside });
        p = next;
      }
      const sum = (k) => periods.reduce((s, x) => s + x[k], 0);
      return { rule: { id: rule.id, name: rule.name, entitled: nameOf(c, rule.entitled_parent), count: rule.count, period: rule.period, duration_min: rule.duration_min, method: rule.method, window: rule.window },
        periods, totals: { allowed: sum('allowed'), completed: sum('completed'), missed_not_facilitated: sum('missed_not_facilitated'), missed_not_called: sum('missed_not_called'), short: sum('short'), disputed: sum('disputed'), outside_window: sum('outside_window') } };
    });
  }
  r.get('/api/calls/compliance', ({ c, query }) => {
    needFamily(c);
    const to = isDate(query.end) ? query.end : addDays(utcToLocalDate(Date.now(), c.tz), 1);
    const from = isDate(query.start) ? query.start : addDays(to, -28);
    return compliance(c, from, to);
  });

  // ---------- exchanges (hand-off check-ins) ----------
  const EXCHANGE_TEXT = { dropoff: ['checked in at an exchange', 'Drop-off'], pickup: ['checked in at an exchange', 'Pick-up'],
    no_show_other: ['recorded a missed exchange', 'No-show'], late_other: ['recorded a late exchange', 'Late arrival'] };
  r.get('/api/exchanges', ({ c }) => {
    needFamily(c);
    return q('SELECT * FROM exchanges WHERE family_id = ? ORDER BY at_ms DESC LIMIT 500').all(c.family.id).map(x => ({ ...x, child_ids: j(x.child_ids, []), logged_by_name: nameOf(c, x.logged_by),
      minutes_late: x.scheduled_ms ? Math.round((x.at_ms - x.scheduled_ms) / 60000) : null }));
  });
  r.post('/api/exchanges', ({ c, body }) => {
    needParent(c);
    const kind = ['dropoff', 'pickup', 'no_show_other', 'late_other'].includes(body.kind) ? body.kind : 'pickup';
    const at = isLocal(body.at) ? localStampToUtc(body.at, c.tz) : Date.now();
    const today = utcToLocalDate(at, c.tz);
    const { timeline } = timelineFor(c, addDays(today, -1), addDays(today, 2));
    const near = transitions(timeline).map(x => x.at).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
    const scheduled = near != null && Math.abs(near - at) < 8 * 3600000 ? near : null;
    const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
    const id = Number(q('INSERT INTO exchanges(family_id, kind, at_ms, scheduled_ms, location, lat, lng, accuracy, child_ids, details, logged_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.family.id, kind, at, scheduled, str(body.location, 300), num(body.lat), num(body.lng), num(body.accuracy), JSON.stringify(childIds(c, body.child_ids)), str(body.details, 2000), c.user.id, nowIso()).lastInsertRowid);
    log(c, 'create', 'exchange', id, { kind, at, scheduled, lat: num(body.lat), lng: num(body.lng), location: str(body.location, 300), recorded_at_server: Date.now() });
    const [what, label] = EXCHANGE_TEXT[kind];
    const late = scheduled != null && (kind === 'dropoff' || kind === 'pickup') ? Math.round((at - scheduled) / 60000) : null;
    notify(c, 'exchange_checkin', { title: `${actor(c)} ${what}`, link: 'exchanges', entity: 'exchange', entityId: id,
      body: `${label} at ${fmtTime(at, c.tz)}${late == null ? '' : late > 0 ? ` (${late} min late)` : late < 0 ? ` (${-late} min early)` : ' (on time)'}` });
    return { id, scheduled_ms: scheduled };
  });

  // ---------- dashboard ----------
  r.get('/api/dashboard', ({ c }) => {
    needFamily(c);
    const today = utcToLocalDate(Date.now(), c.tz);
    const y = parseDate(today).y;
    const { timeline } = timelineFor(c, addDays(today, -1), addDays(today, 60));
    const next = transitions(timeline).find(x => x.at > Date.now());
    const yearT = timelineFor(c, ymd(y, 1, 1), ymd(y + 1, 1, 1));
    const ytd = timelineFor(c, ymd(y, 1, 1), addDays(today, 1));
    const me = c.user.id;
    const pending = {
      rules: q("SELECT COUNT(*) n FROM rules WHERE family_id = ? AND status IN ('pending','unconfirmed') AND requested_by <> ?").get(c.family.id, me).n
        + q('SELECT COUNT(*) n FROM rules WHERE family_id = ? AND retire_requested_by IS NOT NULL AND retire_requested_by <> ?').get(c.family.id, me).n,
      call_rules: q("SELECT COUNT(*) n FROM call_rules WHERE family_id = ? AND status IN ('pending','unconfirmed') AND requested_by <> ?").get(c.family.id, me).n,
      events: q("SELECT COUNT(*) n FROM events WHERE family_id = ? AND status = 'proposed' AND created_by <> ?").get(c.family.id, me).n,
      expenses: q("SELECT COUNT(*) n FROM expenses WHERE family_id = ? AND status = 'requested' AND paid_by <> ?").get(c.family.id, me).n,
      payments: q("SELECT COUNT(*) n FROM payments WHERE family_id = ? AND status = 'sent' AND to_user = ?").get(c.family.id, me).n,
      calls: q('SELECT COUNT(*) n FROM calls WHERE family_id = ? AND confirm_result IS NULL AND logged_by <> ?').get(c.family.id, me).n,
      messages: q('SELECT COUNT(*) n FROM messages m WHERE m.family_id = ? AND m.author <> ? AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = ?)').get(c.family.id, me, me).n,
    };
    if (c.member.role !== 'parent') for (const k of Object.keys(pending)) pending[k] = 0;
    return {
      now: { parent: ownerAt(timeline, Date.now()) }, next_exchange: next || null,
      share_year: shareWithNames(c, timeShare(yearT.timeline, c.tz, ymd(y, 1, 1), ymd(y + 1, 1, 1))),
      share_ytd: shareWithNames(c, timeShare(ytd.timeline, c.tz, ymd(y, 1, 1), addDays(today, 1))),
      pending, balance: c.member.role === 'parent' ? balance(c) : null,
      upcoming: expandEvents(c, today, addDays(today, 14)).sort((a, b) => a.start - b.start).slice(0, 8).map(e => ({ ...e, custody_parent: ownerAt(timeline, e.start) })),
      compliance: compliance(c, addDays(today, -((dayOfWeek(today) + 6) % 7)), addDays(today, 1)),
    };
  });

  // ---------- records ----------
  r.get('/api/audit', ({ c, query }) => {
    needFamily(c);
    const limit = Math.min(1000, intOr(query.limit, 200));
    return q('SELECT * FROM audit WHERE family_id = ? ORDER BY seq DESC LIMIT ?').all(c.family.id, limit).map(a => ({ ...a, user_name: a.user_id ? nameOf(c, a.user_id) : null, data: j(a.data, {}) }));
  });
  r.get('/api/audit/verify', ({ c }) => { needFamily(c); return verifyFamily(db, c.family.id); });

  /** Short-lived link so the iPhone app can open the printable report in Safari, which has no session. */
  r.post('/api/report-link', ({ c, body }) => {
    needFamily(c);
    const today = utcToLocalDate(Date.now(), c.tz);
    const start = body.start == null || body.start === '' ? ymd(parseDate(today).y, 1, 1) : body.start;
    const end = body.end == null || body.end === '' ? today : body.end;
    if (!isDate(start) || !isDate(end)) throw bad('Dates must be YYYY-MM-DD');
    if (end < start) throw bad('The end date is before the start date');
    const t = token(32), expires = Date.now() + REPORT_LINK_MS;
    q('DELETE FROM report_links WHERE expires < ?').run(Date.now());
    q('INSERT INTO report_links(token, user_id, expires) VALUES(?,?,?)').run(t, c.user.id, expires);
    return { url: `/report?rt=${t}&start=${start}&end=${end}`, expires_at: new Date(expires).toISOString() };
  });

  // ---------- platform ----------
  r.get('/api/public-config', () => ({ appStoreUrl: opts.publicConfig?.appStoreUrl || null, testflightUrl: opts.publicConfig?.testflightUrl || null }));
  notificationRoutes(r, { db, notifier });
  accountRoutes(r, { db, notifier });

  // exposed for the report, ICS and reminder modules
  r.helpers = { loadCtx, familyCtx, timelineFor, expandEvents, shareWithNames, compliance, balance, nameOf, loadRules, j };
  return r;
}

function isPrivate(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); return m ? isPrivate(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
