// Minimal iCalendar (RFC 5545) reader/writer.
// Reading: handles line folding, UTC / TZID / floating / all-day times, and the
// common RRULE shapes Google, Apple and Outlook emit (DAILY/WEEKLY/MONTHLY/YEARLY,
// INTERVAL, COUNT, UNTIL, BYDAY for weekly) plus EXDATE.
// Writing: produces a feed that all three can subscribe to.

import { zonedToUtc, isValidTz, pad, tzParts } from './time.js';

// Outlook often emits Windows zone names.
const WINDOWS_TZ = {
  'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix', 'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York', 'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax',
  'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'UTC': 'UTC',
};

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon), value = line.slice(colon + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function findValueColon(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) return i;
  }
  return -1;
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function resolveTz(tzid, fallback) {
  if (!tzid) return fallback;
  const t = WINDOWS_TZ[tzid] || tzid;
  return isValidTz(t) ? t : fallback;
}

/** Returns { ms, allDay, wall:{y,m,d,h,min}, tz } */
function parseDateValue(value, params, defaultTz) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    return { allDay: true, wall: { y, m, d, h: 0, min: 0 }, tz: defaultTz, ms: zonedToUtc(y, m, d, 0, 0, defaultTz) };
  }
  const mt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!mt) return null;
  const [y, m, d, h, min] = [+mt[1], +mt[2], +mt[3], +mt[4], +mt[5]];
  if (mt[7]) return { allDay: false, wall: null, tz: 'UTC', ms: Date.UTC(y, m - 1, d, h, min, +(mt[6] || 0)) };
  const tz = resolveTz(params.TZID, defaultTz);
  return { allDay: false, wall: { y, m, d, h, min }, tz, ms: zonedToUtc(y, m, d, h, min, tz) };
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_MS = 86400000;

/** Limits for imported calendars (a feed is untrusted input). */
export const ICS_LIMITS = { events: 5000, iterations: 200000, exdates: 1000 };

/**
 * Parse an ICS document into concrete event instances overlapping [fromMs, toMs).
 * Returns [{uid, title, location, start, end, allDay}]
 * Throws if the file has more than ICS_LIMITS.events VEVENTs. Recurrence expansion shares a budget of
 * ICS_LIMITS.iterations steps across the whole file and jumps straight to the window, so an event that
 * started decades ago costs no more than one that started last week.
 */
export function parseIcs(text, { defaultTz = 'UTC', fromMs, toMs, maxInstances = 5000, limits = ICS_LIMITS }) {
  const lines = unfold(text);
  const events = [];
  let cur = null, depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      if (events.length >= limits.events) throw new Error(`Calendar has more than ${limits.events} events`);
      cur = { exdates: new Set(), overrides: false }; depth = 0; continue;
    }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }      // VALARM etc.
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value.toUpperCase(); break;
      case 'DTSTART': cur.dtstart = parseDateValue(p.value, p.params, defaultTz); break;
      case 'DTEND': cur.dtend = parseDateValue(p.value, p.params, defaultTz); break;
      case 'DURATION': cur.duration = parseDuration(p.value); break;
      case 'RRULE': cur.rrule = Object.fromEntries(p.value.split(';').map(kv => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v])); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDateValue(p.value, p.params, defaultTz); break;
      case 'EXDATE':
        for (const v of p.value.split(',')) { if (cur.exdates.size >= limits.exdates) break; const d = parseDateValue(v, p.params, defaultTz); if (d) cur.exdates.add(d.ms); }
        break;
    }
  }

  // Modified single instances (RECURRENCE-ID) replace the generated instance.
  const replaced = new Map();
  for (const e of events) if (e.recurrenceId && e.uid) {
    if (!replaced.has(e.uid)) replaced.set(e.uid, new Set());
    replaced.get(e.uid).add(e.recurrenceId.ms);
  }

  const out = [];
  const budget = { left: limits.iterations };
  for (const e of events) {
    if (out.length >= maxInstances) break;
    if (!e.dtstart || e.status === 'CANCELLED') continue;
    const durMs = Math.max(0, e.dtend ? e.dtend.ms - e.dtstart.ms : (e.duration ?? (e.dtstart.allDay ? 86400000 : 3600000)));
    const base = { uid: e.uid || `${e.title}-${e.dtstart.ms}`, title: e.title || '(no title)', location: e.location || '', allDay: e.dtstart.allDay };
    if (!e.rrule || e.recurrenceId) {
      if (e.dtstart.ms < toMs && e.dtstart.ms + durMs > fromMs) out.push({ ...base, start: e.dtstart.ms, end: e.dtstart.ms + durMs });
      continue;
    }
    const skip = replaced.get(e.uid) || new Set();
    for (const startMs of expandRrule(e.dtstart, e.rrule, toMs, maxInstances, fromMs - durMs, budget)) {
      if (e.exdates.has(startMs) || skip.has(startMs)) continue;
      if (startMs + durMs <= fromMs) continue;
      out.push({ ...base, uid: `${base.uid}#${startMs}`, start: startMs, end: startMs + durMs });
      if (out.length >= maxInstances) break;
    }
  }
  return out;
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/**
 * Occurrence start times of an RRULE, up to toMs. Without COUNT, the expansion starts near `skipToMs`
 * (whole intervals are skipped arithmetically); every step spends one unit of the shared `budget`.
 */
function* expandRrule(dtstart, rr, toMs, max, skipToMs, budget) {
  const freq = rr.FREQ;
  const interval = Math.min(1000, Math.max(1, Math.floor(+(rr.INTERVAL || 1)) || 1));
  const count = rr.COUNT ? +rr.COUNT : Infinity;
  let until = Infinity;
  if (rr.UNTIL) { const u = parseDateValue(rr.UNTIL, {}, dtstart.tz); if (u) until = u.allDay ? u.ms + 86399999 : u.ms; }
  const tz = dtstart.tz;
  const w = dtstart.wall || (() => { const p = tzParts(dtstart.ms, 'UTC'); return { y: p.y, m: p.m, d: p.d, h: p.h, min: p.min }; })();
  const at = (y, m, d) => zonedToUtc(y, m, d, w.h, w.min, tz);
  let n = 0;
  const emit = (ms) => { if (ms < dtstart.ms) return false; n++; return true; };
  const step = () => --budget.left >= 0;
  // Skipping ahead is only exact when COUNT doesn't need the skipped occurrences counted.
  // Two days of margin covers any time zone offset between wall dates and UTC.
  const target = Number.isFinite(count) || !Number.isFinite(skipToMs) ? -Infinity : skipToMs - 2 * DAY_MS;
  const startDay = Date.UTC(w.y, w.m - 1, w.d);

  if (freq === 'WEEKLY') {
    const days = rr.BYDAY ? [...new Set(rr.BYDAY.split(',').map(s => DAY_CODES.indexOf(s.slice(-2))).filter(x => x >= 0))].sort() : [new Date(startDay).getUTCDay()];
    const startDow = new Date(startDay).getUTCDay();
    let weekStart = startDay - startDow * DAY_MS;
    const stepMs = 7 * interval * DAY_MS;
    if (target > weekStart + stepMs) weekStart += Math.floor((target - weekStart) / stepMs - 1) * stepMs;
    while (step()) {
      for (const dow of days) {
        const dt = new Date(weekStart + dow * DAY_MS);
        const ms = at(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        if (ms > until || ms >= toMs || n >= count || n >= max) return;
        if (emit(ms)) yield ms;
      }
      weekStart += stepMs;
    }
    return;
  }
  let i = 0;
  if (target > startDay) {
    const t = new Date(target);
    let ahead = 0;
    if (freq === 'DAILY') ahead = Math.floor((target - startDay) / DAY_MS) - 1;
    else if (freq === 'MONTHLY') ahead = (t.getUTCFullYear() - w.y) * 12 + (t.getUTCMonth() + 1 - w.m) - 1;
    else if (freq === 'YEARLY') ahead = t.getUTCFullYear() - w.y - 1;
    if (ahead > 0) i = Math.floor(ahead / interval) * interval;
  }
  for (; step(); i += interval) {
    let y = w.y, m = w.m, d = w.d;
    if (freq === 'DAILY') { const dt = new Date(startDay + i * DAY_MS); y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate(); }
    else if (freq === 'MONTHLY') { const t = (w.m - 1) + i; y = w.y + Math.floor(t / 12); m = (t % 12) + 1; }
    else if (freq === 'YEARLY') { y = w.y + i; }
    else return;
    // skip invalid dates like Feb 30
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1) continue;
    const ms = at(y, m, d);
    if (ms > until || ms >= toMs || n >= count || n >= max) return;
    if (emit(ms)) yield ms;
  }
}

// ---------- Writer ----------

// Text values: CR/LF become an escaped newline, other control characters are dropped, then \ , ; are escaped.
// eslint-disable-next-line no-control-regex
function esc(s) { return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function fold(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s) > 74) {
    let cut = 74;
    while (Buffer.byteLength(s.slice(0, cut)) > 74) cut--;
    out.push(s.slice(0, cut)); s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
}
function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** events: [{uid, title, start, end, location, description}] (UTC ms) */
export function buildIcs({ name, events }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CoParent Hub//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  const now = utcStamp(Date.now());
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}`, `DTSTAMP:${now}`, `DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.transparent) lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
