// Which GPS readings the rider app is allowed to send. The rule is simple and strict: send only a REAL, RECENT,
// REASONABLY PRECISE reading from the phone's own GPS — never a cached one, never a repeat of an old one, never a guess.
// Pure functions so the rule is unit-tested (tests/unit/rider-location.test.mjs); riderLocationService applies them.

/** A reading older than this when it reaches us is a cached/delayed fix, not where the rider is now. */
export const MAX_FIX_AGE_MS = 20_000;
/** Beyond this the position could be a whole street away; it is not sent (the customer then sees an honest "updating"). */
export const MAX_ACCEPTABLE_ACCURACY_M = 150;
/** Never send faster than this, whatever the OS delivers: protects battery, data and the Realtime fan-out. */
export const MIN_SEND_INTERVAL_MS = 5_000;
/** A rider who has not moved still proves they are online: a fresh reading is requested if nothing was sent for this long. */
export const HEARTBEAT_AFTER_MS = 30_000;

export interface RawFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** The device's own time for the reading (ms since epoch), as reported by the location provider. */
  timestamp: number;
}

export type FixDecision = { send: true } | { send: false; reason: 'invalid' | 'stale' | 'inaccurate' | 'too_soon' };

export function isValidPosition(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function decideFix(fix: RawFix, nowMs: number, lastSentAtMs: number | null): FixDecision {
  if (!isValidPosition(fix.latitude, fix.longitude)) return { send: false, reason: 'invalid' };
  if (!Number.isFinite(fix.timestamp) || nowMs - fix.timestamp > MAX_FIX_AGE_MS) return { send: false, reason: 'stale' };
  if (fix.accuracy != null && (!Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > MAX_ACCEPTABLE_ACCURACY_M)) {
    return { send: false, reason: 'inaccurate' };
  }
  if (lastSentAtMs != null && nowMs - lastSentAtMs < MIN_SEND_INTERVAL_MS) return { send: false, reason: 'too_soon' };
  return { send: true };
}

/** True when nothing has been sent for long enough that a fresh reading should be requested even though the rider has not moved. */
export function heartbeatDue(nowMs: number, lastSentAtMs: number | null): boolean {
  return lastSentAtMs == null || nowMs - lastSentAtMs >= HEARTBEAT_AFTER_MS;
}
