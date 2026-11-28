import type { Option } from '@/components/ui';
import { DAYS, DAYS_LONG, fmtShortDate } from '@/lib/format';
import { routes } from '@/lib/links';
import type { EventInstance, Recurrence } from '@/lib/types';

/** Activity types, same values and labels as the web portal's eventForm. */
export const EVENT_CATEGORIES: Option<string>[] = [
  { value: 'activity', label: 'Activity / sport' },
  { value: 'school', label: 'School' },
  { value: 'medical', label: 'Medical / dental' },
  { value: 'therapy', label: 'Therapy / counseling' },
  { value: 'social', label: 'Party / social' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
];

export const eventCategoryLabel = (v: string): string => EVENT_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export type RepeatFreq = '' | Recurrence['freq'];
export const REPEAT_OPTIONS: Option<RepeatFreq>[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly (same date)' },
];

/** 'Weekly on Tue, Thu' / 'Every 2 weeks on Mon · until Jun 1' / 'Monthly on the 5th'. */
export function recurrenceSummary(rec: Recurrence | null | undefined, startDate: string): string {
  if (!rec || !rec.freq) return 'Does not repeat';
  const n = Math.max(1, rec.interval || 1);
  const unit = rec.freq === 'daily' ? 'day' : rec.freq === 'weekly' ? 'week' : 'month';
  let s = n === 1 ? (rec.freq === 'daily' ? 'Daily' : rec.freq === 'weekly' ? 'Weekly' : 'Monthly') : `Every ${n} ${unit}s`;
  if (rec.freq === 'weekly') {
    const days = rec.byday?.length ? [...rec.byday].sort((a, b) => a - b) : null;
    s += days ? ` on ${days.map((d) => DAYS[d]).join(', ')}` : ` on ${DAYS_LONG[new Date(`${startDate}T12:00:00Z`).getUTCDay()]}`;
  }
  if (rec.freq === 'monthly') {
    const d = Number(startDate.slice(8, 10));
    const suf = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
    s += ` on the ${d}${suf}`;
  }
  if (rec.until) s += ` · until ${fmtShortDate(rec.until)}`;
  return s;
}

/**
 * Detail route of one occurrence. List items are expanded instances that share the event
 * (series) id, so the occurrence date travels as ?date=.
 */
export function activityHref(e: Pick<EventInstance, 'id' | 'instance_date'>): string {
  return `${routes.activity(e.id)}?date=${encodeURIComponent(e.instance_date)}`;
}

/** Edit route for the series, with the occurrence date to find it quickly. */
export function editActivityHref(e: Pick<EventInstance, 'id' | 'instance_date'>): string {
  return `${routes.editActivity(e.id)}&date=${encodeURIComponent(e.instance_date)}`;
}

/** True when someone drives who is not the parent with custody at the start time. */
export const driverDiffers = (e: Pick<EventInstance, 'custody_parent' | 'transport_parent'>): boolean =>
  e.custody_parent != null && e.transport_parent != null && e.custody_parent !== e.transport_parent;
