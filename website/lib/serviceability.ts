// What the customer is told about delivery to a point. The SERVER decides (check_serviceability); this module only words its answer.
// Copied from the mobile app (services/serviceability.ts) so the website and the app use exactly the same sentences for the same result.
// Keep the two in step. Pure: no framework or network imports.

export interface EligibleStore {
  storeId: string;
  storeName: string;
  distanceMeters: number;
}

export type UnserviceableReason =
  | 'OUTSIDE_SERVICE_AREA'
  | 'STORE_CLOSED'
  | 'STORES_NOT_ACCEPTING_ORDERS'
  | 'NO_ACTIVE_STORES'
  | 'INVALID_COORDINATES';

export type ServiceabilityResult =
  | {
      serviceable: true;
      zoneId: string;
      deliveryFee: number;
      minimumOrderValue: number;
      estimatedDeliveryMinutes: number;
      /** Every store that can serve this point right now, nearest first. */
      eligibleStores: EligibleStore[];
      nearestStore?: EligibleStore;
      maxRadiusKm?: number;
    }
  | {
      serviceable: false;
      reason: UnserviceableReason;
      maxRadiusKm?: number;
      /** For OUTSIDE_SERVICE_AREA: the nearest store and how far it is. */
      nearestStore?: EligibleStore;
      /** For STORE_CLOSED: opening hours as "HH:MM". */
      opensAt?: string;
      closesAt?: string;
    };

export type ServiceabilityTone = 'ok' | 'closed' | 'unavailable' | 'error';

export interface ServiceabilityMessage {
  tone: ServiceabilityTone;
  title: string;
  message: string;
  /** An address is still worth saving when only the time of day (or a temporary pause) is the problem. */
  addressStillValid: boolean;
}

/** "Govind Pansari — Vijay Nagar" -> "Vijay Nagar". */
export function shortStoreName(name: string): string {
  return name.replace(/^Govind Pansari\s*[—-]\s*/i, '').trim();
}

/** 76 -> "76 m", 1400.6 -> "1.4 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** "21:00" -> "9:00 PM". */
export function formatClock(hhmm: string | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!match) return '';
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${match[2]} ${suffix}`;
}

function radiusText(km: number | undefined): string {
  return km != null ? `${Number.isInteger(km) ? km : km.toFixed(1)} km` : 'our delivery radius';
}

/** The one wording for a serviceability result. */
export function describeServiceability(result: ServiceabilityResult): ServiceabilityMessage {
  if (result.serviceable) {
    const nearest = result.nearestStore ?? result.eligibleStores[0];
    return {
      tone: 'ok',
      title: 'Good news! We deliver to your area.',
      message: nearest ? `Served by our ${shortStoreName(nearest.storeName)} store, ${formatDistance(nearest.distanceMeters)} away.` : 'We deliver to this location.',
      addressStillValid: true,
    };
  }
  switch (result.reason) {
    case 'OUTSIDE_SERVICE_AREA': {
      const nearest = result.nearestStore;
      return {
        tone: 'unavailable',
        title: 'Outside our delivery area',
        message: nearest
          ? `Our nearest store (${shortStoreName(nearest.storeName)}) is ${formatDistance(nearest.distanceMeters)} away, and we deliver within ${radiusText(result.maxRadiusKm)}. You can still save this address.`
          : `We deliver within ${radiusText(result.maxRadiusKm)} of our stores, and this location is outside that. You can still save this address.`,
        addressStillValid: true,
      };
    }
    case 'STORE_CLOSED': {
      const opens = formatClock(result.opensAt);
      const closes = formatClock(result.closesAt);
      return {
        tone: 'closed',
        title: "We're closed right now",
        message: opens && closes ? `This location is in our delivery area. We deliver between ${opens} and ${closes}. You can still save this address.` : 'This location is in our delivery area, but our stores are closed right now.',
        addressStillValid: true,
      };
    }
    case 'STORES_NOT_ACCEPTING_ORDERS':
      return {
        tone: 'closed',
        title: "Stores aren't taking orders right now",
        message: 'This location is in our delivery area, but our nearby stores have paused orders for the moment. Please try again shortly.',
        addressStillValid: true,
      };
    case 'NO_ACTIVE_STORES':
      return { tone: 'unavailable', title: 'Delivery is unavailable', message: 'No store is open for delivery at the moment. Please try again later.', addressStillValid: true };
    case 'INVALID_COORDINATES':
      return {
        tone: 'error',
        title: "We couldn't read this location",
        message: 'Move the pin on the map, search for the place again, or use your current location.',
        addressStillValid: false,
      };
  }
}

/** The check itself failed (no connection, server error) — not an answer about the address. Never reported as "unsupported area". */
export function describeServiceabilityFailure(): ServiceabilityMessage {
  return {
    tone: 'error',
    title: "Couldn't check delivery",
    message: "We couldn't check delivery to this location just now. Check your connection and try again — delivery is also checked again at checkout.",
    addressStillValid: true,
  };
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/** A usable latitude/longitude pair (right ranges, finite). Not "is it in India" — the server decides serviceability. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** What to tell a visitor for each way the browser can fail to give a position (codes are GeolocationPositionError.code). */
export function describeBrowserLocationFailure(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'Location permission is off for this site. Allow it in your browser, or search for your area or pincode instead.';
    case 2:
      return "We couldn't work out where you are. Search for your area or pincode instead.";
    case 3:
      return "Finding your location took too long. Try again, or search for your area or pincode instead.";
    default:
      return "We couldn't get your location. Search for your area or pincode instead.";
  }
}

