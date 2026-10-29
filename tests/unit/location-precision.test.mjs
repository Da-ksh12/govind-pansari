// "The pin lands on the area, not the door": the rules that make the captured location EXACT. Covers choosing the best GPS
// reading, how precision is described, and how a street-level address is read from OpenStreetMap.
//
// The OpenStreetMap fixtures below are REAL responses captured from nominatim.openstreetmap.org (zoom 18) on 2026-10-28 for the
// four coordinates used to test delivery in Agra — not hand-written shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROXIMATE_ABOVE_METERS,
  CHECK_PIN_ABOVE_METERS,
  GOOD_ENOUGH_METERS,
  MAX_READING_AGE_MS,
  betterOf,
  classifyPrecision,
  createRefiner,
  isPreciseEnough,
  isUsableReading,
  permissionIsApproximateOnly,
  zoomForAccuracy,
} from '../../services/location/fixRefinement.ts';
import { parseNominatimReverse, sanePostalCode } from '../../services/location/osmAddress.ts';
import { shortAddressLabel } from '../../services/location/addressTypes.ts';
import { describeGpsAccuracy } from '../../services/serviceability.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOW = 1_800_000_000_000;
const reading = (accuracyMeters, over = {}) => ({ lat: 27.2, lng: 78.0, accuracyMeters, timestamp: NOW - 500, ...over });

// ---- choosing the best reading --------------------------------------------------------------------------------------

test('the more precise reading always wins, whatever order they arrive in', () => {
  const coarse = reading(800);
  const fine = reading(12);
  assert.equal(betterOf(coarse, fine), fine);
  assert.equal(betterOf(fine, coarse), fine, 'a later, worse reading never replaces a better one');
  assert.equal(betterOf(null, coarse), coarse);
});

test('a reading with no reported accuracy only wins over nothing', () => {
  const unknown = reading(null);
  const known = reading(300);
  assert.equal(betterOf(unknown, known), known);
  assert.equal(betterOf(known, unknown), known);
  assert.equal(betterOf(null, unknown), unknown);
});

test('a cached position from earlier is not "here": old and invalid readings are unusable', () => {
  assert.equal(isUsableReading(reading(10), NOW), true);
  assert.equal(isUsableReading(reading(10, { timestamp: NOW - MAX_READING_AGE_MS - 1 }), NOW), false);
  assert.equal(isUsableReading(reading(10, { timestamp: Number.NaN }), NOW), false);
  assert.equal(isUsableReading(reading(10, { lat: 0, lng: 0 }), NOW), false);
  assert.equal(isUsableReading(reading(10, { lat: 91 }), NOW), false);
  assert.equal(isUsableReading(reading(10, { lng: Number.NaN }), NOW), false);
});

test('refinement stops as soon as a reading is precise enough, not before', () => {
  assert.equal(isPreciseEnough(reading(GOOD_ENOUGH_METERS)), true);
  assert.equal(isPreciseEnough(reading(GOOD_ENOUGH_METERS + 1)), false);
  assert.equal(isPreciseEnough(reading(null)), false);
  assert.equal(isPreciseEnough(null), false);
});

test('a typical phone session: a quick network fix first, then satellites — the pin ends on the satellite fix', () => {
  const seen = [];
  const refiner = createRefiner(() => NOW);
  const feed = [reading(1800, { lat: 27.21 }), reading(420, { lat: 27.205 }), reading(95, { lat: 27.2036 }), reading(60, { lat: 27.2035 }), reading(18, { lat: 27.20341 }), reading(8, { lat: 27.203405 })];
  let stoppedAt = -1;
  feed.forEach((r, i) => {
    if (stoppedAt >= 0) return; // the service stops listening once done
    const out = refiner.offer(r);
    if (out.improved) seen.push(out.best.accuracyMeters);
    if (out.done) stoppedAt = i;
  });
  assert.deepEqual(seen, [1800, 420, 95, 60, 18], 'the pin moved to each better reading');
  assert.equal(stoppedAt, 4, 'stopped at the first reading good to 25 m — did not wait for the last');
  assert.equal(refiner.best().accuracyMeters, 18);
  assert.equal(refiner.best().lat, 27.20341);
});

test('if nothing precise arrives, the best reading so far is what the timeout returns (never the first one)', () => {
  const refiner = createRefiner(() => NOW);
  for (const r of [reading(900), reading(300), reading(450), reading(700)]) assert.equal(refiner.offer(r).done, false);
  assert.equal(refiner.best().accuracyMeters, 300);
});

test('stale readings in the stream are ignored entirely', () => {
  const refiner = createRefiner(() => NOW);
  const out = refiner.offer(reading(5, { timestamp: NOW - 10 * 60_000 }));
  assert.deepEqual({ improved: out.improved, done: out.done, best: out.best }, { improved: false, done: false, best: null });
  assert.equal(refiner.best(), null);
});

// ---- describing precision -------------------------------------------------------------------------------------------

test('precision levels have clear boundaries', () => {
  assert.equal(classifyPrecision(10), 'exact');
  assert.equal(classifyPrecision(GOOD_ENOUGH_METERS), 'exact');
  assert.equal(classifyPrecision(GOOD_ENOUGH_METERS + 1), 'good');
  assert.equal(classifyPrecision(CHECK_PIN_ABOVE_METERS), 'good');
  assert.equal(classifyPrecision(CHECK_PIN_ABOVE_METERS + 1), 'check');
  assert.equal(classifyPrecision(APPROXIMATE_ABOVE_METERS), 'check');
  assert.equal(classifyPrecision(APPROXIMATE_ABOVE_METERS + 1), 'approximate');
  assert.equal(classifyPrecision(null), 'unknown');
  assert.equal(classifyPrecision(-3), 'unknown');
});

test('the map zooms to street level for a precise fix and stays wider when the fix is rough', () => {
  assert.equal(zoomForAccuracy(10), 17.5);
  assert.equal(zoomForAccuracy(45), 17.5);
  assert.equal(zoomForAccuracy(200), 16.5);
  assert.equal(zoomForAccuracy(3000), 15.5);
  assert.ok(zoomForAccuracy(10) > 15, 'the previous map stayed at zoom 15 after locating — a whole neighbourhood in view');
});

test('Android "Approximate" permission is recognised (it can never give an exact spot)', () => {
  assert.equal(permissionIsApproximateOnly({ accuracy: 'coarse' }), true);
  assert.equal(permissionIsApproximateOnly({ accuracy: 'fine' }), false);
  assert.equal(permissionIsApproximateOnly(undefined), false, 'iOS / unknown: not assumed to be approximate');
});

test('the customer is told plainly what to do for each level of imprecision', () => {
  assert.deepEqual(describeGpsAccuracy(12), { poor: false, message: null });
  assert.deepEqual(describeGpsAccuracy(50), { poor: false, message: null });
  const check = describeGpsAccuracy(120);
  assert.equal(check.poor, true);
  assert.match(check.message, /120 m/);
  assert.match(check.message, /exact spot/);
  const rough = describeGpsAccuracy(2300);
  assert.match(rough.message, /approximate area/);
  assert.match(rough.message, /2\.3 km/);
  const permission = describeGpsAccuracy(15, false);
  assert.equal(permission.poor, true, 'a tiny reported accuracy does not matter when only approximate location was allowed');
  assert.match(permission.message, /precise location/i);
  assert.match(permission.message, /Settings/);
});

// ---- OpenStreetMap street-level addresses (REAL captured responses) -------------------------------------------------

const OSM = {
  balkeshwar: { type: 'tertiary', name: '', display_name: 'Balkeshwar, Agra, Uttar Pradesh, 402004, India', address: { suburb: 'Balkeshwar', city: 'Agra', county: 'Agra', state_district: 'Agra', state: 'Uttar Pradesh', 'ISO3166-2-lvl4': 'IN-UP', postcode: '402004', country: 'India', country_code: 'in' } },
  wazirpura: { type: 'secondary', name: 'Wazirpura Road', display_name: 'Wazirpura Road, Swadhesi Bima Colony, Civil Lines, Agra, Uttar Pradesh, 282003, India', address: { road: 'Wazirpura Road', neighbourhood: 'Swadhesi Bima Colony', suburb: 'Civil Lines', city: 'Agra', county: 'Agra', state_district: 'Agra', state: 'Uttar Pradesh', postcode: '282003', country: 'India', country_code: 'in' } },
  hostel: { type: 'service', name: 'youth hostel road', display_name: 'youth hostel road, Civil Lines, Agra, Uttar Pradesh, 282003, India', address: { road: 'youth hostel road', suburb: 'Civil Lines', city: 'Agra', county: 'Agra', state_district: 'Agra', state: 'Uttar Pradesh', postcode: '282003', country: 'India', country_code: 'in' } },
  civilLines: { type: 'secondary', name: '', display_name: 'Civil Lines, Agra, Uttar Pradesh, 282003, India', address: { suburb: 'Civil Lines', city: 'Agra', county: 'Agra', state_district: 'Agra', state: 'Uttar Pradesh', postcode: '282003', country: 'India', country_code: 'in' } },
};

test('a mapped road gives street + colony + area, a PIN that fits the state, and a readable line (no country)', () => {
  const r = parseNominatimReverse(OSM.wazirpura);
  assert.deepEqual(r.parts, { street: 'Wazirpura Road', locality: 'Swadhesi Bima Colony, Civil Lines', city: 'Agra', state: 'Uttar Pradesh', postalCode: '282003', premise: null });
  assert.equal(r.precision, 'street');
  assert.equal(r.formattedAddress, 'Wazirpura Road, Swadhesi Bima Colony, Civil Lines, Agra, Uttar Pradesh 282003');
  assert.doesNotMatch(r.formattedAddress, /India/);
});

test('a lane with a road name is street-level too', () => {
  const r = parseNominatimReverse(OSM.hostel);
  assert.equal(r.parts.street, 'youth hostel road');
  assert.equal(r.parts.locality, 'Civil Lines');
  assert.equal(r.precision, 'street');
});

test('where OpenStreetMap only knows the area, the result says so and invents no street', () => {
  const r = parseNominatimReverse(OSM.civilLines);
  assert.equal(r.parts.street, null);
  assert.equal(r.parts.locality, 'Civil Lines');
  assert.equal(r.precision, 'area');
});

test('a WRONG postal code in OpenStreetMap is dropped, not pre-filled (402004 is a Maharashtra PIN, the point is in Agra)', () => {
  const r = parseNominatimReverse(OSM.balkeshwar);
  assert.equal(r.parts.postalCode, null);
  assert.equal(r.parts.locality, 'Balkeshwar');
  assert.equal(r.parts.city, 'Agra');
  assert.doesNotMatch(r.formattedAddress, /402004/);
});

test('PIN region sanity: first digit must match the state; unknown states and malformed PINs are handled', () => {
  assert.equal(sanePostalCode('282002', 'Uttar Pradesh'), '282002');
  assert.equal(sanePostalCode('402004', 'Uttar Pradesh'), null);
  assert.equal(sanePostalCode('110001', 'Delhi'), '110001');
  assert.equal(sanePostalCode('560001', 'Karnataka'), '560001');
  assert.equal(sanePostalCode('560001', 'Some New State'), '560001', 'a state we do not know is not guessed at');
  assert.equal(sanePostalCode('2820', 'Uttar Pradesh'), null);
  assert.equal(sanePostalCode('28200A', 'Uttar Pradesh'), null);
  assert.equal(sanePostalCode(undefined, 'Uttar Pradesh'), null);
  assert.equal(sanePostalCode('282 002', 'uttar pradesh'), '282002');
});

test('an answer with no usable place is "nothing", not a made-up address', () => {
  assert.equal(parseNominatimReverse({ error: 'Unable to geocode' }), null);
  assert.equal(parseNominatimReverse({ address: {} }), null);
  assert.equal(parseNominatimReverse(null), null);
});

test('the header label is the specific place, not just the city', () => {
  assert.equal(shortAddressLabel(parseNominatimReverse(OSM.wazirpura).parts), 'Wazirpura Road, Swadhesi Bima Colony');
  assert.equal(shortAddressLabel(parseNominatimReverse(OSM.civilLines).parts), 'Civil Lines');
  assert.equal(shortAddressLabel({ street: null, locality: null, city: 'Agra', state: null, postalCode: null, premise: null }), 'Agra');
  assert.equal(shortAddressLabel({ street: null, locality: null, city: null, state: null, postalCode: null, premise: null }), null);
  assert.equal(shortAddressLabel(null), null);
});

// ---- wiring ---------------------------------------------------------------------------------------------------------

const source = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

test('the GPS service listens and refines instead of taking the first reading, and never falls back to a cached or default position', () => {
  const src = source('services/location/locationService.ts');
  assert.match(src, /watchPositionAsync/);
  assert.match(src, /Accuracy\.Highest/);
  assert.match(src, /createRefiner/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /getLastKnownPositionAsync|getCurrentPositionAsync/, 'a last-known or one-shot first reading is what produced the coarse pin');
});

test('the map picker locates on its own, zooms to street level, shows the accuracy, and does not re-locate over a pin the customer moved', () => {
  const src = source('app/address/map-pick.tsx');
  assert.match(src, /locate\(true\)/, 'auto-locates when opened (quietly, no permission dialog)');
  assert.match(src, /params\.locate === '1'/, '"Use current location" from Add Address opens the map and locates');
  assert.match(src, /zoomForAccuracy\(/);
  assert.match(src, /AccuracyChip/);
  assert.match(src, /setGpsFix\(null\)/, 'moving the pin away from the GPS reading drops the "exact location" claim');
  const add = source('app/address/add.tsx');
  assert.match(add, /if \(position\) return handlePinOnMap\(\)/, 'an existing pin is reopened where it is');
});

test('address text prefers OpenStreetMap street-level data over the phone geocoder', () => {
  const src = source('services/location/addressSearch.ts');
  const osm = src.indexOf('placesSearchService.reverse(position)');
  const device = src.indexOf('geocodingService.reverseGeocode(position)');
  assert.ok(osm > -1 && device > -1 && osm < device);
});
