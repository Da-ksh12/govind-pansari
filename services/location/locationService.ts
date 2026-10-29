import * as Location from 'expo-location';
import type { LatLng } from '../../types/models';
import { describeLocationFailure } from '../serviceability';
import { REFINE_TIMEOUT_MS, createRefiner, permissionIsApproximateOnly, type Reading } from './fixRefinement';

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

/** One position with how precise it is, and whether the permission the customer gave can ever be precise. */
export interface LocationFix extends LatLng {
  /** Radius in metres the phone reports (68% confidence); null when it reports none. */
  accuracyMeters: number | null;
  /** False when Android was only allowed "Approximate" location: such a fix is the area, never the door. */
  precise: boolean;
}

export interface FixOptions {
  /** Called each time a more precise reading arrives, so the map can move to it while the phone is still refining. */
  onProgress?: (fix: LocationFix) => void;
  timeoutMs?: number;
}

/** The customer-facing sentence for a failed position request (see describeLocationFailure). */
export function describeLocationError(e: unknown): string {
  return describeLocationFailure(e instanceof LocationError ? e.code : 'UNAVAILABLE');
}

function toPermissionState(status: Location.PermissionStatus, canAskAgain: boolean): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return canAskAgain ? 'denied' : 'denied_permanently';
  return 'not_requested';
}

const toReading = (loc: Location.LocationObject): Reading => ({
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  accuracyMeters: loc.coords.accuracy ?? null,
  timestamp: loc.timestamp,
});

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

  /**
   * The customer's position, as exact as the phone can make it — a one-shot read, never continuous tracking (that's the
   * rider phase). It listens for up to 12 s, keeps the most precise reading, and stops the moment one is good to ~25 m
   * (see fixRefinement.ts), because the first reading a phone returns is often only good to hundreds of metres. It never
   * falls back to a last-known or default position: when there is no reading the caller gets a LocationError and must
   * offer the map instead. `precise` is false when Android granted only "Approximate" location.
   */
  async getCurrentFix(options: FixOptions = {}): Promise<LocationFix> {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      throw new LocationError('GPS_DISABLED', 'Turn on location services to use your current location.');
    }

    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      throw new LocationError('PERMISSION_DENIED', 'Location permission is required.');
    }
    if (permissionIsApproximateOnly(permission.android) && permission.canAskAgain) {
      // Android lets the app ask once more for "Precise"; if the customer says no, we carry on with what we were given.
      permission = await Location.requestForegroundPermissionsAsync().catch(() => permission);
    }
    const precise = !permissionIsApproximateOnly(permission.android);
    const toFix = (r: Reading): LocationFix => ({ lat: r.lat, lng: r.lng, accuracyMeters: r.accuracyMeters, precise });

    return new Promise<LocationFix>((resolve, reject) => {
      const refiner = createRefiner();
      let subscription: Location.LocationSubscription | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const stop = () => {
        settled = true;
        if (timer) clearTimeout(timer);
        subscription?.remove();
        subscription = null;
      };
      const finish = () => {
        if (settled) return;
        stop();
        const best = refiner.best();
        if (best) resolve(toFix(best));
        else reject(new LocationError('TIMEOUT', "We couldn't get a GPS fix in time."));
      };
      const fail = (error: LocationError) => {
        if (settled) return;
        stop();
        reject(error);
      };

      timer = setTimeout(finish, options.timeoutMs ?? REFINE_TIMEOUT_MS);

      Location.watchPositionAsync(
        // Highest asks the phone for the satellite fix; mayShowUserSettingsDialog lets Android offer to turn on
        // "improved accuracy" (Wi-Fi + cell + GPS) if the customer has it off.
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0, mayShowUserSettingsDialog: true },
        (loc) => {
          if (settled) return;
          // A cached position from earlier is not "here": the refiner drops it, keeps the most precise reading, says when to stop.
          const { improved, done, best } = refiner.offer(toReading(loc));
          if (improved && best) options.onProgress?.(toFix(best));
          if (done) finish();
        },
      )
        .then((sub) => {
          if (settled) sub.remove();
          else subscription = sub;
        })
        .catch(() => fail(new LocationError('UNAVAILABLE', "We couldn't get your location.")));
    });
  },

  /** Coordinates only; see getCurrentFix for accuracy. */
  async getCurrentPosition(): Promise<LatLng> {
    const { lat, lng } = await this.getCurrentFix();
    return { lat, lng };
  },
};
