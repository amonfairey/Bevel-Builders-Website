import { Platform } from 'react-native';
import * as Location from 'expo-location';

/** A GPS fix to attach to an exchange check-in (accuracy in metres). */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type GeoResult =
  | { ok: true; fix: GeoFix }
  /** `openSettings`: the fix is in the iPhone's Settings app (permission denied for good, services off) */
  | { ok: false; message: string; openSettings: boolean };

const TIMEOUT_MS = 20000;

/**
 * Ask for "while using the app" location permission (only now, when the parent tapped
 * "Attach my location") and get one fix. Never asks for background location.
 */
export async function getMyLocation(): Promise<GeoResult> {
  const native = Platform.OS !== 'web';
  try {
    if (native && !(await Location.hasServicesEnabledAsync())) {
      return { ok: false, openSettings: true, message: 'Location Services are turned off on this iPhone. Turn them on in Settings → Privacy & Security → Location Services, or check in without a location.' };
    }
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return {
        ok: false,
        openSettings: native && !perm.canAskAgain,
        message: native
          ? 'CoParent Hub is not allowed to use your location. To attach it, allow location "While Using the App" for CoParent Hub in Settings. You can still check in without it.'
          : 'This browser is not allowed to share your location. You can still check in without it.',
      };
    }
  } catch {
    return { ok: false, openSettings: false, message: 'Location is not available on this device. You can still check in without it.' };
  }

  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return { ok: true, fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null } };
  } catch (e) {
    const timedOut = e instanceof Error && e.message === 'timeout';
    return {
      ok: false,
      openSettings: false,
      message: timedOut
        ? 'Could not get a location fix in time. Move near a window or outside and try again, or check in without it.'
        : 'Could not get your location. Try again, or check in without it.',
    };
  }
}

/** Link that opens a point in Apple Maps on iPhone (OpenStreetMap elsewhere, like the web portal). */
export function mapsUrl(lat: number, lng: number): string {
  if (Platform.OS === 'ios') return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent('Exchange check-in')}`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** '±12 m' */
export const fmtAccuracy = (m: number | null | undefined): string => (m == null ? '' : `±${Math.round(m)} m`);
