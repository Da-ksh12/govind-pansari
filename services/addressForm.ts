// The Add Address form as pure logic: which fields exist, how a map/geocoder result fills them WITHOUT overwriting what
// the customer typed, how the legacy address_line_1/2 are composed from the parts, and what is valid.
// (tests/unit/address-form.test.mjs)

export interface AddressFields {
  receiverName: string;
  receiverPhone: string;
  /** House / flat / shop number. Always typed by the customer — a geocoder never fills it in. */
  houseNo: string;
  building: string;
  floor: string;
  street: string;
  /** Neighbourhood / colony / area. */
  locality: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  instructions: string;
}

export type AddressFieldKey = keyof AddressFields;

export const EMPTY_FIELDS: AddressFields = {
  receiverName: '',
  receiverPhone: '',
  houseNo: '',
  building: '',
  floor: '',
  street: '',
  locality: '',
  landmark: '',
  city: '',
  state: '',
  pincode: '',
  instructions: '',
};

/** What a map pick / search result / reverse geocode can say about the address. A missing value stays missing. */
export interface GeoParts {
  street?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/** The fields a geocoder is allowed to fill. Everything else is the customer's own. */
const GEO_FIELDS = ['street', 'locality', 'city', 'state', 'pincode'] as const;

/**
 * Fills the geocoder-owned fields from a new pin position, leaving every field the customer has TOUCHED exactly as typed.
 * An untouched field takes the new value — or is cleared when the new place has none, because a street left over from
 * the previous pin would now be wrong.
 */
export function applyGeoParts(fields: AddressFields, touched: ReadonlySet<AddressFieldKey>, geo: GeoParts): AddressFields {
  const next = { ...fields };
  const incoming: Record<(typeof GEO_FIELDS)[number], string> = {
    street: (geo.street ?? '').trim(),
    locality: (geo.locality ?? '').trim(),
    city: (geo.city ?? '').trim(),
    state: (geo.state ?? '').trim(),
    pincode: (geo.postalCode ?? '').trim(),
  };
  for (const key of GEO_FIELDS) {
    if (!touched.has(key)) next[key] = incoming[key];
  }
  return next;
}

const floorText = (floor: string) => {
  const f = floor.trim();
  if (!f) return '';
  return /floor/i.test(f) ? f : `${f} floor`;
};

/** address_line_1: everything a rider needs to find the door, in reading order. */
export function composeLine1(f: AddressFields): string {
  return [f.houseNo, f.building, floorText(f.floor), f.street]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
}

/** address_line_2: the area. Landmark and instructions have their own columns. */
export function composeLine2(f: AddressFields): string | undefined {
  const v = f.locality.trim();
  return v || undefined;
}

export type AddressErrors = Partial<Record<AddressFieldKey | 'position', string>>;

export function validateFields(f: AddressFields, hasPosition: boolean): { ok: boolean; errors: AddressErrors } {
  const errors: AddressErrors = {};
  if (!hasPosition) errors.position = 'Choose the delivery location on the map or use your current location.';
  if (f.receiverName.trim().length < 2) errors.receiverName = "Enter the recipient's name.";
  if (f.receiverPhone.replace(/\D/g, '').length !== 10) errors.receiverPhone = 'Enter a valid 10-digit phone number.';
  if (!f.houseNo.trim()) errors.houseNo = 'Enter the house / flat / shop number.';
  else if (f.houseNo.trim().length > 100) errors.houseNo = 'That is too long.';
  if (!f.street.trim() && !f.locality.trim() && !f.building.trim()) errors.street = 'Enter the street, building or area so the rider can find you.';
  if (!f.city.trim()) errors.city = 'Enter the city.';
  if (!f.state.trim()) errors.state = 'Enter the state.';
  if (!/^\d{6}$/.test(f.pincode.trim())) errors.pincode = 'Enter a valid 6-digit postal code.';
  if (f.instructions.length > 500) errors.instructions = 'Keep delivery instructions under 500 characters.';
  if (f.landmark.length > 200) errors.landmark = 'That is too long.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Where the confirmed coordinates came from, stored with the address. */
export type GeocodeSource = 'google' | 'osm' | 'device' | 'manual';

export function geocodeSourceFor(source: 'google' | 'osm' | 'device' | null | undefined): GeocodeSource {
  return source ?? 'manual';
}

// ---------------------------------------------------------------------------------------------------------------------------
// Telling the customer what is missing when Save does nothing
// ---------------------------------------------------------------------------------------------------------------------------

/** Top-to-bottom order of the form, so "the first problem" is the first one the customer meets. */
export const FIELD_ORDER: readonly (AddressFieldKey | 'position')[] = [
  'position',
  'receiverName',
  'receiverPhone',
  'houseNo',
  'street',
  'city',
  'state',
  'pincode',
  'landmark',
  'instructions',
];

const FIELD_LABELS: Record<AddressFieldKey | 'position', string> = {
  position: 'Delivery location (use the map or your current location)',
  receiverName: 'Recipient name',
  receiverPhone: 'Contact number (10 digits)',
  houseNo: 'House / flat no.',
  building: 'Building',
  floor: 'Floor',
  street: 'Street / road (or building / area)',
  locality: 'Area',
  landmark: 'Landmark',
  city: 'City',
  state: 'State',
  pincode: 'Postal code (6 digits)',
  instructions: 'Delivery instructions',
};

export interface AddressProblem {
  key: AddressFieldKey | 'position';
  label: string;
  message: string;
}

/** Every problem, in form order, with a plain label — what an alert after a failed Save lists. */
export function problemsInOrder(errors: AddressErrors): AddressProblem[] {
  return FIELD_ORDER.filter((key) => errors[key]).map((key) => ({ key, label: FIELD_LABELS[key], message: errors[key]! }));
}
