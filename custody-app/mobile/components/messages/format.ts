import { fmt, fmtDT, fmtT, localOf, todayLocal } from '@/lib/format';
import type { IconName } from '@/components/ui';
import type { ThreadTopic } from '@/lib/types';

/** Topics offered when starting a conversation (same list and order as the web portal). */
export const TOPICS: readonly { value: ThreadTopic; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'school', label: 'School' },
  { value: 'medical', label: 'Medical' },
  { value: 'activities', label: 'Activities' },
];

const TOPIC_ICON: Record<string, IconName> = {
  general: 'chatbubbles',
  schedule: 'calendar',
  expenses: 'wallet',
  school: 'school',
  medical: 'medkit',
  activities: 'football',
  other: 'ellipsis-horizontal',
};

export function topicLabel(topic: string): string {
  return TOPICS.find((t) => t.value === topic)?.label ?? (topic === 'other' ? 'Other' : topic);
}

export function topicIcon(topic: string): IconName {
  return TOPIC_ICON[topic] ?? 'chatbubbles';
}

/** ISO time -> '6:05 PM' when it is today in the family zone, else 'Mon, Mar 9, 6:05 PM'. */
export function fmtWhen(iso: string, tz: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  return localOf(ms, tz).date === todayLocal(tz, now) ? fmtT(ms, tz) : fmtDT(ms, tz);
}

/** ISO time -> '6:05 PM' today, 'Mar 9' this year, 'Mar 9, 2025' otherwise (conversation list). */
export function fmtListTime(iso: string | null | undefined, tz: string, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  const day = localOf(ms, tz).date;
  const today = todayLocal(tz, now);
  if (day === today) return fmtT(ms, tz);
  if (day.slice(0, 4) === today.slice(0, 4)) return fmt(ms, tz, { month: 'short', day: 'numeric' });
  return fmt(ms, tz, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Family-zone 'YYYY-MM-DD' of an ISO time (used for day separators in a conversation). */
export function isoDay(iso: string, tz: string): string {
  return localOf(Date.parse(iso), tz).date;
}
