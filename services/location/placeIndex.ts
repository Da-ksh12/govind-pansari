// A local gazetteer of Agra: streets, colonies/sectors, landmarks and pincodes, answered with plain geometry — no network, instant.
// The data is built by scripts/build-agra-places.mjs from OpenStreetMap, India Post and Wikidata (see data/README.md) and can be
// extended by the owner in data/agraPlaces.extra.json. The app's own stores (owner-managed) are passed in as extra anchors.
//
// What it is for: OpenStreetMap's reverse lookup answers a pin in Vijay Nagar with the one big administrative suburb it knows
// ("Civil Lines", ~4 km wide) and has no feature called Vijay Nagar at all. This answers with the CLOSEST named block, the
// nearest street, a landmark to give directions by, and a pincode — each only with evidence, never a guess.

import { anchorsFromStores, distanceMeters, nearestLocalities, type Locality, type NearbyLocality } from './localityIndex';

export interface StreetRecord {
  /** The road's name. */
  n: string;
  /** Its line as [lat, lng] points. */
  p: [number, number][];
}

export interface LandmarkRecord {
  n: string;
  la: number;
  ln: number;
  /** temple / mosque / church / school / college / hospital / market / bank / fuel / police / station / park / hotel / mall … */
  t: string;
}

export interface LocalityRecord {
  n: string;
  la: number;
  ln: number;
  /** Extent in metres. */
  r: number;
  /** colony / sector / area */
  k: 'colony' | 'sector' | 'area';
  /** How many independent map features carry this name. */
  s: number;
  /** Pincode, when a post-office area of the same name gives one. */
  p?: string;
}

export interface PincodeEvidence {
  p: string;
  la: number;
  ln: number;
}

/** India Post post-office area names with their pincode (names only; no coordinates). */
export interface PostalArea {
  n: string;
  p: string;
}

export interface PlaceData {
  localities: LocalityRecord[];
  streets: StreetRecord[];
  landmarks: LandmarkRecord[];
  pincodes: PincodeEvidence[];
  postalAreas: PostalArea[];
}

export const EMPTY_PLACE_DATA: PlaceData = { localities: [], streets: [], landmarks: [], pincodes: [], postalAreas: [] };

// ---------------------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------------------

/** Spelling-insensitive key for place names: "Avas Vikas Colony" = "Awas Vikas Colony", "Kamala Nagar (Agra)" = "Kamla Nagar". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(agra|uttar pradesh|up)\b/g, ' ')
    .replace(/awas\b/g, 'avas')
    .replace(/aavas\b/g, 'avas')
    .replace(/kamala\b/g, 'kamla')
    .replace(/shahaganj|shahganj/g, 'shahganj')
    .replace(/taj\s*ganj/g, 'tajganj')
    .replace(/dayal\s*bagh|dayalbagh/g, 'dayalbagh')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The pincode for an area name, when a post-office area of that name exists ("Avas Vikas Colony Sector 11" is inside "Avas Vikas Colony"). */
export function pinForName(name: string, areas: readonly PostalArea[]): string | null {
  // "Sector 11, Awas Vikas Colony" names the parent after a comma: try the whole name and each comma-separated part.
  const keys = [name, ...name.split(',')].map(normalizeName).filter(Boolean);
  let best: PostalArea | null = null;
  let bestLen = 0;
  for (const key of keys) {
    for (const a of areas) {
      const ak = normalizeName(a.n);
      if (!ak) continue;
      if ((key === ak || key.startsWith(`${ak} `)) && ak.length > bestLen) {
        best = a;
        bestLen = ak.length;
      }
    }
  }
  return best?.p ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Streets
// ---------------------------------------------------------------------------------------------------------------------------

const M_PER_DEG_LAT = 111_320;

/** Distance in metres from a point to a polyline, using a local flat projection (exact enough at city scale). */
export function distanceToPolyline(lat: number, lng: number, line: readonly [number, number][]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  const kx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const px = 0;
  const py = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i]![1] - lng) * kx;
    const ay = (line[i]![0] - lat) * M_PER_DEG_LAT;
    if (i === line.length - 1) {
      best = Math.min(best, Math.hypot(ax - px, ay - py));
      break;
    }
    const bx = (line[i + 1]![1] - lng) * kx;
    const by = (line[i + 1]![0] - lat) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}

export interface NearestStreet {
  name: string;
  distanceM: number;
}

/** The named road closest to the position, if one is within `maxMeters` (default 60 m — the pin is practically on it). */
export function nearestStreet(position: { lat: number; lng: number }, streets: readonly StreetRecord[], maxMeters = 60): NearestStreet | null {
  let best: NearestStreet | null = null;
  for (const s of streets) {
    // cheap reject: every point of the line far away in latitude
    const d = distanceToPolyline(position.lat, position.lng, s.p);
    if (d <= maxMeters && (!best || d < best.distanceM)) best = { name: s.n, distanceM: Math.round(d) };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------------------------------------------------------

export interface NearbyLandmark {
  name: string;
  type: string;
  distanceM: number;
}

/** Landmarks within `maxMeters` (default 250 m), nearest first — what a rider would say: "near Durga Mandir". */
export function nearbyLandmarks(position: { lat: number; lng: number }, landmarks: readonly LandmarkRecord[], maxMeters = 250, limit = 3): NearbyLandmark[] {
  return landmarks
    .map((l) => ({ name: l.n, type: l.t, distanceM: Math.round(distanceMeters(position.lat, position.lng, l.la, l.ln)) }))
    .filter((l) => l.distanceM <= maxMeters)
    .sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Pincode
// ---------------------------------------------------------------------------------------------------------------------------

export interface PincodeAnswer {
  pin: string;
  /** What the answer rests on, for display and for tests. */
  basis: 'area-name' | 'nearby-addresses';
  from: string;
  distanceM: number;
}

/** A pincode only counts as "the same neighbourhood" within this distance of the post-office area it belongs to. */
export const PIN_AREA_MAX_METERS = 1_200;
/** Postcodes written on map features count when they are this close to the pin… */
export const PIN_NEARBY_MAX_METERS = 600;
/** …there are at least this many of them… */
export const PIN_NEARBY_MIN_POINTS = 3;
/** …and this share of them (weighted by closeness) agree. */
export const PIN_NEARBY_MIN_SHARE = 0.7;

/**
 * Where a pincode comes from, strongest first:
 *  1. postcodes written on real map features within 600 m — at least 3, and 70% of them agree (the people who mapped those places
 *     wrote the pincode of that very spot);
 *  2. the nearest named area that India Post gives a pincode (Kamla Nagar → 282004), within 1.2 km — its name is the evidence;
 *  3. nothing. A wrong pincode on an address is worse than a blank one.
 * When the two sources disagree the nearby addresses win: they describe this spot, the area name only describes the neighbourhood.
 */
export function pincodeAt(position: { lat: number; lng: number }, localities: readonly Locality[], evidence: readonly PincodeEvidence[]): PincodeAnswer | null {
  const near = evidence
    .map((e) => ({ pin: e.p, d: distanceMeters(position.lat, position.lng, e.la, e.ln) }))
    .filter((e) => e.d <= PIN_NEARBY_MAX_METERS && /^\d{6}$/.test(e.pin));
  if (near.length >= PIN_NEARBY_MIN_POINTS) {
    const weight = new Map<string, number>();
    let total = 0;
    for (const e of near) {
      const w = 1 / (e.d + 50); // nearer addresses count for more
      weight.set(e.pin, (weight.get(e.pin) ?? 0) + w);
      total += w;
    }
    const [topPin, topWeight] = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (topWeight / total >= PIN_NEARBY_MIN_SHARE) {
      const agreeing = near.filter((e) => e.pin === topPin);
      const nearest = agreeing.reduce((x, y) => (x.d <= y.d ? x : y));
      return { pin: topPin, basis: 'nearby-addresses', from: `${agreeing.length} nearby addresses`, distanceM: Math.round(nearest.d) };
    }
  }

  let area: PincodeAnswer | null = null;
  for (const l of localities) {
    if (!l.pin || !/^\d{6}$/.test(l.pin)) continue;
    const d = distanceMeters(position.lat, position.lng, l.lat, l.lng);
    const edge = Math.max(0, d - l.radiusM);
    if (edge <= PIN_AREA_MAX_METERS && (!area || d < area.distanceM)) area = { pin: l.pin, basis: 'area-name', from: l.name, distanceM: Math.round(d) };
  }
  return area;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------------------------------------------------------

export interface PlaceDescription {
  street: NearestStreet | null;
  /** The closest named block (a colony/sector/area, or a store's own colony). */
  locality: NearbyLocality | null;
  landmarks: NearbyLandmark[];
  pincode: PincodeAnswer | null;
}

export interface IndexedPlaces {
  data: PlaceData;
  localities: Locality[];
}

/** Turns the compact stored records into the shapes the lookups use, naming each locality's pincode from the post-office list. */
export function indexPlaces(data: PlaceData, stores: readonly { addressLine: string; lat: number; lng: number }[] = []): IndexedPlaces {
  const fromData: Locality[] = data.localities.map((l) => ({
    name: l.n,
    lat: l.la,
    lng: l.ln,
    radiusM: l.r,
    kind: l.k,
    support: l.s,
    pin: l.p ?? pinForName(l.n, data.postalAreas) ?? undefined,
  }));
  const anchors = anchorsFromStores(stores).map((a) => ({ ...a, pin: pinForName(a.name, data.postalAreas) ?? undefined }));
  return { data, localities: [...anchors, ...fromData] };
}

export function describePlace(position: { lat: number; lng: number }, places: IndexedPlaces): PlaceDescription {
  return {
    street: nearestStreet(position, places.data.streets),
    locality: nearestLocalities(position, places.localities, { limit: 1, maxMeters: 1_200 })[0] ?? null,
    landmarks: nearbyLandmarks(position, places.data.landmarks),
    pincode: pincodeAt(position, places.localities, places.data.pincodes),
  };
}
