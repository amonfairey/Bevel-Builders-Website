import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useRootNavigationState } from 'expo-router';
import { api } from './api';
import { EAS_PROJECT_ID } from './config';
import { openLink } from './links';
import { getItem, KEYS, removeItem, setItem } from './storage';

/**
 * Push notifications (Expo push service -> APNs).
 *
 * - registerForPush(): physical devices only; asks permission, gets the Expo push token for
 *   extra.eas.projectId (run `eas init` to create one; without it this skips with one warning),
 *   and POSTs it to /api/push-tokens.
 * - usePushRouting(): routes notification taps (including the tap that cold-launched the app)
 *   through lib/links.ts and marks the notification read.
 * Everything here is a no-op on web.
 */

const isWeb = Platform.OS === 'web';
let handlerSet = false;
let warnedNoProject = false;

/** Show banners while the app is in the foreground. Safe to call more than once. */
export function configureNotificationHandler(): void {
  if (isWeb || handlerSet) return;
  handlerSet = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
  } catch (e) {
    console.warn('Could not set the notification handler', e);
  }
}

/** Register this device for push. Returns the Expo push token, or null when skipped. Never throws. */
export async function registerForPush(): Promise<string | null> {
  if (isWeb) return null;
  try {
    if (!Device.isDevice) return null; // simulators cannot receive remote pushes
    if (!EAS_PROJECT_ID) {
      if (!warnedNoProject) {
        warnedNoProject = true;
        console.warn('Push notifications are off: app.json extra.eas.projectId is empty. Run `eas init` (see mobile/README.md).');
      }
      return null;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    }
    if (!perm.granted) return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    await api.post('/api/push-tokens', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await setItem(KEYS.pushToken, token);
    return token;
  } catch (e) {
    console.warn('Push registration failed', e);
    return null;
  }
}

/** Remove this device's push token from the server (call while still signed in). Never throws. */
export async function unregisterPush(): Promise<void> {
  const token = await getItem(KEYS.pushToken);
  if (!token) return;
  try {
    await api.post('/api/push-tokens/remove', { token });
  } catch {
    // best effort: the server also drops tokens that Apple reports as unregistered
  }
  await removeItem(KEYS.pushToken);
}

/** Set the app icon badge (native only). */
export async function setAppBadge(count: number): Promise<void> {
  if (isWeb) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // not supported / no permission
  }
}

function linkOf(response: Notifications.NotificationResponse): { link: string | null; id: number | null } {
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const link = typeof data.link === 'string' ? data.link : null;
  const id = Number(data.notification_id);
  return { link, id: Number.isFinite(id) && id > 0 ? id : null };
}

/**
 * Route notification taps once the app is signed in and the navigator is mounted.
 * `onOpened` runs after routing (e.g. to refresh badges).
 */
export function usePushRouting(enabled: boolean, onOpened?: () => void): void {
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(new Set<string>());
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  useEffect(() => {
    if (isWeb || !enabled || !navReady) return;
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      const { link, id } = linkOf(response);
      if (id) api.post('/api/notifications/read', { ids: [id] }).catch(() => undefined);
      // Let the navigator settle (cold start) before pushing a screen.
      setTimeout(() => {
        try { openLink(link); } catch (e) { console.warn('Could not open notification link', e); }
        onOpenedRef.current?.();
      }, 0);
    };
    // The tap that launched the app from a killed state.
    try {
      handle(Notifications.getLastNotificationResponse());
      Notifications.clearLastNotificationResponse();
    } catch {
      // older native module without the sync API
      Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [enabled, navReady]);
}

/** Run `fn` whenever a notification arrives while the app is open (e.g. refresh badges). */
export function useNotificationReceived(enabled: boolean, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (isWeb || !enabled) return;
    const sub = Notifications.addNotificationReceivedListener(() => ref.current());
    return () => sub.remove();
  }, [enabled]);
}
