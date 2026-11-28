import { useCallback } from 'react';
import { addDays, isDate, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { EventInstance, EventsResponse } from '@/lib/types';

/**
 * Load one activity occurrence. There is no GET /api/events/:id, so this reads
 * /api/events for the occurrence's date (`date`, from ?date=) and, when that is missing or
 * the date no longer has an occurrence (skipped, or the series was edited), searches a year
 * either side of today and picks the next upcoming occurrence (else the latest past one).
 * Cancelled events are never returned by the server, so `event` is null for those.
 */
export function useEventInstance(id: string | undefined, date: string | undefined, tz: string) {
  const eventId = id && /^\d+$/.test(id) ? Number(id) : null;
  const day = isDate(date) ? date : null;
  const primary = useApi<EventsResponse>(eventId != null && day ? `/api/events?start=${day}&end=${addDays(day, 1)}` : null);
  const exact = primary.data?.events.find((e) => e.id === eventId && e.instance_date === day) ?? null;

  const today = todayLocal(tz);
  const needWide = eventId != null && (!day || (primary.data !== undefined && !exact));
  const wide = useApi<EventsResponse>(needWide ? `/api/events?start=${addDays(today, -365)}&end=${addDays(today, 366)}` : null);
  let fallback: EventInstance | null = null;
  if (needWide && wide.data) {
    const all = wide.data.events.filter((e) => e.id === eventId);
    fallback = all.find((e) => e.instance_date >= today) ?? all[all.length - 1] ?? null;
  }

  const event = exact ?? fallback;
  const loading = eventId != null && !event && (primary.loading || (needWide && wide.loading));
  const error = primary.error ?? (needWide ? wide.error : null);
  const reload = useCallback(async () => { await Promise.all([primary.reload(), needWide ? wide.reload() : Promise.resolve()]); }, [primary, wide, needWide]);
  const refresh = useCallback(async () => { await Promise.all([primary.refresh(), needWide ? wide.refresh() : Promise.resolve()]); }, [primary, wide, needWide]);
  return { event, eventId, loading, error, reload, refresh, refreshing: primary.refreshing || wide.refreshing, isExact: !!exact };
}
