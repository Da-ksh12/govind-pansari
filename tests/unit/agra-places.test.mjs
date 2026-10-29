// "You are near Civil Lines" for a customer in Vijay Nagar. The local Agra place data answers with the CLOSEST colony / sector, the
// nearest street, a landmark and a pincode. Part 1 tests each rule on small synthetic maps; part 2 tests the REAL built data
// (data/agraPlaces.json: OpenStreetMap + India Post + GeoNames + Wikidata) against the real store coordinates read from the live
// stores table on 2026-10-29.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BROAD_AREA_METERS,
  anchorsFromStores,
  bestLocality,
  describeNearby,
  distanceMeters,
  nearestLocalities,
} from '../../services/location/localityIndex.ts';
import {
  describePlace,
  distanceToPolyline,
  indexPlaces,
  nearbyLandmarks,
  nearestStreet,
  normalizeName,
  pincodeAt,
  pinForName,
} from '../../services/location/placeIndex.ts';
import { describeLocalPlace, enrichAddress } from '../../services/location/placeEnrichment.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const metersToLat = (m) => m / 111_320;

// ================================================================== part 1: the rules
const at = (lat, lng) => ({ lat, lng });
const loc = (name, lat, lng, radiusM, kind = 'colony', pin) => ({ name, lat, lng, radiusM, kind, support: 1, pin });

test('distance is real great-circle metres', () => {
  assert.ok(Math.abs(distanceMeters(27.2, 78.0, 27.2 + metersToLat(500), 78.0) - 500) < 2);
  assert.equal(Math.round(distanceMeters(27.2, 78.0, 27.2, 78.0)), 0);
});

test('being INSIDE a block beats being merely near another; nothing beyond 2 km is named', () => {
  const list = [loc('Far Nagar', 27.2, 78.02, 300), loc('Home Colony', 27.2, 78.0, 400)];
  const best = bestLocality(at(27.2 + metersToLat(100), 78.0), list);
  assert.equal(best.name, 'Home Colony');
  assert.equal(best.inside, true);
  assert.equal(bestLocality(at(27.2, 78.2), list), null, 'nothing known is close: no label is better than a wrong one');
});

test('a sector inside a colony wins; the owner\'s store colony beats a mapped colony; deepest-inside breaks ties', () => {
  const pos = at(27.2, 78.0);
  const list = [loc('Mapped Colony', 27.2, 78.0, 600, 'colony'), loc('Store Colony', 27.2, 78.0, 450, 'store'), loc('Sector 11', 27.2, 78.0, 400, 'sector')];
  assert.equal(bestLocality(pos, list).name, 'Sector 11');
  assert.equal(bestLocality(pos, list.slice(0, 2)).name, 'Store Colony');
  const twoColonies = [loc('Wide', 27.2, 78.0 + 0.002, 700, 'colony'), loc('Snug', 27.2, 78.0, 300, 'colony')];
  assert.equal(bestLocality(pos, twoColonies).name, 'Snug', 'the colony the position is deepest in');
});

test('a pin merely inside a HUGE suburb (Civil Lines, ~900 m) does not beat a specific colony a few hundred metres away', () => {
  const civil = loc('Civil Lines', 27.2, 78.0, 900, 'area');
  const small = loc('Kamla Nagar', 27.2 + metersToLat(550), 78.0, 200, 'colony');
  const pos = at(27.2 + metersToLat(300), 78.0); // inside Civil Lines, 250 m from Kamla Nagar's centre (50 m outside its edge)
  assert.ok(civil.radiusM >= BROAD_AREA_METERS);
  assert.equal(bestLocality(pos, [civil, small]).name, 'Kamla Nagar');
  assert.equal(bestLocality(pos, [civil]).name, 'Civil Lines', 'but with nothing else known it is still better than silence');
});

test('the same name from two sources counts once; "Near X · 650 m" is only used outside the block', () => {
  const list = [loc('Kamla Nagar', 27.2, 78.0, 200, 'colony'), loc('Kamla Nagar', 27.2, 78.001, 200, 'colony')];
  assert.equal(nearestLocalities(at(27.2, 78.0), list, { limit: 5 }).length, 1);
  assert.deepEqual(describeNearby({ name: 'Kamla Nagar', distanceM: 0, inside: true, kind: 'colony' }), { title: 'Kamla Nagar', detail: null });
  assert.deepEqual(describeNearby({ name: 'Kamla Nagar', distanceM: 640, inside: false, kind: 'colony' }), { title: 'Near Kamla Nagar', detail: '650 m' });
  assert.deepEqual(describeNearby({ name: 'X', distanceM: 1250, inside: false, kind: 'colony' }), { title: 'Near X', detail: '1.3 km' });
});

test('a store\'s own address line becomes a trusted anchor with its real coordinates', () => {
  const anchors = anchorsFromStores([{ addressLine: 'Vijay Nagar Colony, Agra', lat: 27.20341, lng: 78.022594 }, { addressLine: '', lat: 1, lng: 1 }, { addressLine: 'X, Agra', lat: NaN, lng: 1 }]);
  assert.equal(anchors.length, 1);
  assert.deepEqual({ name: anchors[0].name, kind: anchors[0].kind, lat: anchors[0].lat }, { name: 'Vijay Nagar Colony', kind: 'store', lat: 27.20341 });
});

test('a store anchor covers only its own surroundings: a mapped colony 1.5 km away is not swallowed by it', () => {
  const [anchor] = anchorsFromStores([{ addressLine: 'Home Colony, Agra', lat: 27.2, lng: 78.0 }]);
  const elsewhere = loc('Elsewhere Colony', 27.2 + metersToLat(1500), 78.0, 400);
  const all = [anchor, elsewhere];
  assert.equal(nearestLocalities(at(27.2 + metersToLat(300), 78.0), all)[0].name, 'Home Colony', 'near the store: its own colony');
  const far = nearestLocalities(at(27.2 + metersToLat(1500), 78.0), all)[0];
  assert.deepEqual({ name: far.name, inside: far.inside }, { name: 'Elsewhere Colony', inside: true });
});

test('spelling variants of a place name match its India Post post office', () => {
  const areas = [{ n: 'Avas Vikas Colony', p: '282007' }, { n: 'Kamala Nagar (Agra)', p: '282004' }, { n: 'Shahaganj (Agra)', p: '282010' }, { n: 'Sanjay Place', p: '282002' }, { n: 'Taj Ganj', p: '282001' }];
  assert.equal(normalizeName('Awas Vikas Colony'), normalizeName('Avas Vikas Colony'));
  assert.equal(pinForName('Awas Vikas Colony', areas), '282007');
  assert.equal(pinForName('Sector 11, Awas Vikas Colony', areas), '282007', 'a sector inside the colony');
  assert.equal(pinForName('Kamla Nagar', areas), '282004');
  assert.equal(pinForName('Shahganj', areas), '282010');
  assert.equal(pinForName('Tajganj', areas), '282001');
  assert.equal(pinForName('Vijay Nagar Colony', areas), null, 'no post office of that name: no pincode by name');
  assert.equal(pinForName('Sanjay Place Road', areas), '282002');
  assert.equal(pinForName('Sanjay Placement', areas), null, 'a prefix of the SPELLING is not a match');
  assert.equal(normalizeName('Shahganj (Old City)'), normalizeName('Shahganj'), 'a bracketed qualifier is not part of the name');
  assert.equal(pinForName('Taj Ganj (East Gate)', areas), '282001');
});

test('streets: distance to the road line, the nearest within 60 m, nothing farther', () => {
  const road = { n: 'Wazirpura Road', p: [[27.2, 78.0], [27.2, 78.002]] }; // runs east–west
  assert.ok(Math.abs(distanceToPolyline(27.2 + metersToLat(30), 78.001, road.p) - 30) < 1);
  assert.ok(Math.abs(distanceToPolyline(27.2, 78.0 - 0.0009, road.p) - 89) < 3, 'beyond the end it is measured to the end point');
  assert.deepEqual(nearestStreet(at(27.2 + metersToLat(25), 78.001), [road]), { name: 'Wazirpura Road', distanceM: 25 });
  assert.equal(nearestStreet(at(27.2 + metersToLat(90), 78.001), [road]), null);
  assert.equal(nearestStreet(at(27.2, 78.0), []), null);
});

test('landmarks: only those within 250 m, nearest first, at most three', () => {
  const marks = [
    { n: 'Far Temple', la: 27.2 + metersToLat(400), ln: 78.0, t: 'temple' },
    { n: 'Near School', la: 27.2 + metersToLat(100), ln: 78.0, t: 'school' },
    { n: 'Nearest Park', la: 27.2 + metersToLat(30), ln: 78.0, t: 'park' },
    { n: 'A Bank', la: 27.2 + metersToLat(200), ln: 78.0, t: 'bank' },
    { n: 'B Bank', la: 27.2 + metersToLat(210), ln: 78.0, t: 'bank' },
  ];
  assert.deepEqual(nearbyLandmarks(at(27.2, 78.0), marks).map((m) => m.name), ['Nearest Park', 'Near School', 'A Bank']);
  // the limit alone must not be what hides a far landmark
  assert.deepEqual(nearbyLandmarks(at(27.2, 78.0), [marks[0], marks[1]]).map((m) => m.name), ['Near School']);
});

test('pincode: nearby tagged addresses first, the post-office area second, otherwise none', () => {
  const evidence = (pin, n, dM) => Array.from({ length: n }, (_, i) => ({ p: pin, la: 27.2 + metersToLat(dM + i * 10), ln: 78.0 }));
  const areas = [loc('Kamla Nagar', 27.2, 78.01, 300, 'colony', '282004')];
  assert.deepEqual(pincodeAt(at(27.2, 78.0), areas, evidence('282002', 3, 200)), { pin: '282002', basis: 'nearby-addresses', from: '3 nearby addresses', distanceM: 200 }, 'addresses right here beat a neighbouring post-office area');
  assert.equal(pincodeAt(at(27.2, 78.0), [], evidence('282002', 2, 200)), null, 'two addresses are not enough');
  assert.equal(pincodeAt(at(27.2, 78.0), [], [...evidence('282002', 2, 200), ...evidence('282004', 2, 220)]), null, 'a split decision is no decision');
  const strong = [...evidence('282004', 5, 100), ...evidence('282002', 1, 500)];
  assert.equal(pincodeAt(at(27.2, 78.0), [], strong).pin, '282004', 'a clear majority wins even with one stray');
  assert.deepEqual(pincodeAt(at(27.2, 78.0 + 0.0001), areas, []).basis, 'area-name');
  assert.equal(pincodeAt(at(27.2, 78.2), areas, []), null, 'too far from any post-office area');
  assert.equal(pincodeAt(at(27.2, 78.0), [loc('Bad', 27.2, 78.0, 100, 'colony', '12345')], []), null, 'a malformed pincode is never used');
});

// ---- the merge with a provider's answer
const PLACES = indexPlaces(
  {
    localities: [{ n: 'Civil Lines', la: 27.2, ln: 78.0, r: 900, k: 'area', s: 1 }, { n: 'Free Ganj', la: 27.2 + metersToLat(600), ln: 78.0, r: 200, k: 'colony', s: 1 }],
    streets: [{ n: 'Local Road', p: [[27.2, 77.999], [27.2, 78.001]] }],
    landmarks: [{ n: 'Durga Mandir', la: 27.2 + metersToLat(80), ln: 78.0, t: 'temple' }],
    pincodes: [],
    postalAreas: [{ n: 'Vijay Nagar Colony', p: '282004' }],
  },
  [{ addressLine: 'Vijay Nagar Colony, Agra', lat: 27.2, lng: 78.0 }],
);
const provider = (over = {}) => ({
  position: at(27.2, 78.0),
  formattedAddress: 'Civil Lines, Agra, Uttar Pradesh, 282003',
  placeId: null, placeName: null, source: 'osm', precision: 'area',
  parts: { street: null, locality: 'Civil Lines', city: 'Agra', state: 'Uttar Pradesh', postalCode: '282003', premise: null, ...over },
});

test('THE BUG: a pin in Vijay Nagar comes back as "Vijay Nagar Colony", not the provider\'s "Civil Lines"', () => {
  const out = enrichAddress(at(27.2, 78.0), provider(), { places: PLACES });
  assert.equal(out.parts.locality, 'Vijay Nagar Colony');
  assert.match(out.formattedAddress, /Vijay Nagar Colony/);
  assert.doesNotMatch(out.formattedAddress, /Civil Lines/);
  assert.equal(out.local.locality.inside, true);
  assert.equal(describeLocalPlace(out.local), 'In Vijay Nagar Colony  ·  Near Durga Mandir · 80 m');
});

test('the area-name pincode (India Post) replaces a provider pincode; the provider\'s street and city are kept', () => {
  const out = enrichAddress(at(27.2, 78.0), provider({ street: 'Provider Road' }), { places: PLACES });
  assert.equal(out.parts.postalCode, '282004');
  assert.deepEqual(out.local.pin, { value: '282004', basis: 'area-name', from: 'Vijay Nagar Colony' });
  assert.equal(out.parts.street, 'Provider Road');
  assert.equal(out.parts.city, 'Agra');
});

test('a street the provider missed is filled from the local list; the house number is NEVER invented', () => {
  const out = enrichAddress(at(27.2, 78.0), provider(), { places: PLACES });
  assert.equal(out.parts.street, 'Local Road');
  assert.equal('houseNo' in out.parts, false);
  assert.equal(out.parts.premise, null);
});

test('a provider answer that is a whole suburb is replaced by a specific colony close by, even just outside it', () => {
  const pos = at(27.2 + metersToLat(300), 78.0);
  const away = indexPlaces({ ...PLACES.data, postalAreas: [] }, []); // no store anchor: only Civil Lines (broad) and Free Ganj
  const out = enrichAddress(pos, provider(), { places: away });
  assert.equal(out.parts.locality, 'Free Ganj');
  assert.equal(out.local.locality.inside, false);
  assert.match(describeLocalPlace(out.local), /^Near Free Ganj · 300 m/);
});

test('a SPECIFIC provider locality is not overridden by a merely-nearby block', () => {
  const pos = at(27.2 + metersToLat(300), 78.0);
  const away = indexPlaces({ ...PLACES.data, postalAreas: [] }, []);
  const out = enrichAddress(pos, provider({ locality: 'Swadhesi Bima Colony, Civil Lines' }), { places: away });
  assert.equal(out.parts.locality, 'Swadhesi Bima Colony, Civil Lines');
});

test('with no provider answer at all, the local data still answers (offline), using the store city', () => {
  const out = enrichAddress(at(27.2, 78.0), null, { places: PLACES, fallbackCity: 'Agra' });
  assert.equal(out.parts.locality, 'Vijay Nagar Colony');
  assert.equal(out.parts.city, 'Agra');
  assert.equal(out.parts.postalCode, '282004');
});

test('where the local data knows nothing, the provider\'s answer comes back unchanged — never worse', () => {
  const empty = indexPlaces({ localities: [], streets: [], landmarks: [], pincodes: [], postalAreas: [] }, []);
  const base = provider();
  const out = enrichAddress(at(27.2, 78.0), base, { places: empty });
  assert.equal(out.parts.locality, 'Civil Lines');
  assert.equal(out.formattedAddress, base.formattedAddress);
  assert.equal(enrichAddress(at(27.2, 78.0), null, { places: empty }), null);
});

// ================================================================== part 2: the real data
const DATA = JSON.parse(readFileSync(file('data/agraPlaces.json'), 'utf8'));
const STORES = [
  { addressLine: 'Vijay Nagar Colony, Agra', lat: 27.20341, lng: 78.022594 },
  { addressLine: 'Awas Vikas Colony, Agra', lat: 27.204239, lng: 77.964982 },
  { addressLine: 'Sanjay Place, Agra', lat: 27.199, lng: 78.0064 },
];
const REAL = indexPlaces(DATA, STORES);
const here = (lat, lng) => describePlace({ lat, lng }, REAL);

test('REAL DATA: a pin at the Vijay Nagar store is "Vijay Nagar Colony" with pincode 282004', () => {
  const d = here(27.20341, 78.022594);
  assert.equal(d.locality.name, 'Vijay Nagar Colony');
  assert.equal(d.locality.inside, true);
  assert.equal(d.pincode.pin, '282004');
});

test('REAL DATA: your own test pin ("North Vijay Nagar Colony") gets the same', () => {
  const d = here(27.203721, 78.021908);
  assert.equal(d.locality.name, 'Vijay Nagar Colony');
  assert.equal(d.pincode.pin, '282004');
});

test('REAL DATA: the provider\'s "Civil Lines" for a Vijay Nagar pin is corrected end to end', () => {
  const out = enrichAddress(at(27.203721, 78.021908), provider(), { places: REAL });
  assert.equal(out.parts.locality, 'Vijay Nagar Colony');
  assert.equal(out.parts.postalCode, '282004');
  assert.doesNotMatch(out.formattedAddress, /Civil Lines/);
});

test('REAL DATA: the Awas Vikas store is in Sector 11, Awas Vikas Colony, pincode 282007', () => {
  const d = here(27.204239, 77.964982);
  assert.equal(d.locality.name, 'Sector 11, Awas Vikas Colony');
  assert.equal(d.pincode.pin, '282007');
});

test('REAL DATA: the Awas Vikas sectors found in the maps are all inside Awas Vikas (within 2 km of its store)', () => {
  const sectors = DATA.localities.filter((l) => l.k === 'sector');
  const names = new Set(sectors.map((s) => s.n));
  for (const wanted of ['Sector 1', 'Sector 3', 'Sector 4', 'Sector 6', 'Sector 7', 'Sector 8', 'Sector 11', 'Sector 16 A']) {
    assert.ok(names.has(`${wanted}, Awas Vikas Colony`), `${wanted} is listed`);
  }
  for (const s of sectors.filter((x) => /Awas Vikas Colony/.test(x.n))) {
    assert.ok(distanceMeters(s.la, s.ln, 27.204239, 77.964982) <= 2_400, `${s.n} is near the Awas Vikas store`);
  }
});

test('REAL DATA: Wazirpura Road and Sanjay Place resolve to a named street, the colony and pincode 282002', () => {
  const d = here(27.200357, 78.008876);
  assert.equal(d.street.name, 'Wazirpura Road');
  assert.equal(d.locality.name, 'Sanjay Place');
  assert.equal(d.pincode.pin, '282002');
});

test('REAL DATA: the pin on Raja Balwant Singh Road gets its street, a nearby colony and a landmark', () => {
  const d = here(27.197469, 77.995645);
  assert.equal(d.street.name, 'Raja Balwant Singh Road');
  assert.ok(d.landmarks.length >= 1);
  assert.equal(d.pincode.pin, '282002');
});

test('REAL DATA: a point far outside Agra gets no invented block', () => {
  const d = here(27.4924, 77.6737); // Mathura
  assert.equal(d.locality, null);
  assert.equal(d.pincode, null);
  assert.equal(d.street, null);
});

test('REAL DATA: India Post names give the pincode by name', () => {
  const area = (n) => pinForName(n, DATA.postalAreas);
  assert.equal(area('Awas Vikas Colony'), '282007');
  assert.equal(area('Kamla Nagar'), '282004');
  assert.equal(area('Sanjay Place'), '282002');
  assert.equal(area('Sikandra'), '282007');
  assert.equal(area('Dayal Bagh'), '282005');
  assert.equal(area('Shahganj'), '282010');
});

test('REAL DATA: integrity — coordinates inside the Agra box, valid pincodes, no junk names, a sensible size', () => {
  const inBox = (la, ln) => la >= 27.07 && la <= 27.33 && ln >= 77.85 && ln <= 78.15;
  for (const l of DATA.localities) assert.ok(inBox(l.la, l.ln) && l.r >= 100 && l.r <= 1000 && l.n.length >= 4, JSON.stringify(l));
  for (const s of DATA.streets) assert.ok(s.n.length >= 4 && s.p.length >= 2 && s.p.every(([la, ln]) => inBox(la, ln)), s.n);
  for (const m of DATA.landmarks) assert.ok(inBox(m.la, m.ln) && m.n.length >= 4 && m.t, JSON.stringify(m));
  for (const p of DATA.pincodes) assert.match(p.p, /^2\d{5}$/);
  for (const a of DATA.postalAreas) assert.match(a.p, /^\d{6}$/);
  const junk = DATA.localities.filter((l) => l.k === 'colony' && /\b(hospital|school|nursing|depot|shortcut|tank|wala|temple|mandir)\b/i.test(l.n));
  assert.deepEqual(junk.map((l) => l.n), [], 'a colony list must not contain facilities');
  assert.ok(DATA.localities.length >= 150 && DATA.streets.length >= 400 && DATA.landmarks.length >= 800, 'the data did not shrink by accident');
  assert.ok(readFileSync(file('data/agraPlaces.json')).length < 400_000, 'small enough to ship in the app');
  assert.ok(Array.isArray(DATA.sources) && DATA.sources.some((s) => /OpenStreetMap/.test(s)) && DATA.sources.some((s) => /India Post/.test(s)), 'sources are credited');
});

// ================================================================== wiring
test('the address lookup applies the local data after the providers, and a failure there never breaks it', () => {
  const src = code('services/location/addressSearch.ts');
  const reverse = src.slice(src.indexOf('async reverse(position'), src.indexOf('async reverseFromProviders'));
  assert.match(reverse, /reverseFromProviders\(position\)/);
  assert.ok(reverse.indexOf('getPlaceContext()') > reverse.indexOf('reverseFromProviders') && reverse.indexOf('enrichAddress(') > reverse.indexOf('getPlaceContext()'), 'providers first, then the local data');
  assert.match(reverse, /try \{[\s\S]*enrichAddress[\s\S]*\} catch \{/, 'the local data sits inside a try: a failure there falls back to the provider answer');
  assert.match(reverse, /return fromProviders;/);
});

test('the place data loads lazily, merges the owner\'s additions in front, and a missing file cannot break address entry', () => {
  const src = source('services/location/placeData.ts');
  assert.match(src, /require\('\.\.\/\.\.\/data\/agraPlaces\.json'\)/);
  assert.match(src, /\.\.\.\(extra\.localities \?\? \[\]\), \.\.\.\(generated\.localities \?\? \[\]\)/);
  assert.match(src, /catch \{[\s\S]*?EMPTY_PLACE_DATA/);
  assert.match(src, /storeRepository\.list\(\)/, 'the stores supply the colony anchors');
});

test('screens: the map says where the pin is; the form OFFERS a landmark (never fills it) and explains the pincode', () => {
  assert.match(code('app/address/map-pick.tsx'), /describeLocalPlace\(resolved\.local\)/);
  const add = code('app/address/add.tsx');
  assert.match(add, /!fields\.landmark\.trim\(\)/, 'only offered while the landmark is empty');
  assert.match(add, /onPress=\{\(\) => setField\('landmark'\)\(`Near \$\{address\.local!\.landmark!\.name\}`\)\}/, 'filled only when the customer taps it');
  assert.match(add, /From India Post/);
});
