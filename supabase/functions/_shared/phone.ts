// Indian mobile-number handling for the SMS hook. Fast2SMS delivers to Indian
// numbers only, and Supabase Auth hands the hook the number in whichever shape
// it stores it (digits with the country code, with or without a leading "+").

/** Returns the 10-digit national number, or null when the input is not a valid Indian mobile number. */
export function normalizeIndianMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** "+91XXXXXX1234" — enough to recognise a number in logs without storing it. */
export function maskIndianMobile(tenDigits: string): string {
  return `+91XXXXXX${tenDigits.slice(-4)}`;
}
