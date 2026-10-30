import { NextResponse } from 'next/server';
import placesData from '@/data/agra-places.json';
import { getStores } from '@/lib/data/storefront';
import { sameSpot, searchLocalities, type PlaceIndex } from '@/lib/places';
import { absoluteUrl } from '@/lib/site';

const localIndex = placesData as unknown as PlaceIndex;

// Turns "Awas Vikas" or "282007" into map positions (from the shop's own Agra index first), and positions into a readable address, using
// OpenStreetMap's Nominatim.
// Done here (not in the browser) so the browser never talks to a third party with the visitor's IP on every keystroke, requests carry the
// identifying User-Agent Nominatim's usage policy requires, and answers can be cached. NOTE for the owner: Nominatim's public service is meant
// for light use; at real traffic switch this one file to a paid geocoder (the mobile app has a Google option behind a flag for the same reason).
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// A box around Agra used to rank nearby places first. It is a bias, not a fence: serviceability is decided by the server, never by this.
const AGRA_VIEWBOX = '77.75,27.40,78.25,26.95';

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}

const headers = { 'User-Agent': `GovindPansariWebsite/1.0 (${absoluteUrl('/')})`, 'Accept-Language': 'en-IN,en', Accept: 'application/json' };

function shape(place: NominatimPlace) {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !place.display_name) return null;
  const a = place.address ?? {};
  const line = [a.house_number, a.road, a.neighbourhood ?? a.suburb ?? a.residential, a.city ?? a.town ?? a.village ?? a.county].filter(Boolean).join(', ');
  return {
    label: line || place.display_name,
    full: place.display_name,
    lat,
    lng,
    postcode: a.postcode ?? null,
    city: a.city ?? a.town ?? a.village ?? a.county ?? null,
    state: a.state ?? null,
    street: a.road ?? null,
    locality: a.neighbourhood ?? a.suburb ?? a.residential ?? null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const latParam = searchParams.get('lat');
  const lngParam = searchParams.get('lng');

  try {
    if (latParam !== null && lngParam !== null) {
      const lat = Number(latParam);
      const lng = Number(lngParam);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ error: 'Invalid position.' }, { status: 400 });
      const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, { headers, next: { revalidate: 86_400 } });
      if (!res.ok) throw new Error(`reverse ${res.status}`);
      const place = shape((await res.json()) as NominatimPlace);
      return NextResponse.json({ place });
    }

    if (q.length < 3) return NextResponse.json({ places: [] });

    // 1) the shop's own index of Agra colonies, sectors and pincodes (plus the areas our shops stand in)
    const stores = await getStores().catch(() => []);
    const shopAreas = stores.map((s) => ({ n: s.area.replace(/,\s*agra\s*$/i, ''), la: s.latitude, ln: s.longitude, r: 600, k: 'colony' as const, s: 3 }));
    const local = searchLocalities({ ...localIndex, localities: [...localIndex.localities, ...shopAreas] }, q).map((p) => ({
      label: p.label, full: p.label, lat: p.lat, lng: p.lng, postcode: p.postcode, city: 'Agra', state: 'Uttar Pradesh', street: null, locality: p.locality,
    }));

    // 2) streets and landmarks from OpenStreetMap, but ONLY inside the Agra box: unbounded, a search for "Awas Vikas" answers with towns of that
    //    name in other cities, and a customer must never be offered the wrong city. Skipped when the local index already answered well.
    const online: NonNullable<ReturnType<typeof shape>>[] = [];
    if (local.length < 3) {
      try {
        const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&viewbox=${AGRA_VIEWBOX}&bounded=1&q=${encodeURIComponent(q.replace(/,?\s*agra\s*$/i, ''))}`;
        const res = await fetch(url, { headers, next: { revalidate: 86_400 } });
        if (res.ok) {
          for (const place of ((await res.json()) as NominatimPlace[]).map(shape)) {
            if (place && !local.some((l) => sameSpot(l, place))) online.push(place);
          }
        }
      } catch {
        // the online search is a bonus: the local answers still go back
      }
    }
    const places = [...local, ...online].slice(0, 6);
    return NextResponse.json({ places }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch {
    return NextResponse.json({ error: 'Address search is unavailable right now. Please try again.' }, { status: 503 });
  }
}
