// Google Maps Platform request building and response parsing for address search, kept free of any runtime-specific
// API so it is unit-tested in Node (tests/unit/google-places.test.mjs) and used unchanged by the address-lookup Edge Function.
//
// Source of truth: Google's documentation (checked 2026-10-28):
//   * Autocomplete (New) ... POST https://places.googleapis.com/v1/places:autocomplete, header X-Goog-Api-Key, body
//                            {input, sessionToken, locationBias.circle{center,radius<=50000}, includedRegionCodes[],
//                            regionCode, languageCode, origin}; response suggestions[].placePrediction{placeId,
//                            text.text, structuredFormat.mainText.text / secondaryText.text, distanceMeters}
//   * Place Details (New) .. GET https://places.googleapis.com/v1/places/{placeId}?sessionToken=…, header X-Goog-FieldMask
//                            is REQUIRED (no default). id is "IDs Only"; location, formattedAddress, addressComponents
//                            are "Essentials"; displayName is "Pro" and is deliberately not requested.
//   * Reverse geocoding .... GET https://maps.googleapis.com/maps/api/geocode/json?latlng=lat,lng&key=…; status OK /
//                            ZERO_RESULTS / OVER_QUERY_LIMIT / REQUEST_DENIED / INVALID_REQUEST / UNKNOWN_ERROR;
//                            results run from the most specific address to the most general.
//   * Policy ............... Places and Geocoding results shown on a map must be shown on a GOOGLE map; place IDs may be
//                            stored indefinitely; other content must not be pre-fetched, cached or stored beyond the terms.
//
// Nothing here invents an address: a field Google did not return stays null.

export const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
export const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Essentials-tier fields only. Adding displayName (Pro) would raise the price of every selection. */
export const DETAILS_FIELD_MASK = 'id,formattedAddress,location,addressComponents';

export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 120;
/** Bias circle radius (metres). The API allows up to 50,000. */
export const BIAS_RADIUS_METERS = 30_000;
export const MAX_SUGGESTIONS = 8;

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export type LookupRequest =
  | { action: 'autocomplete'; input: string; sessionToken: string; bias: LatLngPoint | null }
  | { action: 'details'; placeId: string; sessionToken: string }
  | { action: 'reverse'; lat: number; lng: number };

export type ParsedRequest = { ok: true; request: LookupRequest } | { ok: false; message: string };

const SESSION_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,400}$/;

function validPoint(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Validates everything the client sends. The function never forwards anything it has not checked. */
export function parseLookupRequest(body: unknown): ParsedRequest {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'request body must be a JSON object' };
  const b = body as Record<string, unknown>;

  if (b.action === 'autocomplete') {
    if (typeof b.input !== 'string') return { ok: false, message: 'input is required' };
    const input = b.input.replace(/\s+/g, ' ').trim();
    if (input.length < MIN_QUERY_LENGTH) return { ok: false, message: `type at least ${MIN_QUERY_LENGTH} characters` };
    if (input.length > MAX_QUERY_LENGTH) return { ok: false, message: 'input is too long' };
    if (typeof b.sessionToken !== 'string' || !SESSION_TOKEN.test(b.sessionToken)) return { ok: false, message: 'a valid sessionToken is required' };
    let bias: LatLngPoint | null = null;
    if (b.bias !== undefined && b.bias !== null) {
      const raw = b.bias as Record<string, unknown>;
      if (typeof raw !== 'object' || !validPoint(raw.lat, raw.lng)) return { ok: false, message: 'bias must be a valid position' };
      bias = { lat: raw.lat as number, lng: raw.lng as number };
    }
    return { ok: true, request: { action: 'autocomplete', input, sessionToken: b.sessionToken, bias } };
  }

  if (b.action === 'details') {
    if (typeof b.placeId !== 'string' || !PLACE_ID.test(b.placeId)) return { ok: false, message: 'a valid placeId is required' };
    if (typeof b.sessionToken !== 'string' || !SESSION_TOKEN.test(b.sessionToken)) return { ok: false, message: 'a valid sessionToken is required' };
    return { ok: true, request: { action: 'details', placeId: b.placeId, sessionToken: b.sessionToken } };
  }

  if (b.action === 'reverse') {
    if (!validPoint(b.lat, b.lng)) return { ok: false, message: 'a valid lat/lng is required' };
    return { ok: true, request: { action: 'reverse', lat: b.lat as number, lng: b.lng as number } };
  }

  return { ok: false, message: 'unknown action' };
}

// ---------------------------------------------------------------------------
// Autocomplete (New)
// ---------------------------------------------------------------------------

export function buildAutocompleteBody(req: Extract<LookupRequest, { action: 'autocomplete' }>) {
  const body: Record<string, unknown> = {
    input: req.input,
    sessionToken: req.sessionToken,
    // Customers deliver within India; the bias below narrows it to the neighbourhood when the position is known.
    includedRegionCodes: ['in'],
    regionCode: 'in',
    languageCode: 'en',
  };
  if (req.bias) {
    body.locationBias = { circle: { center: { latitude: req.bias.lat, longitude: req.bias.lng }, radius: BIAS_RADIUS_METERS } };
    body.origin = { latitude: req.bias.lat, longitude: req.bias.lng };
  }
  return body;
}

export interface Suggestion {
  placeId: string;
  /** The place or street name ("Vijay Nagar Colony"). */
  primary: string;
  /** The rest of the line ("Agra, Uttar Pradesh, India"). */
  secondary: string;
  description: string;
  distanceMeters: number | null;
}

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function parseAutocompleteResponse(json: unknown): Suggestion[] {
  const list = (json as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: Suggestion[] = [];
  for (const entry of list) {
    const p = (entry as { placePrediction?: Record<string, any> })?.placePrediction;
    if (!p || typeof p.placeId !== 'string' || !PLACE_ID.test(p.placeId)) continue; // query predictions and malformed rows carry no place
    const description = clip(p.text?.text, 300);
    const primary = clip(p.structuredFormat?.mainText?.text, 200) || description.split(',')[0]?.trim() || '';
    if (!primary) continue;
    const distance = typeof p.distanceMeters === 'number' && Number.isFinite(p.distanceMeters) && p.distanceMeters > 0 ? Math.round(p.distanceMeters) : null;
    out.push({
      placeId: p.placeId,
      primary,
      secondary: clip(p.structuredFormat?.secondaryText?.text, 200),
      description: description || primary,
      distanceMeters: distance,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Address components (both API shapes)
// ---------------------------------------------------------------------------

export interface RawComponent {
  long: string;
  short: string;
  types: string[];
}

export function fromPlacesComponents(list: unknown): RawComponent[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && Array.isArray(c.types))
    .map((c) => ({ long: clip(c.longText, 200), short: clip(c.shortText, 200), types: c.types.filter((t: unknown) => typeof t === 'string') }));
}

export function fromGeocodeComponents(list: unknown): RawComponent[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && Array.isArray(c.types))
    .map((c) => ({ long: clip(c.long_name, 200), short: clip(c.short_name, 200), types: c.types.filter((t: unknown) => typeof t === 'string') }));
}

export interface AddressParts {
  /** Only what Google reports. In India this is usually null — the app asks the customer for the house/flat number. */
  streetNumber: string | null;
  /** A building or premise name when Google knows one. */
  premise: string | null;
  subpremise: string | null;
  /** The road. */
  street: string | null;
  /** Neighbourhood / colony, up to two distinct levels ("Vijay Nagar, Sanjay Place"). */
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  postalCode: string | null;
}

const pick = (components: RawComponent[], ...types: string[]): string | null => {
  for (const type of types) {
    const found = components.find((c) => c.types.includes(type) && c.long);
    if (found) return found.long;
  }
  return null;
};

export function normalizeComponents(components: RawComponent[]): AddressParts {
  const fine = pick(components, 'sublocality_level_2', 'neighborhood', 'sublocality_level_3');
  const area = pick(components, 'sublocality_level_1', 'sublocality');
  const locality = [fine, area].filter((v, i, all): v is string => !!v && all.indexOf(v) === i).join(', ') || null;
  const postal = pick(components, 'postal_code');
  return {
    streetNumber: pick(components, 'street_number'),
    premise: pick(components, 'premise'),
    subpremise: pick(components, 'subpremise'),
    street: pick(components, 'route'),
    locality,
    city: pick(components, 'locality', 'administrative_area_level_3', 'administrative_area_level_2'),
    district: pick(components, 'administrative_area_level_2'),
    state: pick(components, 'administrative_area_level_1'),
    // An Indian PIN code is exactly six digits; anything else is not passed on as one.
    postalCode: postal && /^\d{6}$/.test(postal) ? postal : null,
  };
}

// ---------------------------------------------------------------------------
// Place Details (New) and reverse geocoding
// ---------------------------------------------------------------------------

export interface ResolvedPlace {
  placeId: string | null;
  formattedAddress: string;
  location: LatLngPoint;
  parts: AddressParts;
  /** Geocoding only: ROOFTOP / RANGE_INTERPOLATED / GEOMETRIC_CENTER / APPROXIMATE. */
  locationType: string | null;
}

export type GoogleLookupErrorKind = 'INVALID_REQUEST' | 'UPSTREAM_DENIED' | 'UPSTREAM_BUSY' | 'UPSTREAM_ERROR' | 'NOT_FOUND';

export class GoogleLookupError extends Error {
  kind: GoogleLookupErrorKind;
  constructor(kind: GoogleLookupErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function buildDetailsUrl(placeId: string, sessionToken: string): string {
  return `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
}

export function parsePlaceDetails(json: unknown): ResolvedPlace {
  const p = json as Record<string, any> | null;
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (!p || !validPoint(lat, lng)) throw new GoogleLookupError('NOT_FOUND', 'the place has no usable position');
  return {
    placeId: typeof p.id === 'string' ? p.id : null,
    formattedAddress: clip(p.formattedAddress, 300),
    location: { lat, lng },
    parts: normalizeComponents(fromPlacesComponents(p.addressComponents)),
    locationType: null,
  };
}

export function buildReverseUrl(lat: number, lng: number, apiKey: string): string {
  const params = new URLSearchParams({ latlng: `${lat},${lng}`, language: 'en', region: 'in', key: apiKey });
  return `${GEOCODE_URL}?${params.toString()}`;
}

/** The most specific result for the point, or null when Google knows nothing there (ZERO_RESULTS). */
export function parseReverseGeocode(json: unknown): ResolvedPlace | null {
  const r = json as { status?: string; error_message?: string; results?: Record<string, any>[] } | null;
  switch (r?.status) {
    case 'OK':
      break;
    case 'ZERO_RESULTS':
      return null;
    case 'OVER_QUERY_LIMIT':
      throw new GoogleLookupError('UPSTREAM_BUSY', 'geocoding quota reached');
    case 'REQUEST_DENIED':
      throw new GoogleLookupError('UPSTREAM_DENIED', 'geocoding request denied (check the key, billing and enabled APIs)');
    case 'INVALID_REQUEST':
      throw new GoogleLookupError('INVALID_REQUEST', 'geocoding request was invalid');
    default:
      throw new GoogleLookupError('UPSTREAM_ERROR', 'geocoding failed');
  }
  const first = r.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!first || !validPoint(lat, lng)) return null;
  return {
    placeId: typeof first.place_id === 'string' ? first.place_id : null,
    formattedAddress: clip(first.formatted_address, 300),
    location: { lat, lng },
    parts: normalizeComponents(fromGeocodeComponents(first.address_components)),
    locationType: typeof first.geometry?.location_type === 'string' ? first.geometry.location_type : null,
  };
}

/** Maps an HTTP failure from the Places (New) endpoints to the error kinds above. Never includes the response body (it can echo the request). */
export function classifyHttpFailure(status: number): GoogleLookupError {
  if (status === 400) return new GoogleLookupError('INVALID_REQUEST', 'Google rejected the request');
  if (status === 401 || status === 403) return new GoogleLookupError('UPSTREAM_DENIED', 'Google refused the key (check billing, enabled APIs and key restrictions)');
  if (status === 404) return new GoogleLookupError('NOT_FOUND', 'Google does not know this place');
  if (status === 429) return new GoogleLookupError('UPSTREAM_BUSY', 'Google quota reached');
  return new GoogleLookupError('UPSTREAM_ERROR', `Google returned ${status}`);
}
