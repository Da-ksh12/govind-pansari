// Small HMAC / comparison helpers shared by the Razorpay and SMS-hook Edge
// Functions. Pure WebCrypto, so they behave identically under Deno (the
// functions) and Node (tests/unit).

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  // (cast: newer TypeScript libs distinguish ArrayBuffer- from SharedArrayBuffer-backed arrays; these are always the former)
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmacSha256(encoder.encode(secret), message));
}

/** Constant-time string comparison (equal-length inputs are compared in full; different lengths are simply unequal). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
