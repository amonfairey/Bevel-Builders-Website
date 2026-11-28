import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Persistence for small secrets (the session token, the registered push token).
 * Native: iOS Keychain / Android Keystore via expo-secure-store.
 * Web preview: localStorage (development only; fine for a preview, not for production secrets).
 * Every call is wrapped so storage failures never crash the app.
 */

const isWeb = Platform.OS === 'web';

function webStore(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  try {
    if (isWeb) return webStore()?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn('storage.getItem failed', e);
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (isWeb) { webStore()?.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  } catch (e) {
    console.warn('storage.setItem failed', e);
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (isWeb) { webStore()?.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    console.warn('storage.removeItem failed', e);
  }
}

/** Storage keys used by the app. */
export const KEYS = {
  session: 'coparent.session',
  pushToken: 'coparent.pushToken',
} as const;
