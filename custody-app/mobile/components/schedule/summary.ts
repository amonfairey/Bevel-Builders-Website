/**
 * Plain-language descriptions of custody rules: a port of ruleSummary() in
 * custody-app/public/app.js, adapted to the phone (12-hour clock, weekday names).
 * Pure TypeScript (no React Native imports).
 */
import { DAYS, MONTHS, addDays, dow, fmtClock, fmtDate, fmtStamp, pad } from '@/lib/format';
import type {
  HolidayBoundary, HolidayConfig, HolidayDateRule, OverridePeriod, PatternConfig, PatternSegment, PatternTemplate, Rule, RuleStatus, RuleType,
} from '@/lib/types';

export type NameOf = (id: number | null | undefined) => string;

export const TEMPLATE_NAMES: Record<PatternTemplate, string> = {
  alternating_weekends: 'Alternating weekends',
  every_weekend: 'Every weekend',
  week_on_week_off: 'Week on / week off',
  '2-2-3': '2-2-3 rotation',
  '2-2-5-5': '2-2-5-5 rotation',
  '3-4-4-3': '3-4-4-3 rotation',
  custom: 'Custom cycle',
};

/** Template picker options (same list and order as the web portal). */
export const TEMPLATE_OPTIONS: { value: PatternTemplate; label: string; hint: string }[] = [
  { value: 'alternating_weekends', label: 'Alternating weekends', hint: 'Every other weekend, optional weekly Wednesday visit' },
  { value: 'every_weekend', label: 'Every weekend', hint: 'One parent has every weekend' },
  { value: 'week_on_week_off', label: 'Week on / week off', hint: '50/50, exchange once a week' },
  { value: '2-2-3', label: '2-2-3 rotation (50/50)', hint: '2 days, 2 days, 3 days, then swap' },
  { value: '2-2-5-5', label: '2-2-5-5 rotation (50/50)', hint: 'Same weekdays every week, alternate weekends' },
  { value: '3-4-4-3', label: '3-4-4-3 rotation (50/50)', hint: '3 days, 4 days, then swap' },
  { value: 'custom', label: 'Custom cycle (pick each day)', hint: '1 to 56 days, you choose who has each day' },
];

export const isWeekendTemplate = (t: PatternTemplate): boolean => t === 'alternating_weekends' || t === 'every_weekend';

/** Section order and titles of the schedule screen (lowest layer first). */
export const RULE_GROUPS: readonly { type: RuleType; title: string; empty: string }[] = [
  { type: 'default', title: 'Primary parent', empty: 'No primary parent set.' },
  { type: 'pattern', title: 'Regular schedule', empty: 'No regular schedule. The primary parent has the children all the time.' },
  { type: 'holiday', title: 'Holidays & periods', empty: 'None.' },
  { type: 'override', title: 'One-time changes', empty: 'None.' },
];

export const TYPE_LABEL: Record<RuleType, string> = {
  default: 'Primary (background) parent',
  pattern: 'Regular schedule',
  holiday: 'Holiday or vacation period',
  override: 'One-time change or swap',
};

export const IN_EFFECT: readonly RuleStatus[] = ['active', 'unconfirmed'];
export const HISTORY: readonly RuleStatus[] = ['rejected', 'withdrawn', 'retired'];

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** 'Thanksgiving' style description of when a holiday falls. */
export function holidayWhen(rr: HolidayDateRule): string {
  switch (rr.type) {
    case 'fixed': return `${MONTHS[rr.month - 1]} ${rr.day}`;
    case 'nth_weekday': return `${rr.n === -1 ? 'Last' : ORDINAL[rr.n] ?? `${rr.n}th`} ${DAYS[rr.weekday]} of ${MONTHS[rr.month - 1]}`;
    case 'easter': return 'Easter Sunday';
    case 'range': return `${MONTHS[rr.startMonth - 1]} ${rr.startDay} – ${MONTHS[rr.endMonth - 1]} ${rr.endDay}`;
    case 'once': return rr.endDate && rr.endDate !== rr.startDate ? `${fmtDate(rr.startDate)} – ${fmtDate(rr.endDate)}` : fmtDate(rr.startDate);
    default: return '';
  }
}

function offsetText(b: HolidayBoundary): string {
  const n = Math.abs(b.dayOffset);
  if (n === 0) return '';
  return `${n} day${n > 1 ? 's' : ''} ${b.dayOffset < 0 ? 'before' : 'after'} `;
}

export function holidayWho(c: HolidayConfig, nameOf: NameOf): string {
  const a = c.assignment;
  return a.mode === 'fixed' ? nameOf(a.parent) : `${nameOf(a.evenYears)} in even years, ${nameOf(a.oddYears)} in odd years`;
}

/** 'Fri (day 1)' for a pattern day index. */
export function patternDay(cfg: Pick<PatternConfig, 'anchorDate'>, day: number): string {
  return `${DAYS[dow(addDays(cfg.anchorDate, day))]} (day ${day + 1})`;
}

export function segmentText(cfg: Pick<PatternConfig, 'anchorDate'>, s: PatternSegment): string {
  return `${patternDay(cfg, s.startDay)} ${fmtClock(s.startTime)} → ${patternDay(cfg, s.endDay)} ${fmtClock(s.endTime)}`;
}

/** 'Sat, Dec 12, 2026, 9:00 AM – 6:00 PM', or two full stamps when the dates differ. */
export function periodText(p: Pick<OverridePeriod, 'start' | 'end'>): string {
  const [d1, t1] = p.start.split('T');
  const [d2, t2] = p.end.split('T');
  if (d1 === d2) return `${fmtDate(d1)}, ${fmtClock(t1)} – ${fmtClock(t2)}`;
  return `${fmtStamp(p.start)} → ${fmtStamp(p.end)}`;
}

/** One-paragraph summary of a rule (web portal ruleSummary). */
export function ruleSummary(r: Rule, nameOf: NameOf): string {
  if (r.type === 'default') return `${nameOf(r.config.parent)} has the children by default whenever no other rule applies.`;
  if (r.type === 'pattern') {
    const c = r.config;
    const segs = (c.segments || []).map((s) => `${nameOf(s.parent)}: ${segmentText(c, s)}`).join('; ');
    const name = (c.template && TEMPLATE_NAMES[c.template]) || 'Pattern';
    return `${name}, ${c.cycleDays}-day cycle starting ${fmtDate(c.anchorDate)}. ${segs}.`
      + `${c.effectiveFrom ? ` From ${fmtDate(c.effectiveFrom)}` : ''}${c.effectiveTo ? `${c.effectiveFrom ? '' : ' In effect'} until ${fmtDate(c.effectiveTo)}` : ''}${c.effectiveFrom || c.effectiveTo ? '.' : ''}`;
  }
  if (r.type === 'holiday') {
    const c = r.config;
    return `${holidayWhen(c.rule)}. From ${offsetText(c.start)}${fmtClock(c.start.time)} to ${offsetText(c.end)}${fmtClock(c.end.time)}. ${holidayWho(c, nameOf)}.`;
  }
  if (r.type === 'override') return (r.config.periods || []).map((p) => `${nameOf(p.parent)}: ${periodText(p)}`).join('; ');
  return '';
}

// ---------- holiday dates (mirrors server/time.js + schedule.js holidayOccurrence) ----------

const ymd = (y: number, m: number, d: number): string => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

function nthWeekday(year: number, month: number, weekday: number, n: number): string | null {
  if (n > 0) {
    const first = ymd(year, month, 1);
    const d = addDays(first, (weekday - dow(first) + 7) % 7 + (n - 1) * 7);
    return Number(d.slice(5, 7)) === month ? d : null;
  }
  const last = addDays(month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1), -1);
  return addDays(last, -((dow(last) - weekday + 7) % 7));
}

function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return ymd(year, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

export function holidayOccurrence(rule: HolidayDateRule, year: number): { startDate: string; endDate: string } | null {
  switch (rule.type) {
    case 'fixed': { const d = ymd(year, rule.month, rule.day); return { startDate: d, endDate: d }; }
    case 'nth_weekday': { const d = nthWeekday(year, rule.month, rule.weekday, rule.n); return d ? { startDate: d, endDate: d } : null; }
    case 'easter': { const d = easter(year); return { startDate: d, endDate: d }; }
    case 'range': {
      const wraps = rule.endMonth < rule.startMonth || (rule.endMonth === rule.startMonth && rule.endDay < rule.startDay);
      return { startDate: ymd(year, rule.startMonth, rule.startDay), endDate: ymd(wraps ? year + 1 : year, rule.endMonth, rule.endDay) };
    }
    case 'once':
      return rule.startDate && Number(rule.startDate.slice(0, 4)) === year ? { startDate: rule.startDate, endDate: rule.endDate || rule.startDate } : null;
    default: return null;
  }
}

export interface HolidayWindow {
  /** 'YYYY-MM-DDTHH:MM' family local time */
  start: string;
  end: string;
  parent: number;
  year: number;
}

/** The next window (ending today or later) a holiday rule gives someone the children, or null. */
export function nextHolidayWindow(c: HolidayConfig, today: string): HolidayWindow | null {
  const y = Number(today.slice(0, 4));
  for (let year = y - 1; year <= y + 2; year++) {
    const occ = holidayOccurrence(c.rule, year);
    if (!occ) continue;
    const endDate = addDays(occ.endDate, c.end.dayOffset);
    if (endDate < today) continue;
    const parent = c.assignment.mode === 'fixed' ? c.assignment.parent : year % 2 === 0 ? c.assignment.evenYears : c.assignment.oddYears;
    return { start: `${addDays(occ.startDate, c.start.dayOffset)}T${c.start.time}`, end: `${endDate}T${c.end.time}`, parent, year };
  }
  return null;
}
