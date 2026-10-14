import * as Location from 'expo-location';
import type { LatLng } from '../../types/models';

export type LocationPermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'denied_permanently'
  | 'unavailable';

export type LocationErrorCode = 'PERMISSION_DENIED' | 'GPS_DISABLED' | 'TIMEOUT' | 'UNAVAILABLE';

export class LocationError extends Error {
  readonly code: LocationErrorCode;
  constructor(code: LocationErrorCode, message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

const POSITION_TIMEOUT_MS = 12000;

function toPermissionState(status: Location.PermissionStatus, canAskAgain: boolean): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return canAskAgain ? 'denied' : 'denied_permanently';
  return 'not_requested';
}

export const locationService = {
  async getPermissionState(): Promise<LocationPermissionState> {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    return toPermissionState(status, canAskAgain);
  },

  /** Only prompts if not already permanently denied — never re-prompt after that (section 16). */
  async requestPermission(): Promise<LocationPermissionState> {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.DENIED && !current.canAskAgain) {
      return 'denied_permanently';
    }
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    return toPermissionState(status, canAskAgain);
  },

  /** Coordinates only — a one-shot read, never continuous tracking (that's the rider phase). */
  async getCurrentPosition(): Promise<LatLng> {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      throw new LocationError('GPS_DISABLED', 'Turn on location services to use your current location.');
    }

    const permission = await this.getPermissionState();
    if (permission !== 'granted') {
      throw new LocationError('PERMISSION_DENIED', 'Location permission is required.');
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LocationError('TIMEOUT', "This is taking longer than expected.")), POSITION_TIMEOUT_MS),
    );

    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        timeout,
      ]);
      return { lat: position.coords.latitude, lng: position.coords.longitude };
    } catch (e) {
      if (e instanceof LocationError) throw e;
      throw new LocationError('UNAVAILABLE', "We couldn't get your location.");
    }
  },
};
