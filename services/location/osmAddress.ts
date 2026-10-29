// Turning OpenStreetMap's reverse-geocoding answer (Nominatim, zoom 18) into address parts, and refusing a postal code that
// cannot belong to the state it came with. Pure, so it is unit-tested (tests/unit/location-precision.test.mjs).
//
// Why this exists: the phone's own geocoder often answers an Indian coordinate with just "Agra, Uttar Pradesh". OpenStreetMap
// knows the road and the colony wherever they are mapped ("Wazirpura Road, Swadhesi Bima Colony, Civil Lines"). It also
// has wrong postal codes in places (the point 27.2037,78.0219 in Agra comes back as 402004, a Maharashtra PIN), so a PIN is
// only passed on when its first digit matches the state.

export interface OsmReverseParts {
  street: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  premise: string | null;
}

export interface OsmReverse {
  parts: OsmReverseParts;
  /** One readable line built from the parts (never OpenStreetMap's long display_name with the country). */
  formattedAddress: string;
  /** 'street' when a road is known, 'area' when only a neighbourhood/suburb is, 'city' otherwise. */
  precision: 'street' | 'area' | 'city';
}

/** The first digit of an Indian PIN identifies the postal region. State names are matched case-insensitively. */
const PIN_REGION_BY_STATE: Record<string, string> = {
  'delhi': '1', 'haryana': '1', 'punjab': '1', 'himachal pradesh': '1', 'jammu and kashmir': '1', 'ladakh': '1', 'chandigarh': '1',
  'uttar pradesh': '2', 'uttarakhand': '2',
  'rajasthan': '3', 'gujarat': '3', 'dadra and nagar haveli and daman and diu': '3',
  'maharashtra': '4', 'goa': '4', 'madhya pradesh': '4', 'chhattisgarh': '4',
  'andhra pradesh': '5', 'telangana': '5', 'karnataka': '5',
  'kerala': '6', 'tamil nadu': '6', 'puducherry': '6', 'lakshadweep': '6',
  'west bengal': '7', 'odisha': '7', 'assam': '7', 'sikkim': '7', 'arunachal pradesh': '7', 'nagaland': '7', 'manipur': '7',
  'mizoram': '7', 'tripura': '7', 'meghalaya': '7', 'andaman and nicobar islands': '7',
  'bihar': '8', 'jharkhand': '8',
};

/** A six-digit PIN whose region digit matches the state (or whose state is unknown to us). */
export function sanePostalCode(pin: string | null | undefined, state: string | null | undefined): string | null {
  const p = (pin ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(p)) return null;
  const region = PIN_REGION_BY_STATE[(state ?? '').trim().toLowerCase()];
  return region && p[0] !== region ? null : p;
}

const first = (...values: (string | undefined)[]) => values.map((v) => (v ?? '').trim()).find(Boolean) ?? null;

export function parseNominatimReverse(json: unknown): OsmReverse | null {
  const j = json as { error?: unknown; name?: string; address?: Record<string, string> } | null;
  const a = j?.address;
  if (!j || j.error || !a) return null;

  const street = first(a.road, a.pedestrian, a.footway, a.path, a.residential, a.living_street);
  const fine = first(a.neighbourhood, a.quarter, a.hamlet);
  const area = first(a.suburb, a.city_district, a.borough);
  const locality = [fine, area].filter((v, i, all): v is string => !!v && all.indexOf(v) === i).join(', ') || null;
  const city = first(a.city, a.town, a.village, a.municipality, a.county, a.state_district);
  const state = first(a.state);
  const premise = first(a.building, a.house_name);
  const postalCode = sanePostalCode(a.postcode, state);

  if (!street && !locality && !city) return null;
  const formattedAddress = [premise, street, locality, city, [state, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    parts: { street, locality, city, state, postalCode, premise },
    formattedAddress,
    precision: street ? 'street' : locality ? 'area' : 'city',
  };
}
