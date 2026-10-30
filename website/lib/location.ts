'use client';

import { browserClient } from './supabase/browser';
import type { ServiceabilityResult } from './serviceability';

// Where the visitor wants delivery. Kept in this browser only (localStorage), so "check delivery" on a product and the checkout start from the
// same place. It is a convenience, never an authority: the server checks the real address again at checkout.
export interface Place {
  label: string;
  lat: number;
  lng: number;
  postcode?: string | null;
  city?: string | null;
  state?: string | null;
  street?: string | null;
  locality?: string | null;
  /** How the position was found: a typed search (osm) or the device's GPS. */
  source?: 'osm' | 'device';
}

const KEY = 'gp.place.v1';

export function readSavedPlace(): Place | null {
  try {
    const data = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<Place> | null;
    if (data && typeof data.label === 'string' && Number.isFinite(data.lat) && Number.isFinite(data.lng)) return data as Place;
  } catch {
    // unreadable or blocked: no saved place
  }
  return null;
}

export function savePlace(place: Place): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    // private mode: the place just is not remembered
  }
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error('search failed');
  const body = (await res.json()) as { places?: (Place & { full?: string })[] };
  return (body.places ?? []).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, postcode: p.postcode, city: p.city, state: p.state, street: p.street, locality: p.locality, source: 'osm' as const }));
}

export async function describePlace(lat: number, lng: number, signal?: AbortSignal): Promise<Place> {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal });
    if (res.ok) {
      const body = (await res.json()) as { place?: Place | null };
      if (body.place) return { label: body.place.label, lat, lng, postcode: body.place.postcode, city: body.place.city, state: body.place.state, street: body.place.street, locality: body.place.locality, source: 'device' };
    }
  } catch {
    // fall through: a position without a name is still usable
  }
  return { label: 'Your current location', lat, lng, source: 'device' };
}

/** Asks the SERVER whether it delivers to a point. Throws if the check itself could not be made (that is not the same as "no"). */
export async function checkServiceability(lat: number, lng: number): Promise<ServiceabilityResult> {
  const { data, error } = await browserClient().rpc('check_serviceability', { p_lat: lat, p_lng: lng });
  if (error || !data) throw new Error(error?.message ?? 'no answer');
  return data as ServiceabilityResult;
}

export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) reject({ code: 0 });
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  });
}
