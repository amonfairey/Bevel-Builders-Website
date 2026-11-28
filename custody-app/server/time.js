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

/**
 * Wall-clock time in `tz` -> UTC epoch ms.
 * DST gap (a wall time that does not exist, e.g. 02:30 on a spring-forward day in the US): shifted forward by
 * the length of the gap, so 02:30 becomes 03:30. DST overlap (01:30 on a fall-back day happens twice): the
 * first occurrence.
 */
export function zonedToUtc(y, m, d, h, min, tz) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Fast path: most days have one UTC offset all day; cached per (zone, date).
  const dayOff = dayOffset(y, m, d, tz);
  if (dayOff !== null) return guess - dayOff;
  return exactZonedToUtc(guess, tz);
}

function exactZonedToUtc(guess, tz) {
  const off1 = tzOffsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, tz);
  if (off2 === off1) return t1;
  const t2 = guess - off2;
  if (tzOffsetMs(t2, tz) === off2) return t2;
  // Neither offset round-trips: the wall time falls in a gap. Use the offset in force before the gap
  // (the smaller one), which lands the same distance after the gap's end.
  return guess - Math.min(off1, off2);
}

// (zone, local date) -> the UTC offset in force for that whole local day, or null when it changes during the day
// (or close enough that the exact computation is needed). A day's wall times map into [U - 14h, U + 38h] UTC.
const dayOffCache = new Map();
function dayOffset(y, m, d, tz) {
  const key = `${tz}|${y}-${m}-${d}`;
  let v = dayOffCache.get(key);
  if (v !== undefined) return v;
  const u = Date.UTC(y, m - 1, d);
  const a = tzOffsetMs(u - 14 * 3600000, tz), b = tzOffsetMs(u + 38 * 3600000, tz);
  v = a === b ? a : null;
  if (dayOffCache.size > 100000) dayOffCache.clear();
  dayOffCache.set(key, v);
  return v;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function isDate(s) { return typeof s === 'string' && DATE_RE.test(s); }
export function isLocal(s) { return typeof s === 'string' && LOCAL_RE.test(s); }
export function isTime(s) { return typeof s === 'string' && TIME_RE.test(s); }

/** Like isDate/isTime/isLocal, but the value must also be a real calendar date / clock time (no 2026-02-30, no 25:00). */
export function isRealDate(s) {
  if (!isDate(s)) return false;
  const { y, m, d } = parseDate(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function isRealTime(s) { if (!isTime(s)) return false; const { h, min } = parseTime(s); return h <= 23 && min <= 59; }
export function isRealLocal(s) { if (!isLocal(s)) return false; const [d, t] = s.split('T'); return isRealDate(d) && isRealTime(t); }

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
