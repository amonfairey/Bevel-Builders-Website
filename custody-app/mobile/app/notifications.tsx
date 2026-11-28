import { useCallback, useMemo, useState } from 'react';
import { AsyncView, Button, EmptyState, HeaderButton, Screen, useAttempt, useToast } from '@/components/ui';
import { NotificationList, NotificationRow } from '@/components/home/NotificationRow';
import { go } from '@/components/home/nav';
import { api, errorMessage } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { useApi, usePeople } from '@/lib/hooks';
import { linkToRoute, routes } from '@/lib/links';
import type { AppNotification, NotificationsReadResponse } from '@/lib/types';

const PAGE = 50;

/**
 * Notification inbox (web portal VIEWS.notifications): newest first, unread highlighted.
 * Tapping marks it read and opens its screen (lib/links.ts); "Mark all read" in the nav bar;
 * "Show older" pages back; pull to refresh.
 */
export default function NotificationsScreen() {
  const { tz } = usePeople();
  const badges = useBadges();
  const attempt = useAttempt();
  const toast = useToast();
  const q = useApi<AppNotification[]>(`/api/notifications?limit=${PAGE}`);
  const [older, setOlder] = useState<AppNotification[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  /** ids marked read on this screen (the list is not refetched for every tap) */
  const [readIds, setReadIds] = useState<Set<number>>(() => new Set());
  /** "Mark all read" covered every id up to this one */
  const [allReadUpTo, setAllReadUpTo] = useState(0);

  const items = useMemo(() => {
    const first = q.data ?? [];
    const seen = new Set(first.map((n) => n.id));
    return [...first, ...older.filter((n) => !seen.has(n.id))];
  }, [q.data, older]);
  const isRead = useCallback((n: AppNotification) => !!n.read_at || readIds.has(n.id) || n.id <= allReadUpTo, [readIds, allReadUpTo]);
  const unread = items.filter((n) => !isRead(n)).length;
  const hasMore = !olderDone && (q.data?.length ?? 0) === PAGE && (older.length === 0 || older.length % PAGE === 0);

  const onRefresh = useCallback(() => {
    setOlder([]);
    setOlderDone(false);
    void Promise.all([q.refresh(), badges.refresh()]);
  }, [q, badges]);

  const markAll = useCallback(async () => {
    const r = await attempt(() => api.post<NotificationsReadResponse>('/api/notifications/read', { all: true }), 'All caught up');
    if (r) {
      setAllReadUpTo(items.reduce((m, n) => Math.max(m, n.id), 0));
      void badges.refresh();
    }
  }, [attempt, items, badges]);

  const open = useCallback((n: AppNotification) => {
    if (!isRead(n)) {
      setReadIds((s) => new Set(s).add(n.id));
      api.post<NotificationsReadResponse>('/api/notifications/read', { ids: [n.id] })
        .then(() => badges.refresh())
        .catch(() => undefined); // still navigate; the badge catches up on the next refresh
    }
    const route = linkToRoute(n.link);
    if (route !== routes.notifications) go(route);
  }, [isRead, badges]);

  const loadOlder = useCallback(async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const more = await api.get<AppNotification[]>(`/api/notifications?limit=${PAGE}&before=${last.id}`);
      setOlder((o) => [...o, ...more]);
      if (more.length < PAGE) setOlderDone(true);
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'bad' });
    }
  }, [items, toast]);

  return (
    <Screen
      headerTitle="Notifications"
      headerRight={() => <HeaderButton title="Mark all read" onPress={markAll} disabled={unread === 0} testID="notif-mark-all" />}
      refreshing={q.refreshing}
      onRefresh={onRefresh}
      testID="notifications-screen"
    >
      <AsyncView state={q}>
        {() => items.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="No notifications yet"
            message="When your co-parent requests a change, sends a message or checks in at an exchange, it shows up here. Exchange reminders arrive a day and an hour before each hand-off."
          />
        ) : (
          <>
            <NotificationList>
              {items.map((n) => <NotificationRow key={n.id} n={n} read={isRead(n)} tz={tz} onPress={open} />)}
            </NotificationList>
            {hasMore ? <Button title="Show older" onPress={loadOlder} style={{ alignSelf: 'center', marginTop: 8 }} testID="notif-older" /> : null}
          </>
        )}
      </AsyncView>
    </Screen>
  );
}
