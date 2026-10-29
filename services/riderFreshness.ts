// How current a rider's position is, in words a customer or an admin can trust. Everything here is derived from the
// stored fix (server receive time + the device's reported accuracy): nothing is estimated or extrapolated.

/** Past this age the marker is dimmed and the screen says it is waiting for an update (spec: 60-120 s window). */
export const STALE_AFTER_SECONDS = 90;
/** A fix this imprecise is shown as "approximate" rather than as an exact spot. */
export const APPROXIMATE_ACCURACY_METERS = 100;

export interface LocationFreshness {
  ageSeconds: number;
  /** "Updated just now" / "Updated 12 s ago" / "Updated 3 min ago". */
  label: string;
  stale: boolean;
  /** Accuracy is poor enough that the position is only roughly right. */
  approximate: boolean;
  /** "±35 m" when the device reported an accuracy. */
  accuracyLabel: string | null;
}

export function ageSeconds(recordedAtIso: string, nowMs: number): number {
  const t = new Date(recordedAtIso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  // A timestamp slightly ahead of this phone's clock is clock skew, not "from the future".
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Updated a while ago';
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} h ago`;
}

export function describeFreshness(fix: { recordedAt: string; accuracy: number | null }, nowMs: number): LocationFreshness {
  const age = ageSeconds(fix.recordedAt, nowMs);
  const accuracy = fix.accuracy != null && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 ? Math.round(fix.accuracy) : null;
  return {
    ageSeconds: age,
    label: formatAge(age),
    stale: age > STALE_AFTER_SECONDS,
    approximate: accuracy != null && accuracy > APPROXIMATE_ACCURACY_METERS,
    accuracyLabel: accuracy != null ? `±${accuracy} m` : null,
  };
}
