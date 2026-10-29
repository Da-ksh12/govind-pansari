// Verifies a Standard Webhooks (standardwebhooks.com) signature — the scheme
// Supabase Auth uses to sign calls to an HTTPS hook such as the Send SMS hook.
//
//   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
//   signature      = base64( HMAC-SHA256( base64decode(secret), signed content ) )
//   header         = "webhook-signature: v1,<signature>[ v1,<signature2> ...]"
//
// Supabase shows the secret as "v1,whsec_<base64>"; only the <base64> part is
// the key. Several secrets may be configured at once, separated by "|", so a
// secret can be rotated without downtime.
import { base64ToBytes, bytesToBase64, hmacSha256, timingSafeEqual } from './crypto.ts';

const DEFAULT_TOLERANCE_SECONDS = 300;

/** Strips the "v1,whsec_" / "whsec_" prefix and decodes the key. Throws if the secret is not valid base64. */
export function parseHookSecret(secret: string): Uint8Array {
  const base64 = secret.trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  return base64ToBytes(base64);
}

export interface HeaderReader {
  get(name: string): string | null;
}

export interface VerifyOptions {
  /** One secret, or several separated by "|" (rotation). */
  secret: string;
  rawBody: string;
  headers: HeaderReader;
  /** Injected for tests; defaults to the current time. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export async function verifyStandardWebhook(options: VerifyOptions): Promise<boolean> {
  const id = options.headers.get('webhook-id');
  const timestamp = options.headers.get('webhook-timestamp');
  const signatureHeader = options.headers.get('webhook-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  // Rejects replays of an old (or far-future) delivery.
  if (Math.abs(now - timestampSeconds) > tolerance) return false;

  const provided = signatureHeader
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));
  if (provided.length === 0) return false;

  const signedContent = `${id}.${timestamp}.${options.rawBody}`;
  for (const candidate of options.secret.split('|').map((s) => s.trim()).filter(Boolean)) {
    let key: Uint8Array;
    try {
      key = parseHookSecret(candidate);
    } catch {
      continue; // a malformed secret can never match; try the next one
    }
    const expected = bytesToBase64(await hmacSha256(key, signedContent));
    if (provided.some((sig) => timingSafeEqual(expected, sig))) return true;
  }
  return false;
}
