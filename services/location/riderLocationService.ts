import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { riderOpsRepository } from '../repositories/riderOpsRepository';
import { decideFix, heartbeatDue, type FixDecision } from './riderFixPolicy';

export type LocationPermissionState = 'granted' | 'denied' | 'denied_permanently' | 'location_disabled' | 'unknown';

export interface RiderLocationStatus {
  tracking: boolean;
  /** When the last reading was accepted by the server (ms since epoch), or null if none yet this session. */
  lastSentAt: number | null;
  /** Accuracy in metres of the last reading sent. */
  lastAccuracy: number | null;
  /** Last reading the phone produced but the policy refused (too old / too imprecise), so the rider can be told why customers see no update. */
  lastRejected: Extract<FixDecision, { send: false }>['reason'] | null;
}

const MAX_CONSECUTIVE_FAILURES = 5; // drop pings rather than keep an unbounded retry queue
const HEARTBEAT_CHECK_MS = 10_000;

let watchSubscription: Location.LocationSubscription | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let wanted = false; // the delivery screen asked for tracking and has not stopped it
let onErrorCallback: ((message: string) => void) | undefined;
let consecutiveFailures = 0;
let sending = false;
let heartbeatBusy = false;

let status: RiderLocationStatus = { tracking: false, lastSentAt: null, lastAccuracy: null, lastRejected: null };
const listeners = new Set<(s: RiderLocationStatus) => void>();

function setStatus(patch: Partial<RiderLocationStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l(status);
}

/**
 * Handles one reading from the phone's GPS. Only a real, recent, reasonably precise reading is sent (see
 * riderFixPolicy.ts); sends go through submit_rider_location() — never a direct table write — and a failed send is
 * dropped, not queued, so an old position can never arrive later dressed up as current.
 */
async function handleFix(loc: Location.LocationObject) {
  const now = Date.now();
  const decision = decideFix(
    { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null, timestamp: loc.timestamp },
    now,
    status.lastSentAt,
  );
  if (!decision.send) {
    // 'too_soon' is the throttle doing its job, not a problem worth reporting.
    if (decision.reason !== 'too_soon') setStatus({ lastRejected: decision.reason });
    return;
  }
  if (sending) return;
  sending = true;
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
    setStatus({ lastSentAt: Date.now(), lastAccuracy: loc.coords.accuracy ?? null, lastRejected: null });
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      onErrorCallback?.('Location updates are failing — check your connection.');
      consecutiveFailures = 0;
    }
  } finally {
    sending = false;
  }
}

async function startWatch(): Promise<boolean> {
  try {
    watchSubscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 15 },
      (loc) => {
        void handleFix(loc);
      },
    );
    return true;
  } catch {
    // The native GPS call itself can fail (hardware issue, OEM location-service quirk) — never let that reject uncaught mid-delivery.
    return false;
  }
}

function stopWatch() {
  watchSubscription?.remove();
  watchSubscription = null;
}

/** A rider who is stopped at a junction produces no movement events; ask the GPS for a genuinely fresh reading instead of going silent. */
async function heartbeat() {
  if (!wanted || !watchSubscription || heartbeatBusy) return;
  if (!heartbeatDue(Date.now(), status.lastSentAt)) return;
  heartbeatBusy = true; // a slow GPS fix must not stack up one pending request per tick
  try {
    const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await handleFix(fresh);
  } catch {
    // No fix right now (tunnel, GPS off): the customer sees the honest "updating" state; nothing is invented.
  } finally {
    heartbeatBusy = false;
  }
}

/**
 * Foreground GPS sharing for an active delivery. This is deliberately FOREGROUND-ONLY: Android stops delivering
 * readings to an app that is in the background unless it runs a foreground service with background-location
 * permission, which needs its own Play Store declaration and real-device testing. Until that exists the rider app
 * says so ("keep the app open"), customers see a "last updated" time, and sharing resumes by itself the moment the
 * app is brought back to the front.
 */
export const riderLocationService = {
  async requestPermission(): Promise<LocationPermissionState> {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return 'location_disabled';

    const { status: permission, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (permission === 'granted') return 'granted';
    return canAskAgain ? 'denied' : 'denied_permanently';
  },

  isTracking(): boolean {
    return watchSubscription !== null;
  },

  getStatus(): RiderLocationStatus {
    return status;
  },

  subscribeStatus(listener: (s: RiderLocationStatus) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async start(onError?: (message: string) => void): Promise<boolean> {
    onErrorCallback = onError;
    wanted = true;
    if (watchSubscription) return true;

    const permission = await riderLocationService.requestPermission();
    if (permission !== 'granted') {
      wanted = false;
      onError?.(
        permission === 'location_disabled'
          ? 'Location services are turned off on this device.'
          : permission === 'denied_permanently'
            ? 'Location permission is blocked. Enable it for this app in your phone settings to start a delivery.'
            : 'Location permission is required to start a delivery.',
      );
      return false;
    }

    consecutiveFailures = 0;
    if (!(await startWatch())) {
      wanted = false;
      onError?.("Couldn't start location sharing on this device.");
      return false;
    }
    setStatus({ tracking: true });

    heartbeatTimer ??= setInterval(() => void heartbeat(), HEARTBEAT_CHECK_MS);
    appStateSubscription ??= AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || !wanted) return;
      // Back in the foreground: the OS may have paused the watch. Re-create it and take a fresh reading right away.
      stopWatch();
      if (await startWatch()) {
        setStatus({ tracking: true });
        void heartbeat();
      } else {
        setStatus({ tracking: false });
      }
    });
    void heartbeat();
    return true;
  },

  stop() {
    wanted = false;
    stopWatch();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    appStateSubscription?.remove();
    appStateSubscription = null;
    onErrorCallback = undefined;
    setStatus({ tracking: false, lastSentAt: null, lastAccuracy: null, lastRejected: null });
  },
};
