/**
 * Time-zone-correct date helpers, mirroring custody-app/public/app.js and server/time.js.
 *
 * Every function that turns an instant (UTC ms) into wall-clock text takes the FAMILY time
 * zone explicitly (me.family.timezone). Never use the device zone for custody times: a
 * parent travelling to another zone must still see "6:00 PM exchange" in family time.
 *
 * Pure TypeScript with no React Native imports, so it runs under plain Node for tests
 * (`npm test`, see lib/__tests__/format.test.ts).
 */
import type { TimelineInterval, TimelineSource } from './types';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export const pad = (n: number): string => String(n).padStart(2, '0');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 'YYYY-MM-DD' */
export const isDate = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s);
/** 'HH:MM' */
export const isTime = (s: unknown): s is string => typeof s === 'string' && TIME_RE.test(s);
/** 'YYYY-MM-DDTHH:MM' */
export const isLocalStamp = (s: unknown): s is string => typeof s === 'string' && STAMP_RE.test(s);

/** The device's IANA time zone (used only as the default when creating a family). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

/** True when the JS engine knows this IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------- wall-clock parts in a zone ----------

interface Parts { y: number; m: number; d: number; h: number; min: number; s: number }

const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
let warnedTz = false;

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock components of instant `ms` in zone `tz`. */
export function zonedParts(ms: number, tz: string): Parts {
  let f: Intl.DateTimeFormat;
  try {
    f = partsFormatter(tz);
  } catch {
    // Unknown zone: fall back to the device zone rather than crashing.
    if (!warnedTz) { warnedTz = true; console.warn(`Unknown time zone "${tz}", using the device zone`); }
    const dt = new Date(ms);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), min: dt.getMinutes(), s: dt.getSeconds() };
  }
  const p: Record<string, string> = {};
  if (typeof f.formatToParts === 'function') {
    for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  } else {
    // Defensive fallback for engines without formatToParts: "MM/DD/YYYY, HH:MM:SS"
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(f.format(new Date(ms)));
    if (m) Object.assign(p, { month: m[1], day: m[2], year: m[3], hour: m[4], minute: m[5], second: m[6] });
  }
  const h = Number(p.hour);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: h === 24 ? 0 : h, min: Number(p.minute), s: Number(p.second || 0) };
}

function offsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Wall-clock date + time in `tz` -> UTC ms. Same result as server/time.js zonedToUtc, so the two
 * always agree: a time inside a spring-forward gap shifts forward by the gap (02:30 -> 03:30), and a
 * time that happens twice (fall back) is the first occurrence.
 */
export function localToMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const off1 = offsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = offsetMs(t1, tz);
  if (off2 === off1) return t1;
  const t2 = guess - off2;
  if (offsetMs(t2, tz) === off2) return t2;
  return guess - Math.min(off1, off2); // in a gap: the offset in force before it
}

/** 'YYYY-MM-DDTHH:MM' in `tz` -> UTC ms */
export function stampToMs(stamp: string, tz: string): number {
  const [date, time] = stamp.split('T');
  return localToMs(date, time, tz);
}

/** Local midnight of `date` in `tz` as UTC ms. */
export function dayMs(date: string, tz: string): number {
  return localToMs(date, '00:00', tz);
}

/** { date: 'YYYY-MM-DD', time: 'HH:MM' } of instant `ms` in `tz`. */
export function localOf(ms: number, tz: string): { date: string; time: string } {
  const p = zonedParts(ms, tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.min)}` };
}

/** Today's date in `tz`. */
export function todayLocal(tz: string, now: number = Date.now()): string {
  return localOf(now, tz).date;
}

/** Now as 'YYYY-MM-DDTHH:MM' in `tz` (default value for datetime fields). */
export function nowLocalStamp(tz: string, now: number = Date.now()): string {
  const l = localOf(now, tz);
  return `${l.date}T${l.time}`;
}

/** UTC ms -> 'YYYY-MM-DDTHH:MM' in `tz`. */
export function msToStamp(ms: number, tz: string): string {
  const l = localOf(ms, tz);
  return `${l.date}T${l.time}`;
}

// ---------- civil date arithmetic (no zone involved) ----------

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** a - b in days */
export function diffDays(a: string, b: string): number {
  const toDays = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  return Math.round(toDays(a) - toDays(b));
}

/** Day of week, 0 = Sunday. */
export function dow(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Number of days in month m (1-12) of year y. */
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First day of the month after/before 'YYYY-MM' by `delta` months -> 'YYYY-MM'. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

// ---------- display ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Intl formatting of an instant in `tz` (en-US). */
export function fmt(ms: number, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts);
    }
    fmtCache.set(key, f);
  }
  return f.format(new Date(ms));
}

/** 'Mon, Mar 9, 6:00 PM' */
export const fmtDT = (ms: number, tz: string): string => fmt(ms, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** '6:00 PM' */
export const fmtT = (ms: number, tz: string): string => fmt(ms, tz, { hour: 'numeric', minute: '2-digit' });
/** ISO timestamp (created_at etc.) -> 'Mon, Mar 9, 6:00 PM' in `tz`; '' for empty. */
export const fmtIso = (iso: string | null | undefined, tz: string): string => (iso ? fmtDT(Date.parse(iso), tz) : '');

/** 'YYYY-MM-DD' -> 'Sun, Mar 8, 2026' */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAYS[dow(date)]}, ${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

/** 'YYYY-MM-DD' -> 'Mar 8' */
export function fmtShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/** 'HH:MM' -> '6:00 PM' (pure string formatting, no zone) */
export function fmtClock(time: string): string {
  const [h, min] = time.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 'YYYY-MM-DDTHH:MM' -> 'Sun, Mar 8, 2026, 6:00 PM' (pure string formatting) */
export function fmtStamp(stamp: string): string {
  const [date, time] = stamp.split('T');
  return `${fmtDate(date)}, ${fmtClock(time || '00:00')}`;
}

/** Integer cents -> '$12.50' / '-$3.00' */
export const money = (cents: number): string => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);

/** Relative time for notification lists: 'just now', '5 min ago', '3 h ago', else a date. */
export function fmtAgo(iso: string, tz: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmt(t, tz, { month: 'short', day: 'numeric' });
}

// ---------- timeline helpers ----------

export interface DaySegment {
  parent: number | null;
  /** share of the local day (0-1); a 23 h or 25 h DST day is handled */
  frac: number;
  src: TimelineSource;
  /** '12:00 AM–6:00 PM' in `tz` */
  label: string;
  /** UTC ms, clipped to the day */
  start: number;
  end: number;
}

/** Custody segments of one local day, clipped to [local midnight, next local midnight). */
export function daySegments(timeline: TimelineInterval[], date: string, tz: string): DaySegment[] {
  const a = dayMs(date, tz);
  const b = dayMs(addDays(date, 1), tz);
  const out: DaySegment[] = [];
  for (const iv of timeline) {
    const s = Math.max(a, iv.start);
    const e = Math.min(b, iv.end);
    if (e > s) out.push({ parent: iv.parent, frac: (e - s) / (b - a), src: iv.src, label: `${fmtT(s, tz)}–${fmtT(e, tz)}`, start: s, end: e });
  }
  return out;
}

/** Who has the children at instant `ms` (null if unassigned / outside the timeline). */
export function ownerAt(timeline: TimelineInterval[], ms: number): number | null {
  const iv = timeline.find((x) => x.start <= ms && x.end > ms);
  return iv ? iv.parent : null;
}
