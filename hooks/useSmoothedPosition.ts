import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../types/models';

/**
 * Smoothly interpolates between GPS samples (section 30) rather than
 * teleporting the marker from point A to point B — a plain JS-thread
 * requestAnimationFrame loop is more than sufficient at the ~4s
 * sample rate this app actually receives (no jank concern; this is
 * not a 60fps-critical animation).
 */
export function useSmoothedPosition(target: LatLng | null, durationMs = 2500): LatLng | null {
  const [display, setDisplay] = useState<LatLng | null>(target);
  const fromRef = useRef<LatLng | null>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const from = fromRef.current ?? target;
    const start = Date.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setDisplay({ lat: from.lat + (target.lat - from.lat) * t, lng: from.lng + (target.lng - from.lng) * t });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng, durationMs]);

  return display;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/** Same interpolation, but around the shortest arc (section 31) — never a 350°→10° jump the long way round. */
export function useSmoothedHeading(target: number | null, durationMs = 2500): number {
  const [display, setDisplay] = useState<number>(target ?? 0);
  const fromRef = useRef<number>(target ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current;
    const delta = shortestAngleDelta(from, target);
    const start = Date.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setDisplay(from + delta * t);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = from + delta;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}
