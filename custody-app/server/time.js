// Time helpers. All custody math happens in the family's local time zone
// (so "exchange at 6pm" stays 6pm across DST), then converts to UTC ms.

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

export function isValidTz(tz) {
  try { dtf(tz); return true; } catch { return false; }
}

export function tzParts(ms, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in `tz` -> UTC epoch ms. Handles DST gaps by shifting forward. */
export function zonedToUtc(y, m, d, h, min, tz) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const off1 = tzOffsetMs(guess - 0, tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function isDate(s) { return typeof s === 'string' && DATE_RE.test(s); }
export function isLocal(s) { return typeof s === 'string' && LOCAL_RE.test(s); }
export function isTime(s) { return typeof s === 'string' && TIME_RE.test(s); }

export function parseDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Bad date: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function parseTime(s) {
  const m = TIME_RE.exec(s || '00:00');
  if (!m) throw new Error(`Bad time: ${s}`);
  return { h: +m[1], min: +m[2] };
}

/** 'YYYY-MM-DD' + 'HH:MM' in tz -> UTC ms */
export function localToUtc(dateStr, timeStr, tz) {
  const { y, m, d } = parseDate(dateStr);
  const { h, min } = parseTime(timeStr);
  return zonedToUtc(y, m, d, h, min, tz);
}

/** 'YYYY-MM-DDTHH:MM' in tz -> UTC ms */
export function localStampToUtc(stamp, tz) {
  const [date, time] = stamp.split('T');
  return localToUtc(date, time, tz);
}

export function utcToLocalDate(ms, tz) {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function utcToLocalStamp(ms, tz) {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

export function pad(n) { return String(n).padStart(2, '0'); }

// Civil-date arithmetic (no time zone involved).
function dateToDays(s) { const { y, m, d } = parseDate(s); return Date.UTC(y, m - 1, d) / 86400000; }
function daysToDate(n) {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function addDays(s, n) { return daysToDate(dateToDays(s) + n); }
export function diffDays(a, b) { return dateToDays(a) - dateToDays(b); }
export function dayOfWeek(s) { return new Date(dateToDays(s) * 86400000).getUTCDay(); }
export function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

/** nth weekday of a month; n = -1 means last. weekday 0=Sun. */
export function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = ymd(year, month, 1);
    const shift = (weekday - dayOfWeek(first) + 7) % 7;
    const d = addDays(first, shift + (n - 1) * 7);
    return parseDate(d).m === month ? d : null;
  }
  const nextMonth = month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1);
  const last = addDays(nextMonth, -1);
  const shift = (dayOfWeek(last) - weekday + 7) % 7;
  return addDays(last, -shift);
}

/** Western (Gregorian) Easter — anonymous Gregorian algorithm. */
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}
