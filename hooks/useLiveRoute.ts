import { useEffect, useRef, useState } from 'react';
import { routingService, type RouteResult } from '../services/routing/routingService';
import type { LatLng } from '../types/models';

const ROUTE_REFRESH_MS = 30_000; // section 24: 20-60s, not on every GPS sample
const MOVEMENT_THRESHOLD_M = 100; // section 21/53: recalc when the rider has moved significantly

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Throttled route/ETA — the routing API is never called on every GPS
 * update (section 21/24). Recalculates only when the rider has moved
 * more than MOVEMENT_THRESHOLD_M since the last calculation, or when
 * ROUTE_REFRESH_MS has elapsed, whichever comes first. `origin` can
 * change reference on every render without that alone triggering a
 * network call — the throttle check happens before any fetch.
 */
export function useLiveRoute(origin: LatLng | null, destination: LatLng | null) {
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const lastCalc = useRef<{ at: number; pos: LatLng } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!origin || !destination) return;

    const last = lastCalc.current;
    const shouldRecalc =
      !last || Date.now() - last.at > ROUTE_REFRESH_MS || haversineMeters(last.pos, origin) > MOVEMENT_THRESHOLD_M;
    if (!shouldRecalc) return;

    const thisRequest = ++requestId.current;
    setLoading(true);
    routingService
      .getRoute(origin, destination)
      .then((result) => {
        if (thisRequest !== requestId.current) return; // a newer request superseded this one
        lastCalc.current = { at: Date.now(), pos: origin };
        if (result) {
          setRoute(result);
          setUnavailable(false);
        } else {
          // section 48: routing failure never blocks tracking — keep
          // showing the last known-good route/location, just flag
          // that the route itself couldn't refresh this time.
          setUnavailable(true);
        }
      })
      .finally(() => {
        if (thisRequest === requestId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin/destination are plain objects; the throttle above (not a dependency array) decides when to actually fetch.
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  return { route, loading, unavailable };
}

/** section 23: never false precision — a range when uncertain, "Arriving soon" once close. */
export function formatEta(durationSeconds: number | undefined, arrivingSoonThresholdMin = 5): string {
  if (durationSeconds == null) return '';
  const minutes = durationSeconds / 60;
  if (minutes <= arrivingSoonThresholdMin) return 'Arriving soon';
  const low = Math.max(1, Math.round(minutes * 0.85));
  const high = Math.round(minutes * 1.2);
  return low === high ? `${low} min` : `${low}–${high} min`;
}
