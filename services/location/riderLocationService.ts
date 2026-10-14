import * as Location from 'expo-location';
import { riderOpsRepository } from '../repositories/riderOpsRepository';

export type LocationPermissionState = 'granted' | 'denied' | 'denied_permanently' | 'location_disabled' | 'unknown';

let watchSubscription: Location.LocationSubscription | null = null;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5; // section 47: drop stale pings rather than an unbounded retry queue

/**
 * Foreground GPS capture for an active delivery (section 4/37): a
 * balanced-accuracy watch at ~4s / 15m thresholds, submitted through
 * submit_rider_location() — never a direct table write (section 8).
 * Tracking is explicitly tied to having the delivery screen open,
 * which is when a rider realistically needs it on-screen anyway;
 * background location (continuing while the app is backgrounded) is
 * documented as a follow-up in docs/rider-location.md rather than
 * implemented here — it needs expo-task-manager, additional iOS/
 * Android background-mode permissions with their own store-review
 * justification requirements, and real-device testing this
 * environment cannot perform.
 */
export const riderLocationService = {
  async requestPermission(): Promise<LocationPermissionState> {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return 'location_disabled';

    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    return canAskAgain ? 'denied' : 'denied_permanently';
  },

  isTracking(): boolean {
    return watchSubscription !== null;
  },

  async start(onError?: (message: string) => void): Promise<boolean> {
    if (watchSubscription) return true;

    const permission = await riderLocationService.requestPermission();
    if (permission !== 'granted') {
      onError?.(
        permission === 'location_disabled'
          ? 'Location services are turned off on this device.'
          : 'Location permission is required to start a delivery.',
      );
      return false;
    }

    consecutiveFailures = 0;
    try {
      watchSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 15 },
        async (loc) => {
          try {
            await riderOpsRepository.submitLocation({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? undefined,
              heading: loc.coords.heading ?? undefined,
              speed: loc.coords.speed ?? undefined,
              altitude: loc.coords.altitude ?? undefined,
            });
            consecutiveFailures = 0;
          } catch {
            // A single failed ping must never crash delivery flow — drop
            // it and keep watching. If the backend is genuinely down,
            // stop trying after a few in a row rather than hammering it
            // silently for the rest of the delivery.
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              onError?.('Location updates are failing — check your connection.');
            }
          }
        },
      );
    } catch {
      // The native GPS call itself can fail (hardware issue, OEM
      // location-service quirk) — never let that reject uncaught mid-
      // delivery; surface it the same way a permission denial is.
      onError?.("Couldn't start location sharing on this device.");
      return false;
    }
    return true;
  },

  stop() {
    watchSubscription?.remove();
    watchSubscription = null;
  },
};
