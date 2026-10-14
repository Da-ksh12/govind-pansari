import type { LatLng } from '../../types/models';

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Full road-following geometry, store → ... → destination order. */
  polyline: LatLng[];
  provider: string;
  calculatedAt: string;
}

/**
 * Routing behind an interface, not tied to one provider — same
 * pattern as services/location/geocodingService.ts. The default
 * implementation calls OSRM's public demo routing server (no API key,
 * real road-network routing — not straight-line distance). That
 * server has no SLA and isn't meant for heavy production traffic;
 * swapping to Google/Mapbox Directions later (an account with real
 * volume, or a paid tier) means implementing this same interface and
 * changing one export, not touching any call site — including the
 * throttling in hooks/useLiveRoute.ts, which is provider-agnostic.
 */
export interface RoutingService {
  getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult | null>;
}

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';

export const routingService: RoutingService = {
  async getRoute(origin, destination) {
    try {
      const url = `${OSRM_BASE_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) return null; // section 48: routing failure -> null, never an invented ETA
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.[0]) return null;

      const route = data.routes[0];
      const polyline: LatLng[] = (route.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ lat, lng }));

      return {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        polyline,
        provider: 'osrm',
        calculatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  },
};
