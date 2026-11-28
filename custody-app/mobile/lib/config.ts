import Constants from 'expo-constants';

type Extra = { apiUrl?: string; eas?: { projectId?: string } };
const extra: Extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function clean(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Base URL of the CoParent Hub server, without a trailing slash.
 * Set EXPO_PUBLIC_API_URL when starting Metro or in eas.json; app.json extra.apiUrl is the fallback.
 * On a phone, this must be a deployed https URL or your computer's LAN IP, never localhost.
 */
export const API_URL: string = clean(process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'http://localhost:3000');

/** EAS project id used for Expo push tokens. Empty until you run `eas init`. */
export const EAS_PROJECT_ID: string = extra.eas?.projectId || Constants.easConfig?.projectId || '';

/** Absolute URL for a server path such as '/api/files/<hash>' or a report link. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
