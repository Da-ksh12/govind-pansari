import type { LatLng } from '../../types/models';

/** One resolved place: a position plus whatever address parts the provider knew. Nothing is invented. */
export interface ResolvedAddress {
  position: LatLng;
  formattedAddress: string;
  /** Google place id, when there is one (it may be stored indefinitely under Google's terms). */
  placeId: string | null;
  /** The name of the place the customer picked from search ("Taj Mahal"), if they picked one. */
  placeName: string | null;
  parts: {
    street: string | null;
    locality: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    /** A building / premise name when the provider reports one. */
    premise: string | null;
  };
  /** Which provider produced this. 'device' = the phone's own geocoder, 'osm' = OpenStreetMap search. */
  source: 'google' | 'osm' | 'device';
  /** Google reverse geocoding only: ROOFTOP / RANGE_INTERPOLATED / GEOMETRIC_CENTER / APPROXIMATE. */
  precision: string | null;
  /** What the local Agra place data added (the closest colony, a landmark, where the pincode came from). Absent when it had nothing to say. */
  local?: LocalPlaceInfo;
}

/** The closest-block detail from services/location/placeEnrichment.ts, shown to the customer so they can see WHY the app says what it says. */
export interface LocalPlaceInfo {
  /** The block the pin is in, or the nearest one. */
  locality: { name: string; inside: boolean; distanceM: number } | null;
  /** Something to give directions by: "Near Durga Mandir". */
  landmark: { name: string; type: string; distanceM: number } | null;
  /** Where the pincode came from: the India Post area it belongs to, or postcodes on nearby map features. */
  pin: { value: string; basis: 'area-name' | 'nearby-addresses' | 'map'; from: string } | null;
}

export interface AddressSuggestion {
  id: string;
  primary: string;
  secondary: string;
  source: 'google' | 'osm';
  /** OpenStreetMap results arrive with their position; Google suggestions need one more (Place Details) call. */
  resolved: ResolvedAddress | null;
}

export type LookupFailureKind = 'offline' | 'not_configured' | 'rate_limited' | 'unavailable' | 'denied';

export class AddressLookupError extends Error {
  kind: LookupFailureKind;
  constructor(kind: LookupFailureKind, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

/**
 * A provider that is not set up (no key / billing), refused the key, or is down must not take address entry down with it:
 * the previous provider still works. An offline phone and a rate-limited customer cannot be helped by a fallback.
 */
export function canFallBack(kind: LookupFailureKind): boolean {
  return kind === 'not_configured' || kind === 'unavailable' || kind === 'denied';
}

export function describeLookupFailure(kind: LookupFailureKind): string {
  switch (kind) {
    case 'offline':
      return "You're offline. Check your connection to search for an address — you can still move the map pin.";
    case 'rate_limited':
      return 'Too many searches in a short time. Wait a few seconds and try again.';
    case 'not_configured':
    case 'denied':
    case 'unavailable':
      return "Address search isn't available right now. You can still move the map pin and type the address.";
  }
}

/** Maps the Edge Function's error codes (supabase/functions/address-lookup) to a failure kind. */
export function kindFromErrorCode(code: string | undefined, status?: number): LookupFailureKind {
  switch (code) {
    case 'NOT_CONFIGURED':
      return 'not_configured';
    case 'RATE_LIMITED':
      return 'rate_limited';
    case 'UPSTREAM_DENIED':
    case 'UNAUTHENTICATED':
      return 'denied';
    default:
      return status === 429 ? 'rate_limited' : 'unavailable';
  }
}

/**
 * A short, readable name for a spot — "Wazirpura Road, Swadhesi Bima Colony" rather than "Agra, Uttar Pradesh" — for headers
 * and the location chip. Falls back to the area, then the city, and to null when the provider knew nothing.
 */
export function shortAddressLabel(parts: ResolvedAddress['parts'] | null | undefined): string | null {
  if (!parts) return null;
  const area = parts.locality?.split(',')[0]?.trim() || null;
  const specific = [parts.street, area].filter((v, i, all): v is string => !!v && all.indexOf(v) === i);
  if (specific.length > 0) return specific.join(', ');
  return parts.city ?? null;
}

/** A search session token: one per "type, pick a result" cycle (Google bills the cycle as a unit). */
export function newSessionToken(random: () => number = Math.random, now: () => number = Date.now): string {
  const chunk = () => Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${now().toString(36)}-${chunk()}${chunk()}${chunk()}`;
}

/** Skip a reverse-geocode when the pin barely moved: each one is a billable request. */
export const REVERSE_MIN_MOVE_METERS = 15;

export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function shouldReverseGeocode(last: LatLng | null, next: LatLng): boolean {
  return !last || metersBetween(last, next) >= REVERSE_MIN_MOVE_METERS;
}
