import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { setAppBadge, useNotificationReceived } from './push';
import { useSession } from './session';
import type { Dashboard, PendingCounts } from './types';

/**
 * Counts shown as badges: Home tab (decisions waiting on me), Messages tab (unread messages),
 * More tab / Notifications row (unread notifications) and the app icon (unread notifications).
 *
 * Refreshes when the app becomes active, every 60 s while active, when a push arrives in the
 * foreground, and whenever a screen calls `useBadges().refresh()` (call it after approving,
 * reading a thread, or marking notifications read).
 */
export interface Badges {
  pending: PendingCounts | null;
  /** sum of pending decisions excluding messages (Home tab badge) */
  decisions: number;
  unreadMessages: number;
  unreadNotifications: number;
  refresh: () => Promise<void>;
}

const BadgesContext = createContext<Badges | null>(null);

export function totalDecisions(p: PendingCounts | null | undefined): number {
  if (!p) return 0;
  return Object.entries(p).filter(([k]) => k !== 'messages').reduce((s, [, n]) => s + (Number(n) || 0), 0);
}

export function BadgesProvider({ children }: { children: ReactNode }) {
  const { status, me, refreshMe } = useSession();
  const ready = status === 'ready';
  const [pending, setPending] = useState<PendingCounts | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!ready || busy.current) return;
    busy.current = true;
    try {
      const [d] = await Promise.all([api.get<Dashboard>('/api/dashboard'), refreshMe().catch(() => null)]);
      setPending(d.pending);
    } catch {
      // badges are best effort
    } finally {
      busy.current = false;
    }
  }, [ready, refreshMe]);

  useEffect(() => {
    if (!ready) { setPending(null); return; }
    void refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => { void refresh(); }, 60000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refresh();
        if (!timer) timer = setInterval(() => { void refresh(); }, 60000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => { sub.remove(); if (timer) clearInterval(timer); };
  }, [ready, refresh]);

  useNotificationReceived(ready, () => { void refresh(); });

  const unreadNotifications = me && 'unread_notifications' in me && typeof me.unread_notifications === 'number' ? me.unread_notifications : 0;
  useEffect(() => { void setAppBadge(ready ? unreadNotifications : 0); }, [ready, unreadNotifications]);

  const value = useMemo<Badges>(() => ({
    pending,
    decisions: totalDecisions(pending),
    unreadMessages: pending?.messages ?? 0,
    unreadNotifications,
    refresh,
  }), [pending, unreadNotifications, refresh]);
  return <BadgesContext.Provider value={value}>{children}</BadgesContext.Provider>;
}

export function useBadges(): Badges {
  const v = useContext(BadgesContext);
  if (!v) throw new Error('useBadges must be used inside <BadgesProvider>');
  return v;
}
