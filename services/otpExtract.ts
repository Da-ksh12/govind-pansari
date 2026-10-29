// Pulling the one-time code out of text — an incoming SMS, or whatever the user pastes into the OTP boxes. Pure, so tests/unit covers it.
// (Plain digit-run scanning, not a lookbehind regex, so it behaves the same on every JS engine.)

/** The first run of exactly `length` digits in `text` ("123456 is your OTP" → "123456"), or null. Longer digit runs (a 10-digit phone number) never count. */
export function extractOtp(text: string, length = 6): string | null {
  const runs = text.match(/[0-9]+/g);
  if (!runs) return null;
  return runs.find((run) => run.length === length) ?? null;
}

/**
 * What the OTP boxes should hold after the input changed to `raw`. Typing and the keyboard's "fill code" suggestion send plain digits;
 * a paste may bring the whole message ("Your OTP is 123456 …"), where the code — not every digit of the text — is wanted.
 */
export function sanitizeOtpInput(raw: string, length = 6): string {
  if (/[^0-9]/.test(raw)) {
    const code = extractOtp(raw, length);
    if (code) return code;
  }
  return raw.replace(/[^0-9]/g, '').slice(0, length);
}
