/**
 * Web preview build of lib/push.ts (Metro picks this file for `--platform web`).
 *
 * Push, the app icon badge and notification taps don't exist in the browser, so everything
 * here is a no-op. It deliberately does not import expo-notifications: importing it on web
 * registers a module-level push-token-change listener, which logs
 * "[expo-notifications] Listening to push token changes is not yet fully supported on web".
 */

export function configureNotificationHandler(): void {}

export async function registerForPush(): Promise<string | null> {
  return null;
}

export async function unregisterPush(): Promise<void> {}

export async function setAppBadge(_count: number): Promise<void> {}

export function usePushRouting(_enabled: boolean, _onOpened?: () => void): void {}

export function useNotificationReceived(_enabled: boolean, _fn: () => void): void {}

// Compile-time check that this file exports exactly what lib/push.ts exports.
const _sameApi: typeof import('./push') = {
  configureNotificationHandler, registerForPush, unregisterPush, setAppBadge, usePushRouting, useNotificationReceived,
};
void _sameApi;
