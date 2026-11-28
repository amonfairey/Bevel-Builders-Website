import { addDays, DAYS, fmtClock, fmtShortDate, MONTHS } from '@/lib/format';
import { CALL_STATUS } from '@/lib/status';
import type { CallMethod, CallPeriod, CallWindow, CompliancePeriod } from '@/lib/types';

export const METHOD_OPTIONS: readonly { value: CallMethod; label: string }[] = [
  { value: 'either', label: 'Either' },
  { value: 'phone', label: 'Phone' },
  { value: 'video', label: 'Video' },
];

export const PERIOD_OPTIONS: readonly { value: CallPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Same labels as the web portal's CALL_STATUS. */
export function callStatusLabel(status: string): string {
  return CALL_STATUS.find(([v]) => v === status)?.[1] ?? status;
}

const METHOD_WORD: Record<string, string> = { either: 'phone or video', phone: 'phone', video: 'video' };

/** '2 video calls per week, 15 min minimum · Mon, Wed · 6:00 PM–8:00 PM' */
export function describeRule(r: { count: number; method: CallMethod; period: CallPeriod; duration_min: number; window: CallWindow }): string {
  const parts = [`${r.count} ${METHOD_WORD[r.method] ?? r.method} call${r.count === 1 ? '' : 's'} per ${r.period}${r.duration_min ? `, ${r.duration_min} min minimum` : ''}`];
  const days = r.window?.days ?? [];
  if (days.length) parts.push([...days].sort((a, b) => a - b).map((d) => DAYS[d]).join(', '));
  const start = r.window?.start;
  const end = r.window?.end;
  if (start || end) parts.push(start && end ? `${fmtClock(start)}–${fmtClock(end)}` : start ? `from ${fmtClock(start)}` : `until ${fmtClock(end as string)}`);
  return parts.join(' · ');
}

/** Compliance period label: 'Nov 28' (day), 'Nov 23–29' (week), 'November 2026' (month). `end` is exclusive. */
export function periodLabel(p: Pick<CompliancePeriod, 'start' | 'end'>, period: CallPeriod): string {
  if (period === 'day') return fmtShortDate(p.start);
  if (period === 'month') {
    const [y, m] = p.start.split('-').map(Number);
    return `${MONTHS[m - 1].slice(0, 3)} ${y}`;
  }
  const last = addDays(p.end, -1);
  return p.start.slice(0, 7) === last.slice(0, 7) ? `${fmtShortDate(p.start)}–${Number(last.slice(8))}` : `${fmtShortDate(p.start)}–${fmtShortDate(last)}`;
}
