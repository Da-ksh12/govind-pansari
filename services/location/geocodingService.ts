import * as Location from 'expo-location';
import type { LatLng } from '../../types/models';

export interface GeocodeResult {
  /** Short display label, e.g. "Vijay Nagar Colony, Agra". */
  label: string;
  addressLine: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** The road name only (never a house number — a device geocoder's number is a guess), when the device reports one. */
  street?: string;
  /** Neighbourhood / area, when the device reports one. */
  locality?: string;
  /** Set only when this came from a named-place search result (a
   * building/business/landmark), not a plain reverse-geocode of a
   * dropped pin — lets the caller prefer the real place name over a
   * generic street line when one exists. */
  placeName?: string;
}

/**
 * Reverse-geocoding behind an interface, not tied to one provider.
 * expo-location's reverseGeocodeAsync (device-native, no API key) is
 * the default implementation — swapping to Google/Mapbox later (better
 * accuracy, richer results) means implementing this same interface and
 * changing one export, not touching any call site. If a provider needs
 * an API key, it belongs in a server-side call (Edge Function) or an
 * EXPO_PUBLIC_ env var restricted to that specific key's own domain/
 * bundle-id restrictions — never a general-purpose secret shipped in
 * the app.
 */
export interface GeocodingService {
  reverseGeocode(position: LatLng): Promise<GeocodeResult | null>;
}

export const geocodingService: GeocodingService = {
  async reverseGeocode(position: LatLng): Promise<GeocodeResult | null> {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: position.lat, longitude: position.lng });
      const first = results[0];
      if (!first) return null;

      const line = [first.streetNumber, first.street, first.district].filter(Boolean).join(', ');
      const city = first.city ?? first.subregion ?? undefined;
      const label = [first.district ?? first.street, city].filter(Boolean).join(', ');

      return {
        label: label || city || 'Selected location',
        addressLine: line || label || 'Selected location',
        city,
        state: first.region ?? undefined,
        postalCode: first.postalCode ?? undefined,
        street: first.street ?? undefined,
        locality: first.district ?? undefined,
      };
    } catch {
      // Device geocoder is unavailable on some platforms/emulators —
      // treat as "no human-readable address available", not a crash.
      // The caller still has the raw coordinates.
      return null;
    }
  },
};
