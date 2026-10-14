import type { LatLng } from '../../types/models';
import type { RouteResult } from '../../services/routing/routingService';

/** Plain tuple, not @maplibre's own type — kept dependency-free so this file (and LiveTrackingMap.web.tsx) never import the native-only map package (section 1/13: MapLibre has no web build at all). */
export type LngLatBoundsTuple = [west: number, south: number, east: number, north: number];

export interface LiveTrackingMapRef {
  fitBounds: (bounds: LngLatBoundsTuple, options?: { padding?: { top?: number; left?: number; right?: number; bottom?: number }; duration?: number }) => void;
}

export interface LiveTrackingMapProps {
  storePos: LatLng | null;
  destPos: LatLng | null;
  riderPos: LatLng | null;
  heading: number;
  stale: boolean;
  /** Order has reached the customer's area (real order status 'arriving'). */
  arrived?: boolean;
  route: RouteResult | null;
  initialCenter: LatLng | null;
}
