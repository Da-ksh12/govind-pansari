// "You are near Civil Lines" — for a customer standing in Vijay Nagar. OpenStreetMap's reverse lookup answers with the one big
// administrative suburb it knows (Civil Lines is a ~4 km area), and has no feature called Vijay Nagar at all. This module answers
// from a LOCAL list of Agra's real colonies and areas instead, so the label is the closest block the customer would recognise.
//
// The list comes from three places (see data/README and scripts/build-agra-localities.mjs):
//   * OpenStreetMap: named place points plus colony/nagar/sector names found on roads, crossings, parks and shops;
//   * India Post: the post-office areas and the pincode each belongs to (pincodes are only ever taken from here);
//   * the app's own stores table: "Vijay Nagar Colony, Agra" at the store's coordinates (owner-managed, passed in at run time).
// Everything is plain data plus great-circle distance: no network, instant, free, and testable.

export interface Locality {
  name: string;
  lat: number;
  lng: number;
  /** About how far the named block extends from its centre, in metres. */
  radiusM: number;
  kind: 'store' | 'sector' | 'colony' | 'area' | 'postal';
  /** How many independent map features carry this name (more = more trustworthy). */
  support: number;
  /** Postal code of the area, when India Post gives one for it. */
  pin?: string;
}

export interface NearbyLocality {
  name: string;
  /** Distance from the position to the block's centre, metres. */
  distanceM: number;
  /** The position lies within the block's own extent. */
  inside: boolean;
  kind: Locality['kind'];
  pin?: string;
}

const EARTH_M = 6_371_000;

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Farther than this and a named block is not "near" the customer any more — no label is better than a wrong one. */
export const MAX_NEARBY_METERS = 2_000;

/** Most specific first: a sector inside a colony, then the owner's own store colony, then a mapped colony, then a wide area. */
/** An area at least this wide is a whole suburb, not a block. */
export const BROAD_AREA_METERS = 800;
/** How much worse than a nearby specific block a suburb the pin is merely inside ranks, in metres. */
export const BROAD_AREA_PENALTY_METERS = 600;

const KIND_RANK: Record<Locality['kind'], number> = { sector: 0, store: 1, colony: 2, area: 3, postal: 4 };

/**
 * The named blocks closest to a position, best first. A block the position is INSIDE beats one it is merely near; otherwise the
 * smaller the gap between the position and the block's edge, the better. Ties go to the more specific kind, then the better supported.
 */
export function nearestLocalities(
  position: { lat: number; lng: number },
  localities: readonly Locality[],
  options: { limit?: number; maxMeters?: number } = {},
): NearbyLocality[] {
  const limit = options.limit ?? 3;
  const maxMeters = options.maxMeters ?? MAX_NEARBY_METERS;
  const scored = localities
    .map((l) => {
      const distanceM = distanceMeters(position.lat, position.lng, l.lat, l.lng);
      const inside = distanceM <= l.radiusM;
      // A huge suburb (Civil Lines is ~900 m across) says almost nothing about where the customer is: standing inside one must not beat a
      // real colony a few hundred metres away, so it only counts as a last resort.
      const broad = l.kind === 'area' && l.radiusM >= BROAD_AREA_METERS;
      const gap = broad ? Math.max(BROAD_AREA_PENALTY_METERS, distanceM - l.radiusM) : Math.max(0, distanceM - l.radiusM);
      return { l, distanceM, gap, inside, ordersAsInside: inside && !broad };
    })
    .filter((s) => s.distanceM <= maxMeters || s.inside)
    .sort((a, b) => {
      if (a.ordersAsInside !== b.ordersAsInside) return a.ordersAsInside ? -1 : 1;
      if (a.ordersAsInside && b.ordersAsInside) {
        // Inside several blocks at once: the most specific kind, then the one the position is deepest in (closest to its centre, relative to its size).
        if (KIND_RANK[a.l.kind] !== KIND_RANK[b.l.kind]) return KIND_RANK[a.l.kind] - KIND_RANK[b.l.kind];
        const depthA = a.distanceM / Math.max(1, a.l.radiusM);
        const depthB = b.distanceM / Math.max(1, b.l.radiusM);
        if (depthA !== depthB) return depthA - depthB;
      }
      if (a.gap !== b.gap) return a.gap - b.gap;
      if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
      if (KIND_RANK[a.l.kind] !== KIND_RANK[b.l.kind]) return KIND_RANK[a.l.kind] - KIND_RANK[b.l.kind];
      return b.l.support - a.l.support;
    });

  const seen = new Set<string>();
  const out: NearbyLocality[] = [];
  for (const s of scored) {
    const key = s.l.name.toLowerCase();
    if (seen.has(key)) continue; // the same name listed twice (e.g. a store anchor and a map feature) counts once
    seen.add(key);
    out.push({ name: s.l.name, distanceM: Math.round(s.distanceM), inside: s.inside, kind: s.l.kind, pin: s.l.pin });
    if (out.length >= limit) break;
  }
  return out;
}

/** "Vijay Nagar Colony" when the customer is inside it, "Near Kamla Nagar · 650 m" when they are just outside. */
export function describeNearby(n: NearbyLocality): { title: string; detail: string | null } {
  if (n.inside) return { title: n.name, detail: null };
  const m = n.distanceM >= 950 ? `${(Math.round(n.distanceM / 100) / 10).toFixed(1)} km` : `${Math.round(n.distanceM / 50) * 50} m`;
  return { title: `Near ${n.name}`, detail: m };
}

/**
 * A store's own address line is a place name the owner chose and maintains: "Vijay Nagar Colony, Agra" at its coordinates.
 * That is the most trustworthy fact about its surroundings, and exactly what the map data lacks for Vijay Nagar.
 */
export function anchorsFromStores(stores: readonly { addressLine: string; lat: number; lng: number }[]): Locality[] {
  const out: Locality[] = [];
  for (const s of stores) {
    const name = (s.addressLine ?? '').split(',')[0]?.trim();
    if (!name || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    out.push({ name, lat: s.lat, lng: s.lng, radiusM: 450, kind: 'store', support: 99 });
  }
  return out;
}

/** The single best label for a position, or null when nothing known is close enough to say anything useful. */
export function bestLocality(position: { lat: number; lng: number }, localities: readonly Locality[]): NearbyLocality | null {
  return nearestLocalities(position, localities, { limit: 1 })[0] ?? null;
}

/**
 * A pincode for a position, only with real evidence: the nearest post-office area that has one, close enough to be the same
 * neighbourhood. A wrong pincode saved on an address is worse than none, so there is no guessing beyond that distance.
 */
export const MAX_PIN_DISTANCE_METERS = 1_500;

export function pincodeFor(position: { lat: number; lng: number }, localities: readonly Locality[]): { pin: string; from: string; distanceM: number } | null {
  let best: { pin: string; from: string; distanceM: number } | null = null;
  for (const l of localities) {
    if (!l.pin || !/^\d{6}$/.test(l.pin)) continue;
    const d = distanceMeters(position.lat, position.lng, l.lat, l.lng);
    if (d <= MAX_PIN_DISTANCE_METERS && (!best || d < best.distanceM)) best = { pin: l.pin, from: l.name, distanceM: Math.round(d) };
  }
  return best;
}
