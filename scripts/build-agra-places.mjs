#!/usr/bin/env node
/**
 * Builds data/agraPlaces.json — Agra's streets, colonies/sectors/areas, landmarks and pincode evidence — from raw extracts fetched by
 *   scripts/fetch-agra-osm.mjs   (OpenStreetMap via Overpass)   and   scripts/fetch-india-post.mjs   (India Post post-office names),
 * plus the GeoNames postal-code file and a small Wikidata query (see data/README.md). Deterministic: same inputs → same file.
 *
 *   node --no-warnings --import ./tests/unit/register-ts-resolver.mjs scripts/build-agra-places.mjs
 *
 * Nothing is invented. Every locality records how many independent map features carry its name; a pincode is attached to a locality
 * only when a post-office area of the same name exists (India Post), never guessed from coordinates.
 */
import fs from 'node:fs';
import { normalizeName, pinForName } from '../services/location/placeIndex.ts';

const read = (path) => (fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null);
const elements = (...paths) => paths.flatMap((p) => read(p)?.elements ?? []);
const round = (n, p = 5) => Math.round(n * 10 ** p) / 10 ** p;
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
const centerOf = (e) => ({ lat: +(e.center?.lat ?? e.lat), lng: +(e.center?.lon ?? e.lon) });
const BOX = { south: 27.07, west: 77.85, north: 27.33, east: 78.15 };
const inBox = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat >= BOX.south && c.lat <= BOX.north && c.lng >= BOX.west && c.lng <= BOX.east;

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(\-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/\bA\.v\./g, 'A.V.')
    .replace(/\bSec\b\.?\s*(\d+)/gi, (_, n) => `Sector ${n}`)
    .replace(/\bAvaas\b|\bAvas\b/g, 'Awas')
    .replace(/\s+/g, ' ')
    .trim();

// ---- seen-once bookkeeping ----------------------------------------------------------------------------------------------------
const dedupeById = (list) => {
  const seen = new Set();
  return list.filter((e) => (seen.has(`${e.type}${e.id}`) ? false : seen.add(`${e.type}${e.id}`)));
};

// ================================================================ STREETS
const JUNK_STREET = /^(i|vi|b|p|baba|sonu|nala|flyover|flyover ramp|cross|joining road|residential road|master plane road|gas godaam|monu road|aman road|sorav road|joining|road|lane|gali|service road|link road|main road|bypass)$/i;
const GENERIC_GALI = /^(gali|lane)\b.*\b(no\.?|number)?\s*\d+$/i;

function simplify(points, toleranceM) {
  if (points.length <= 2) return points;
  const kx = 111_320 * Math.cos((points[0][0] * Math.PI) / 180);
  const dist = (p, a, b) => {
    const px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * 111_320, bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * 111_320;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    return Math.hypot(px - t * bx, py - t * by);
  };
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dist(points[i], points[s], points[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > toleranceM && idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

const streets = [];
for (const w of read('.cache/osm/streets.json')?.elements ?? []) {
  const raw = String(w.tags?.name ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length < 4 || JUNK_STREET.test(raw) || GENERIC_GALI.test(raw)) continue;
  const line = (w.geometry ?? []).map((g) => [round(g.lat), round(g.lon)]).filter(([la, ln]) => inBox({ lat: la, lng: ln }));
  if (line.length < 2) continue;
  streets.push({ n: raw === raw.toLowerCase() ? titleCase(raw) : raw, p: simplify(line, 5) });
}
streets.sort((a, b) => a.n.localeCompare(b.n) || a.p[0][0] - b.p[0][0]);

// ================================================================ LANDMARKS
const LANDMARK_FILES = ['worshipW', 'worshipE', 'education', 'health', 'civic', 'leisure', 'places'].map((n) => `.cache/osm/${n}.json`);
function landmarkType(t) {
  if (t.amenity === 'place_of_worship') {
    const r = (t.religion ?? '').toLowerCase();
    if (r === 'hindu' || /mandir|temple|devi|shiv|hanuman|ram|krishna|mata|dham/i.test(t.name)) return 'temple';
    if (r === 'muslim' || /masjid|mosque|dargah|idgah/i.test(t.name)) return 'mosque';
    if (r === 'christian' || /church|cathedral/i.test(t.name)) return 'church';
    if (r === 'sikh' || /gurudwara|gurdwara/i.test(t.name)) return 'gurudwara';
    return 'place of worship';
  }
  if (/^(school|kindergarten)$/.test(t.amenity)) return 'school';
  if (/^(college|university)$/.test(t.amenity)) return 'college';
  if (/^(hospital|clinic)$/.test(t.amenity)) return 'hospital';
  if (t.amenity === 'pharmacy') return 'pharmacy';
  if (t.amenity === 'marketplace') return 'market';
  if (/^(bank|fuel|police|library|post_office)$/.test(t.amenity)) return t.amenity === 'post_office' ? 'post office' : t.amenity;
  if (t.amenity === 'bus_station') return 'bus stand';
  if (/^(community_centre|townhall|fire_station|courthouse)$/.test(t.amenity)) return t.amenity.replace('_', ' ');
  if (/^(park|garden|playground)$/.test(t.leisure)) return 'park';
  if (/^(stadium|sports_centre)$/.test(t.leisure)) return 'stadium';
  if (/^(station|halt)$/.test(t.railway)) return 'railway station';
  if (/^(hotel|guest_house)$/.test(t.tourism)) return 'hotel';
  if (/^(attraction|museum)$/.test(t.tourism)) return 'attraction';
  if (/^(mall|supermarket|department_store)$/.test(t.shop)) return 'mall';
  return null;
}
const landmarks = [];
{
  const seen = [];
  for (const e of dedupeById(elements(...LANDMARK_FILES))) {
    const name = String(e.tags?.name ?? '').replace(/\s+/g, ' ').trim();
    const c = centerOf(e);
    const type = landmarkType(e.tags ?? {});
    if (!type || name.length < 4 || !inBox(c)) continue;
    // the same place mapped twice (a point and its building) counts once
    if (seen.some((s) => s.name.toLowerCase() === name.toLowerCase() && meters(s, c) < 150)) continue;
    seen.push({ name, ...c });
    landmarks.push({ n: name, la: round(c.lat), ln: round(c.lng), t: type });
  }
  landmarks.sort((a, b) => a.t.localeCompare(b.t) || a.n.localeCompare(b.n));
}

// ================================================================ LOCALITIES
// "Sector 11", "Sec 16 A", "Sector-07": the letter is only a sub-sector when it stands alone ("Sector 11 A.V.colony" has none).
const SECTOR_RE = /\bsec(?:tor)?\.?\s*-?\s*0*(\d{1,2})(?:\s+([A-D]))?(?![\w.])/i;
// words that mean "a facility", never part of a colony's own name
const NOT_A_COLONY = /\b(school|vidyalaya|hospital|nursing|home|depot|office|wala|shortcut|to|of|via|opp|opposite|near|tank|tanki|sadan|seva|water|field|fields|college|temple|mandir|masjid|church|market|park|hotel|bank|police|chowki|stand|pump|centre|center|store|shop|hostel|garage|godown|factory|mill|bhawan|bhavan|stadium|library|cinema|petrol|dairy|dhaba|restaurant|bakery|sweets|studio|clinic|lab|pathology|gali|lane|block|gate|crossing|flyover|biodiversity|depo)\b/i;
const sectorName = (m) => `Sector ${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ''}`;

const PLACE_RADIUS = { suburb: 900, neighbourhood: 500, quarter: 500, borough: 700, locality: 400, village: 600, hamlet: 300, town: 900, city_block: 250 };
const GENERIC = new Set(['agra', 'agra city', 'uttar pradesh', 'india']);
const localities = [];
let sectorPlacePoints; // filled while reading place points; merged into the colony groups below

// 1. named place points/areas (OpenStreetMap)
for (const e of dedupeById(elements('.cache/osm/places.json', '.cache/agra-places-raw.json'))) {
  const name = String(e.tags?.name ?? '').trim();
  const kind = e.tags?.place;
  if (!kind || !(kind in PLACE_RADIUS)) continue;
  const c = centerOf(e);
  if (!name || GENERIC.has(name.toLowerCase()) || !inBox(c)) continue;
  // a place point called "Sec 16 A" is a sector: it joins the same group as the roads and parks that mention it
  const sm = name.match(SECTOR_RE);
  if (sm) {
    (sectorPlacePoints ??= []).push({ name: sectorName(sm), parentAV: false, mentionsAV: false, ...c });
    continue;
  }
  localities.push({ n: titleCase(name), la: round(c.lat), ln: round(c.lng), r: PLACE_RADIUS[kind], k: 'area', s: 1 });
}

// 2. Wikidata neighbourhoods / settlements
for (const w of read('.cache/osm/wikidata.json') ?? []) {
  if (!inBox({ lat: w.lat, lng: w.lng }) || GENERIC.has(w.name.toLowerCase())) continue;
  localities.push({ n: w.name, la: round(w.lat), ln: round(w.lng), r: /neigh/i.test(w.type) ? 500 : 600, k: 'area', s: 1 });
}

// 3. colony / sector names carried by roads, crossings, parks, temples, shops …
const FACILITY = /\b(road|rd|marg|chauraha|chowk|crossing|station|market|flyover|gate|park|mandir|temple|masjid|school|hospital|bridge|stand|mod|tiraha|line|ghat|tv|bus|stop|petrol|pump|chauk|puliya|underpass|overbridge|field|fields|main|bazar|bazaar|dharamshala|college|vidyalaya|chowki)\b\.?$/i;
const COLONY_WORD = /\b(nagar|colony|vihar|puram|enclave|enkleve|kunj|bagh|ganj|pura|extension|awas|avas|aavas|vikas|viksh|sector\s*\d+|sec\.?\s*\d+|phase\s*\d+|mohalla|vatika|khand|puri|dham)\b/i;
const STOP = new Set(['nagar nigam', 'agra nagar nigam', 'colony park', 'colony', 'nagar', 'sector', 'park colony', 'awas vikas', 'vikas']);
const AV_MENTION = /a\.?\s?v\.?\s*colony|a\.?v\.?\s*colony|av(?:a|aa)s\s+vik(?:a|s)h?s?(?:\s+colony)?|awas\s+vikas/i;

function colonyNamesIn(raw) {
  const out = [];
  const whole = String(raw);
  const mentionsAV = AV_MENTION.test(whole);
  for (const part of whole.split(/[,;/]| - |\(|\)/)) {
    let p = part.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    // A sector reference IS the place, whatever surrounds it: "Holi Public School Sector 4" → "Sector 4".
    const sm = p.match(SECTOR_RE);
    if (sm) {
      out.push({ name: sectorName(sm), parentAV: mentionsAV, mentionsAV });
      continue;
    }
    for (let i = 0; i < 3 && FACILITY.test(p); i++) p = p.replace(FACILITY, '').trim();
    p = p.replace(/\bagra\b\.?$/i, '').trim();
    p = p.replace(/^\d+[-\s]*(futa|feet|foot|ft)\b\s*/i, '').trim(); // "100 Futa Kedar Nagar" → "Kedar Nagar"
    if (!/^[A-Za-z]/.test(p) || p.length < 4 || p.length > 42 || !COLONY_WORD.test(p) || NOT_A_COLONY.test(p)) continue;
    const t = titleCase(p);
    if (STOP.has(t.toLowerCase())) continue;
    if (t.split(' ').length < 2) continue;
    out.push({ name: t, parentAV: false, mentionsAV });
  }
  return out;
}

const groups = new Map(); // lowercase name → members
for (const e of dedupeById(elements('.cache/osm/colonies.json', '.cache/agra-named.json', '.cache/osm/addrplace.json'))) {
  const c = centerOf(e);
  if (!inBox(c)) continue;
  const names = [...colonyNamesIn(e.tags?.name ?? ''), ...['addr:suburb', 'addr:neighbourhood', 'addr:place'].flatMap((k) => (e.tags?.[k] ? colonyNamesIn(e.tags[k]).concat(GENERIC.has(String(e.tags[k]).toLowerCase()) ? [] : [{ name: titleCase(e.tags[k]), parentAV: false }]) : []))];
  for (const nm of names) {
    const key = nm.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...nm, ...c });
  }
}
for (const sp of sectorPlacePoints ?? []) {
  const key = sp.name.toLowerCase();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(sp);
}

// Where Awas Vikas is, from the evidence: every map feature whose own text says Awas Vikas / A.V. Colony.
const avItems = [...groups.values()].flat().filter((i) => i.mentionsAV);
const avCentre = avItems.length >= 3 ? { lat: avItems.reduce((s, i) => s + i.lat, 0) / avItems.length, lng: avItems.reduce((s, i) => s + i.lng, 0) / avItems.length } : null;
const AV_NAME = 'Awas Vikas Colony';
const AV_SECTOR_REACH_M = 2000;
for (const list of groups.values()) {
  const clusters = [];
  for (const m of list) {
    let home = clusters.find((cl) => meters(cl.centre, m) <= 1200);
    if (!home) clusters.push((home = { items: [], centre: { lat: m.lat, lng: m.lng } }));
    home.items.push(m);
    home.centre = { lat: home.items.reduce((s, i) => s + i.lat, 0) / home.items.length, lng: home.items.reduce((s, i) => s + i.lng, 0) / home.items.length };
  }
  for (const cl of clusters) {
    const spread = cl.items.map((i) => meters(cl.centre, i)).sort((a, b) => a - b);
    const p90 = spread[Math.min(spread.length - 1, Math.floor(spread.length * 0.9))];
    const isSector = /^sector/i.test(cl.items[0].name);
    // a sector is in Awas Vikas when a feature says so, or when it lies within 2 km of where Awas Vikas features cluster
    const parentAV = isSector && (cl.items.some((i) => i.parentAV) || (!!avCentre && meters(cl.centre, avCentre) <= AV_SECTOR_REACH_M));
    localities.push({
      n: isSector && parentAV ? `${cl.items[0].name}, ${AV_NAME}` : cl.items[0].name,
      la: round(cl.centre.lat),
      ln: round(cl.centre.lng),
      r: Math.round(Math.min(isSector ? 450 : 800, Math.max(isSector ? 150 : 200, p90 + 150))),
      k: isSector ? 'sector' : 'colony',
      s: cl.items.length,
    });
  }
}

// ================================================================ POSTAL: India Post names + GeoNames, pincode evidence from map tags
const postalAreas = [];
{
  const seen = new Set();
  const add = (n, p) => {
    const key = `${normalizeName(n)}|${p}`;
    if (!n || !/^\d{6}$/.test(p) || seen.has(key)) return;
    seen.add(key);
    postalAreas.push({ n: n.replace(/\s*\(Agra\)\s*/i, '').trim(), p });
  };
  const post = read('.cache/osm/india-post.json') ?? {};
  for (const [pin, offices] of Object.entries(post)) for (const o of offices) if (/agra|^$/i.test(o.district ?? 'Agra') || true) add(o.name, pin);
  const gn = '.cache/geonames/postal4/IN.txt';
  if (fs.existsSync(gn)) {
    for (const line of fs.readFileSync(gn, 'utf8').split('\n')) {
      const r = line.split('\t');
      if (r.length < 11) continue;
      const c = { lat: +r[9], lng: +r[10] };
      if (inBox(c)) add(r[2], r[1]);
    }
  }
  postalAreas.sort((a, b) => a.p.localeCompare(b.p) || a.n.localeCompare(b.n));
}
// a locality takes the pincode of the post-office area it is named after
for (const l of localities) {
  const pin = pinForName(l.n, postalAreas);
  if (pin) l.p = pin;
}

const pincodes = [];
for (const e of dedupeById(elements('.cache/osm/postcodes.json', '.cache/osm/addrplace.json'))) {
  const c = centerOf(e);
  const pin = String(e.tags?.['addr:postcode'] ?? e.tags?.postal_code ?? '').replace(/\s/g, '');
  if (!inBox(c) || !/^2[0-9]{5}$/.test(pin)) continue; // Uttar Pradesh pincodes start with 2
  pincodes.push({ p: pin, la: round(c.lat), ln: round(c.lng) });
}

localities.sort((a, b) => a.n.localeCompare(b.n) || a.la - b.la);
const file = {
  generated: new Date().toISOString().slice(0, 10),
  area: 'Agra, Uttar Pradesh (box 27.07,77.85 – 27.33,78.15)',
  sources: [
    'OpenStreetMap contributors (ODbL), via the Overpass API: named roads, place points, colony/sector names, landmarks, postcode tags',
    'India Post pincode directory (api.postalpincode.in): post-office area names per pincode',
    'GeoNames postal codes (CC-BY 4.0): extra post-office area names',
    'Wikidata (CC0): neighbourhoods and settlements around Agra',
  ],
  localities,
  streets,
  landmarks,
  pincodes,
  postalAreas,
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/agraPlaces.json', JSON.stringify(file));
const size = Math.round(fs.statSync('data/agraPlaces.json').size / 1024);
const kinds = localities.reduce((m, l) => ((m[l.k] = (m[l.k] ?? 0) + 1), m), {});
console.log(`wrote data/agraPlaces.json (${size} KB): ${localities.length} localities ${JSON.stringify(kinds)}, ${streets.length} streets, ${landmarks.length} landmarks, ${pincodes.length} pincode points, ${postalAreas.length} post-office areas`);
