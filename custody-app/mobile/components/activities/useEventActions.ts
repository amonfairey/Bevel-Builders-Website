import { useCallback } from 'react';
import { useAttempt, useDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { fmtDT } from '@/lib/format';
import type { EventInstance, OkResponse } from '@/lib/types';

/**
 * Acknowledge / decline / skip one date / cancel, with the web portal's dialogs. Each
 * resolves true when the server accepted it; `onDone` runs after every successful change.
 * Respond and cancel act on the event (series) id; skip sends the occurrence date.
 */
export function useEventActions(tz: string, onDone?: () => unknown) {
  const dialog = useDialog();
  const attempt = useAttempt();
  const badges = useBadges();

  const after = useCallback(async (ok: unknown) => {
    if (ok === undefined) return false;
    void badges.refresh();
    await onDone?.();
    return true;
  }, [badges, onDone]);

  const acknowledge = useCallback(async (e: EventInstance) => {
    const c = await dialog.confirm({ title: 'Acknowledge activity', message: `"${e.title}"${e.recurrence ? ' (all repeats)' : ''}`, okLabel: 'Acknowledge', withNote: true });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/events/${e.id}/respond`, { response: 'accepted', note: c.note }), 'Acknowledged'));
  }, [dialog, attempt, after]);

  const decline = useCallback(async (e: EventInstance) => {
    const c = await dialog.confirm({
      title: 'Decline activity', message: `Say why, briefly.${e.recurrence ? ' This applies to all repeats.' : ''}`, okLabel: 'Decline', destructive: true,
      withNote: true, noteRequired: true, notePlaceholder: 'Required: why you decline',
    });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/events/${e.id}/respond`, { response: 'declined', note: c.note }), 'Declined'));
  }, [dialog, attempt, after]);

  const skip = useCallback(async (e: EventInstance) => {
    const c = await dialog.confirm({ title: 'Cancel this date only?', message: `${e.title}: ${fmtDT(e.start, tz)}. The other dates stay on the calendar.`, okLabel: 'Skip this date', destructive: true });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/events/${e.id}/cancel`, { date: e.instance_date }), 'Date skipped'));
  }, [dialog, attempt, after, tz]);

  const cancel = useCallback(async (e: EventInstance) => {
    const c = await dialog.confirm({
      title: e.recurrence ? 'Cancel the whole series?' : 'Cancel activity?',
      message: e.recurrence ? `All dates of "${e.title}" will be cancelled.` : `"${e.title}" will be cancelled.`,
      okLabel: e.recurrence ? 'Cancel series' : 'Cancel activity', cancelLabel: 'Keep it', destructive: true,
    });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/events/${e.id}/cancel`, {}), 'Cancelled'));
  }, [dialog, attempt, after]);

  return { acknowledge, decline, skip, cancel };
}
