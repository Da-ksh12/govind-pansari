import type { LatLng } from '../../types/models';
import type { GeocodeResult } from './geocodingService';

export interface PlaceSearchResult extends GeocodeResult {
  id: string;
  position: LatLng;
}

/**
 * Forward place search — "search for a place" on the map picker — via
 * OpenStreetMap's own free, no-key Nominatim API, the same provider
 * family as the app's map tiles (services/map/osmStyle.ts) and reverse
 * geocoding. Same tradeoff documented there: zero-key and free today,
 * with a real (if generous for this app's current scale) rate/usage
 * policy — a valid identifying header and client-side debouncing (the
 * caller debounces, not this function) keep real traffic well inside
 * it. Swapping to Google Places later means implementing this same
 * `search()` shape and changing one export, not any call site.
 *
 * Results are biased toward Agra (a loose viewbox, not a hard filter —
 * `bounded: 0` still returns a real, relevant match anywhere in India
 * if someone searches a place outside the city) rather than hardcoded
 * to it, since a customer could reasonably search for a landmark just
 * outside today's delivery area.
 */
const AGRA_VIEWBOX = '77.85,27.35,78.15,27.05'; // left,top,right,bottom — loose box around Agra

function toPlaceResult(item: NominatimItem): PlaceSearchResult {
  const addr = item.address ?? {};
  const city = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? addr.county;
  const placeName = item.name || item.display_name.split(',')[0].trim();
  const label = [placeName, city].filter(Boolean).join(', ');

  return {
    id: `${item.place_id}`,
    position: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
    placeName,
    label: label || item.display_name,
    addressLine: item.display_name,
    city,
    state: addr.state,
    postalCode: addr.postcode,
  };
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
    postcode?: string;
  };
}

export const placesSearchService = {
  async search(query: string): Promise<PlaceSearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    try {
      const params = new URLSearchParams({
        q,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '8',
        countrycodes: 'in',
        viewbox: AGRA_VIEWBOX,
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
          // Nominatim's usage policy asks for a real identifying
          // header on every request — native platforms honour a
          // custom User-Agent; web falls back to the browser's own
          // Referer, which the policy also accepts.
          'User-Agent': 'GovindPansariApp/1.0 (delivery app, Agra)',
          Accept: 'application/json',
        },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as NominatimItem[];
      return (data ?? []).map(toPlaceResult);
    } catch {
      // Offline, DNS hiccup, rate-limited — the picker still works by
      // panning the map manually, this is purely additive.
      return [];
    }
  },
};
