// Finding a place in Agra by name or pincode from the shop's own local index (the same one the mobile app uses). Pure: no network, no framework.
// OpenStreetMap's public search does not know many Agra colonies by name ("Awas Vikas Colony", "Vijay Nagar") and, unbounded, answers with
// towns of the same name in other cities, so the local index goes first and the online search only adds streets and landmarks inside Agra.

export interface LocalityRecord {
  n: string;
  la: number;
  ln: number;
  /** extent in metres */
  r: number;
  k: 'colony' | 'sector' | 'area';
  /** how many independent map features carry this name */
  s: number;
  p?: string;
}
export interface PincodePoint { p: string; la: number; ln: number }
export interface PostalArea { n: string; p: string }
export interface PlaceIndex { localities: LocalityRecord[]; pincodes: PincodePoint[]; postalAreas: PostalArea[] }

export interface FoundPlace {
  label: string;
  lat: number;
  lng: number;
  postcode: string | null;
  locality: string | null;
}

/** "Awas-Vikas Colony " -> "awas vikas colony" */
export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// the same name is spelled several ways in Agra
const SPELLING: Record<string, string> = { avas: 'awas', aavas: 'awas', vikaas: 'vikas', nagr: 'nagar', colny: 'colony' };
const canonical = (text: string) => normalize(text).split(' ').map((w) => SPELLING[w] ?? w).join(' ');

const NOISE = new Set(['agra', 'up', 'uttar', 'pradesh', 'india', 'near', 'in', 'at']);

function pincodeCentre(index: PlaceIndex, pin: string): { lat: number; lng: number } | null {
  const points = index.pincodes.filter((p) => p.p === pin);
  if (points.length === 0) return null;
  const lat = points.reduce((sum, p) => sum + p.la, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.ln, 0) / points.length;
  return { lat, lng };
}

/** Localities (and pincodes) matching what was typed, best first. Every typed word must start a word of the locality's name. */
export function searchLocalities(index: PlaceIndex, query: string, limit = 6): FoundPlace[] {
  const typed = canonical(query);
  if (typed.length < 2) return [];

  // a 6-digit pincode: the centre of that pincode and the post-office areas it covers
  const pin = /^\d{6}$/.exec(typed.replace(/\s+/g, ''))?.[0];
  if (pin) {
    const centre = pincodeCentre(index, pin);
    if (!centre) return [];
    // only the centre of the pincode is known, so only that is offered: no street or area name is guessed
    return [{ label: `Pincode ${pin}, Agra`, lat: centre.lat, lng: centre.lng, postcode: pin, locality: null }];
  }

  const words = typed.split(' ').filter((w) => w && !NOISE.has(w));
  if (words.length === 0) return [];

  const scored = new Map<string, { record: LocalityRecord; score: number }>();
  for (const record of index.localities) {
    const name = canonical(record.n);
    const nameWords = name.split(' ');
    if (!words.every((w) => nameWords.some((nw) => nw.startsWith(w)))) continue;
    // exact name > name starts with the typed words > the words appear elsewhere in the name; more map features carrying the name = more trustworthy
    let score = name === words.join(' ') ? 100 : name.startsWith(words.join(' ')) ? 60 : 30;
    score += Math.min(record.s, 5) + (record.k === 'colony' || record.k === 'sector' ? 2 : 0);
    const key = name; // the same colony appears several times (different map features): keep the best one
    const have = scored.get(key);
    if (!have || score > have.score) scored.set(key, { record, score });
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.record.n.localeCompare(b.record.n))
    .slice(0, limit)
    .map(({ record }) => {
      const postal = index.postalAreas.find((a) => canonical(a.n) === canonical(record.n));
      const postcode = record.p ?? postal?.p ?? null;
      return { label: `${record.n}, Agra`, lat: record.la, lng: record.ln, postcode, locality: record.n };
    });
}

/** Two results closer than this are the same place (used to merge local and online answers). */
export function sameSpot(a: { lat: number; lng: number }, b: { lat: number; lng: number }, meters = 150): boolean {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) <= meters;
}
