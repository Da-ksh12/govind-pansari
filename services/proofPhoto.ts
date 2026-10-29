// Rules for the rider's delivery-proof photo, kept free of React Native / native imports so tests/unit covers them.
//
// Why the photo is shrunk: a phone camera hands over its full-size shot (12–50+ megapixels). Asking expo-image-picker to compress it
// (any quality below 1) or to return base64 makes the phone decode the whole photo into memory and encode it again, twice more for
// base64 — enough to kill the app on a low-memory phone. So the picker is asked for the untouched file and the photo is shrunk once,
// to a size that is still plenty to show a parcel at a door.
//
// Why a marker: Android may kill the app while the camera is in front. The picked photo is then only retrievable with
// ImagePicker.getPendingResultAsync() after the app restarts, and the restarted app starts on the splash screen, not on the delivery.
// The marker records "a proof photo for delivery X was being taken" so the app can go back there and ask for that result.

/** Longest edge of the uploaded proof photo, in pixels. */
export const PROOF_MAX_EDGE = 1280;
export const PROOF_JPEG_QUALITY = 0.75;
/** The delivery-proofs bucket refuses anything larger (supabase migration 20260826000104). */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** The resize that brings the longest edge down to PROOF_MAX_EDGE, or null when the photo is already small enough (never enlarges). */
export function proofResize(width: number, height: number): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.max(width, height) <= PROOF_MAX_EDGE) return null;
  return width >= height ? { width: PROOF_MAX_EDGE } : { height: PROOF_MAX_EDGE };
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export const PENDING_PROOF_KEY = 'gp-pending-proof-capture';
/** A marker older than this is forgotten: the rider has long since moved on, and a late jump back to the delivery would be a surprise. */
export const PENDING_PROOF_MAX_AGE_MS = 30 * 60_000;

export interface PendingProofCapture {
  assignmentId: string;
  startedAt: number;
}

export function serializePendingProof(assignmentId: string, now: number): string {
  const marker: PendingProofCapture = { assignmentId, startedAt: now };
  return JSON.stringify(marker);
}

/** The stored marker if it is well-formed and recent; null for anything else (missing, garbled, stale, from the future). */
export function parsePendingProof(raw: string | null | undefined, now: number): PendingProofCapture | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { assignmentId, startedAt } = value as Record<string, unknown>;
  if (typeof assignmentId !== 'string' || assignmentId.length === 0) return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  const age = now - startedAt;
  if (age < 0 || age > PENDING_PROOF_MAX_AGE_MS) return null;
  return { assignmentId, startedAt };
}
