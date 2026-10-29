// Getting the customer's EXACT spot, not "somewhere in the area".
//
// The first reading a phone returns is often a quick network/Wi-Fi fix that is good to hundreds of metres (or, when the
// customer chose "Approximate" in Android's location dialog, to about 2 km); the satellite fix that follows is good to ~10 m.
// Taking the first reading is what made the pin land on the area instead of the door. So the app keeps listening for a few
// seconds, keeps the BEST reading, stops as soon as one is precise enough, and says plainly how precise the result is.
// Pure functions so the rule is unit-tested (tests/unit/location-precision.test.mjs); locationService applies them.

/** A reading this precise (68% radius, metres) needs no further refinement. Blinkit/Zepto-style "exact spot" territory. */
export const GOOD_ENOUGH_METERS = 25;
/** How long to keep refining before settling for the best reading so far. */
export const REFINE_TIMEOUT_MS = 12_000;
/** A reading older than this is a cached position from earlier, not where the customer is now. */
export const MAX_READING_AGE_MS = 30_000;
/** Above this the position is worth a gentle "check the pin" nudge. */
export const CHECK_PIN_ABOVE_METERS = 50;
/** Above this the phone has only shared an approximate area (typical of "Approximate" permission or a network-only fix). */
export const APPROXIMATE_ABOVE_METERS = 500;

export interface Reading {
  lat: number;
  lng: number;
  /** Radius in metres the phone reports; null when it reports none. */
  accuracyMeters: number | null;
  /** The phone's own time for the reading, ms since epoch. */
  timestamp: number;
}

const rank = (r: Reading) => (r.accuracyMeters != null && Number.isFinite(r.accuracyMeters) && r.accuracyMeters >= 0 ? r.accuracyMeters : Number.POSITIVE_INFINITY);

export function isUsableReading(r: Reading, nowMs: number): boolean {
  return (
    Number.isFinite(r.lat) &&
    Number.isFinite(r.lng) &&
    Math.abs(r.lat) <= 90 &&
    Math.abs(r.lng) <= 180 &&
    !(r.lat === 0 && r.lng === 0) &&
    Number.isFinite(r.timestamp) &&
    nowMs - r.timestamp <= MAX_READING_AGE_MS
  );
}

/** Keeps whichever reading is more precise; a reading with no reported accuracy only wins over nothing. */
export function betterOf(best: Reading | null, candidate: Reading): Reading {
  if (!best) return candidate;
  return rank(candidate) < rank(best) ? candidate : best;
}

export function isPreciseEnough(r: Reading | null): boolean {
  return !!r && rank(r) <= GOOD_ENOUGH_METERS;
}

export type Precision = 'exact' | 'good' | 'check' | 'approximate' | 'unknown';

/** exact ≤ 25 m · good ≤ 50 m · check ≤ 500 m · approximate beyond that. */
export function classifyPrecision(accuracyMeters: number | null | undefined): Precision {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return 'unknown';
  if (accuracyMeters <= GOOD_ENOUGH_METERS) return 'exact';
  if (accuracyMeters <= CHECK_PIN_ABOVE_METERS) return 'good';
  if (accuracyMeters <= APPROXIMATE_ABOVE_METERS) return 'check';
  return 'approximate';
}

/** Map zoom to use after a GPS fix: closer when the fix is precise, wider when it is not (so the circle of doubt is visible). */
export function zoomForAccuracy(accuracyMeters: number | null | undefined): number {
  const p = classifyPrecision(accuracyMeters);
  if (p === 'exact' || p === 'good') return 17.5;
  if (p === 'check') return 16.5;
  return 15.5;
}

/**
 * One refinement session: feed it every reading the phone produces, in order. It ignores unusable (cached/invalid) readings,
 * remembers the most precise one, and says when to stop. The service stops listening on `done` or on its own timeout.
 */
export function createRefiner(now: () => number = Date.now) {
  let best: Reading | null = null;
  return {
    offer(reading: Reading): { improved: boolean; done: boolean; best: Reading | null } {
      if (!isUsableReading(reading, now())) return { improved: false, done: false, best };
      const next = betterOf(best, reading);
      const improved = next !== best;
      best = next;
      return { improved, done: isPreciseEnough(best), best };
    },
    best: () => best,
  };
}

/** Android 12+ lets the customer grant "Approximate" instead of "Precise": such a grant can never produce an exact spot. */
export function permissionIsApproximateOnly(android: { accuracy?: string } | undefined): boolean {
  return android?.accuracy === 'coarse';
}
