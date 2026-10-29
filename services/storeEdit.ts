// Editing a store's details from the admin panel: what is accepted, and which fields actually changed. Pure, so tests/unit covers it.
//
// Opening hours are `time` columns and the "is the store open" rule is `now between opening and closing` (IST), which cannot wrap past
// midnight — so closing must be later than opening. A store that never closes is 00:00 – 23:59.

export interface StoreFormInput {
  name: string;
  phone: string;
  addressLine: string;
  city: string;
  opening: string;
  closing: string;
}

/** The stored row, as the database returns it (times are 'HH:MM:SS'). */
export interface StoreCurrent {
  name: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  opening_time: string | null;
  closing_time: string | null;
}

export type StoreFormErrors = Partial<Record<keyof StoreFormInput, string>>;

/** Only the columns that changed, ready for an UPDATE. */
export type StorePatch = Partial<Pick<StoreCurrent, 'name' | 'phone' | 'address_line' | 'city' | 'opening_time' | 'closing_time'>>;

/**
 * "9", "9:30", "09:30", "21:00", "9 am", "9:30 PM", "9.30pm" → 'HH:MM' (24-hour). Null when it is not a time.
 * A bare number is an hour in 24-hour time. 12 am is midnight, 12 pm is noon.
 */
export function parseClockTime(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*([ap])?\.?(?:m\.?)?\s*$/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 'HH:MM' or 'HH:MM:SS' → "9:00 AM". Empty string for anything else. */
export function clockLabel(time: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(time ?? '');
  if (!m) return '';
  const hour = Number(m[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m[2]} ${suffix}`;
}

/** An Indian mobile number in the format the stores already use: "+91 90000 00103". Null if it is not a 10-digit mobile. */
export function normalizeIndianMobile(text: string): string | null {
  let digits = text.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');
const hhmm = (time: string | null) => (time ?? '').slice(0, 5);

export function validateStoreForm(input: StoreFormInput, current: StoreCurrent): { errors: StoreFormErrors; patch: StorePatch } {
  const errors: StoreFormErrors = {};
  const patch: StorePatch = {};

  const name = collapse(input.name);
  if (name.length < 2 || name.length > 80) errors.name = 'Enter the store name (2 to 80 characters).';
  else if (name !== current.name) patch.name = name;

  const phone = normalizeIndianMobile(input.phone);
  if (!phone) errors.phone = 'Enter a 10-digit mobile number, e.g. 98765 43210.';
  else if (phone !== current.phone) patch.phone = phone;

  const address = collapse(input.addressLine);
  if (address.length < 3 || address.length > 120) errors.addressLine = 'Enter the address (3 to 120 characters).';
  else if (address !== current.address_line) patch.address_line = address;

  const city = collapse(input.city);
  if (city.length < 2 || city.length > 40) errors.city = 'Enter the city.';
  else if (city !== current.city) patch.city = city;

  const opening = parseClockTime(input.opening);
  const closing = parseClockTime(input.closing);
  if (!opening) errors.opening = 'Enter a time like 9:00 AM or 09:00.';
  if (!closing) errors.closing = 'Enter a time like 9:00 PM or 21:00.';
  if (opening && closing) {
    if (closing <= opening) errors.closing = 'Closing time must be later than opening time (a store cannot stay open past midnight; use 11:59 PM for "all night").';
    else {
      if (opening !== hhmm(current.opening_time)) patch.opening_time = `${opening}:00`;
      if (closing !== hhmm(current.closing_time)) patch.closing_time = `${closing}:00`;
    }
  }
  return { errors, patch };
}
