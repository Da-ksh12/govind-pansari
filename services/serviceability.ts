// What the customer is told about delivery to a point. The SERVER decides (check_serviceability); this module only
// words its answer, so Add Address, the location screen, Home and Checkout can never disagree about the same coordinates.
// No React Native / Supabase imports, so tests/unit covers every message.

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

/** What to tell the customer for each way getting a position can fail — always ending with the map as the way forward. */
export function describeLocationFailure(code: string): string {
  switch (code) {
    case 'PERMISSION_DENIED':
      return 'Location permission is off. Allow it in Settings, or drop a pin on the map instead.';
    case 'GPS_DISABLED':
      return 'Location services are turned off. Turn them on, or drop a pin on the map instead.';
    case 'TIMEOUT':
      return "We couldn't get a GPS fix in time (try near a window or outdoors). You can drop a pin on the map instead.";
    default:
      return "We couldn't get your location. You can drop a pin on the map instead.";
  }
}

/**
 * GPS accuracy as reported by the device (metres, the radius of 68% confidence). The pin is still used — but the customer is
 * asked to check it on the map when it is poor, instead of the app quietly trusting (or replacing) it.
 */
export function describeGpsAccuracy(accuracyMeters: number | null | undefined, preciseAllowed = true): { poor: boolean; message: string | null } {
  // Android's "Approximate" permission can never give an exact spot, whatever number the phone reports: say why.
  if (!preciseAllowed) {
    return {
      poor: true,
      message: 'Precise location is turned off for this app, so your phone only shares your approximate area. Allow "Use precise location" in Settings, or move the map pin onto your exact spot. Check the pin before saving.',
    };
  }
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return { poor: false, message: null };
  if (accuracyMeters > 500) {
    const away = accuracyMeters >= 1000 ? `${(accuracyMeters / 1000).toFixed(1)} km` : `${Math.round(accuracyMeters)} m`;
    return { poor: true, message: `Your phone only found your approximate area (about ${away}). Go outdoors or turn on high-accuracy location, then tap locate again. Check the pin on the map before saving.` };
  }
  if (accuracyMeters > 50) {
    return { poor: true, message: `Your location is only accurate to about ${Math.round(accuracyMeters)} m. Move the map so the pin sits on your exact spot. Check the pin before saving.` };
  }
  return { poor: false, message: null };
}
