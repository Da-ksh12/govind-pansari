/**
 * Centralized phone formatting/validation — the one place that knows
 * about the +91 country code, so it's never hardcoded elsewhere.
 */

const INDIA_CALLING_CODE = '+91';

/** Strips everything but digits. */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** True for a plausible 10-digit Indian mobile number (starts 6-9), independent of formatting. */
export function isValidIndianMobile(raw: string): boolean {
  const digits = digitsOnly(raw).replace(/^91/, '');
  return /^[6-9]\d{9}$/.test(digits);
}

/** Normalizes to E.164 (+91XXXXXXXXXX) — the one format ever sent to Supabase Auth. Never store multiple formats for the same number. */
export function toE164(raw: string): string {
  const digits = digitsOnly(raw).replace(/^91/, '');
  return `${INDIA_CALLING_CODE}${digits}`;
}

/** Display formatting: "+91 98765 43210". */
export function formatPhoneDisplay(raw: string): string {
  const digits = digitsOnly(raw).replace(/^91/, '');
  if (digits.length !== 10) return raw;
  return `${INDIA_CALLING_CODE} ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
