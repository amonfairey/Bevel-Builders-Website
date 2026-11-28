/**
 * Pure helpers shared by the Calendar month grid and the Day screen. Every date is a
 * 'YYYY-MM-DD' string in the FAMILY time zone; instants are UTC ms (see lib/format.ts).
 */
import { addDays, addMonths, dayMs, daySegments, dow, localOf, type DaySegment } from '@/lib/format';
import type { EventInstance, ExternalEvent, TimelineInterval, TimelineSource, Transition } from '@/lib/types';

/** First and last (exclusive) date of the grid for month 'YYYY-MM': whole weeks, Sunday first. */
export function monthGridRange(month: string): { start: string; end: string; dates: string[] } {
  const first = `${month}-01`;
  const start = addDays(first, -dow(first));
  const lastInMonth = addDays(monthEnd(month), -1);
  const end = addDays(lastInMonth, 7 - dow(lastInMonth));
  const dates: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) dates.push(d);
  return { start, end, dates };
}

/** The month after 'YYYY-MM' as its first date (exclusive end of a month range). */
export function monthEnd(month: string): string {
  return `${addMonths(month, 1)}-01`;
}

/** Activity occurrences that start on `date` (family time), sorted by start. */
export function eventsOn(events: EventInstance[] | undefined, date: string, tz: string): EventInstance[] {
  return (events ?? []).filter((e) => (e.instance_date || localOf(e.start, tz).date) === date).sort((a, b) => a.start - b.start);
}

/**
 * Synced-calendar events on `date`: timed events on the day they start, all-day events on
 * every day they cover (all-day end is exclusive midnight).
 */
export function externalOn(external: ExternalEvent[] | undefined, date: string, tz: string): ExternalEvent[] {
  const a = dayMs(date, tz);
  const b = dayMs(addDays(date, 1), tz);
  return (external ?? [])
    .filter((e) => (e.all_day ? e.start_ms < b && e.end_ms > a : localOf(e.start_ms, tz).date === date))
    .sort((x, y) => (y.all_day - x.all_day) || x.start_ms - y.start_ms);
}

/** Custody segments of `date` (same logic as the web portal's daySegments). */
export function segmentsOn(timeline: TimelineInterval[] | undefined, date: string, tz: string): DaySegment[] {
  return timeline ? daySegments(timeline, date, tz) : [];
}

/** The holiday or one-time change in effect on the day (shown as a label), if any. */
export function specialSource(segs: DaySegment[]): TimelineSource | null {
  return segs.find((s) => s.src.type === 'holiday' || s.src.type === 'override')?.src ?? null;
}

/** Hand-offs that happen during `date`. */
export function transitionsOn(transitions: Transition[] | undefined, date: string, tz: string): Transition[] {
  const a = dayMs(date, tz);
  const b = dayMs(addDays(date, 1), tz);
  return (transitions ?? []).filter((x) => x.at >= a && x.at < b);
}

/** 'Alternating weekends · Regular schedule', or just 'Primary parent' for the background default. */
export function sourceText(src: TimelineSource): string {
  return src.type === 'default' ? 'Primary parent' : `${src.name} · ${sourceKind(src)}`;
}

/** Human label for a schedule source: 'Alternating weekends (regular schedule)'. */
export function sourceKind(src: TimelineSource): string {
  switch (src.type) {
    case 'default': return 'Primary parent';
    case 'pattern': return 'Regular schedule';
    case 'holiday': return 'Holiday or period';
    case 'override': return 'One-time change';
    default: return 'Schedule';
  }
}
