// Delivery availability wording, coordinates and GPS handling. The server decides serviceability
// (supabase/tests/serviceability-routing.test.mjs); these tests pin what the customer is told about each answer, so
// every screen says the same thing for the same coordinates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeGpsAccuracy,
  describeLocationFailure,
  describeServiceability,
  describeServiceabilityFailure,
  formatClock,
  formatDistance,
  isValidCoordinate,
  shortStoreName,
} from '../../services/serviceability.ts';

const source = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const VJN = { storeId: 'v', storeName: 'Govind Pansari — Vijay Nagar', distanceMeters: 76.2 };
const AWV = { storeId: 'a', storeName: 'Govind Pansari — Awas Vikas', distanceMeters: 5630 };

test('a serviceable answer names the store that really serves the address, from the routing result', () => {
  const info = describeServiceability({ serviceable: true, zoneId: 'z', deliveryFee: 49, minimumOrderValue: 299, estimatedDeliveryMinutes: 35, eligibleStores: [VJN, AWV], nearestStore: VJN });
  assert.equal(info.tone, 'ok');
  assert.match(info.message, /Vijay Nagar store, 76 m away/);
  // Without a nearestStore it still uses the first (nearest) eligible store.
  const fallback = describeServiceability({ serviceable: true, zoneId: 'z', deliveryFee: 49, minimumOrderValue: 299, estimatedDeliveryMinutes: 35, eligibleStores: [AWV] });
  assert.match(fallback.message, /Awas Vikas store, 5\.6 km away/);
});

test('outside the area says so, with the nearest store and the real radius — and the address can still be saved', () => {
  const info = describeServiceability({ serviceable: false, reason: 'OUTSIDE_SERVICE_AREA', maxRadiusKm: 10, nearestStore: { storeId: 'v', storeName: VJN.storeName, distanceMeters: 14200 } });
  assert.equal(info.tone, 'unavailable');
  assert.equal(info.title, 'Outside our delivery area');
  assert.match(info.message, /Vijay Nagar\) is 14\.2 km away, and we deliver within 10 km/);
  assert.equal(info.addressStillValid, true);
});

test('a closed store is NOT reported as "we don\'t deliver here" — it gives the opening hours', () => {
  const info = describeServiceability({ serviceable: false, reason: 'STORE_CLOSED', opensAt: '09:00', closesAt: '21:00' });
  assert.equal(info.tone, 'closed');
  assert.match(info.title, /closed right now/);
  assert.match(info.message, /9:00 AM and 9:00 PM/);
  assert.doesNotMatch(`${info.title} ${info.message}`, /don't deliver|not delivering|outside/i);
});

test('paused stores, no active stores and unreadable locations each have their own message', () => {
  assert.match(describeServiceability({ serviceable: false, reason: 'STORES_NOT_ACCEPTING_ORDERS' }).title, /aren't taking orders/);
  assert.match(describeServiceability({ serviceable: false, reason: 'NO_ACTIVE_STORES' }).title, /unavailable/);
  const invalid = describeServiceability({ serviceable: false, reason: 'INVALID_COORDINATES' });
  assert.equal(invalid.addressStillValid, false, 'an address with no readable location cannot be saved as it is');
  assert.match(invalid.message, /pin on the map/);
});

test('a failed check is never worded as "unsupported area"', () => {
  const info = describeServiceabilityFailure();
  assert.equal(info.tone, 'error');
  assert.doesNotMatch(`${info.title} ${info.message}`, /don't deliver|not delivering|outside|unavailable for delivery/i);
  assert.match(info.message, /checked again at checkout/);
});

test('distances and clock times read the way a customer expects', () => {
  assert.equal(formatDistance(76.2), '76 m');
  assert.equal(formatDistance(999), '999 m');
  assert.equal(formatDistance(1400.6), '1.4 km');
  assert.equal(formatDistance(Number.NaN), '');
  assert.equal(formatClock('09:00'), '9:00 AM');
  assert.equal(formatClock('21:00'), '9:00 PM');
  assert.equal(formatClock('00:30'), '12:30 AM');
  assert.equal(formatClock('12:00'), '12:00 PM');
  assert.equal(formatClock(undefined), '');
  assert.equal(shortStoreName('Govind Pansari — Awas Vikas'), 'Awas Vikas');
});

test('coordinates: right ranges and finite; swapped values are still caught where they matter', () => {
  assert.equal(isValidCoordinate(27.203721, 78.021908), true);
  for (const [lat, lng] of [[null, 78], [27, undefined], [Number.NaN, 78], [27, Number.POSITIVE_INFINITY], [91, 78], [27, 181], ['27.2', '78.0']]) {
    assert.equal(isValidCoordinate(lat, lng), false, `${lat},${lng}`);
  }
});

test('every way GPS can fail ends with the map as the way forward — and never substitutes a position', () => {
  for (const code of ['PERMISSION_DENIED', 'GPS_DISABLED', 'TIMEOUT', 'UNAVAILABLE']) {
    assert.match(describeLocationFailure(code), /map/, code);
  }
  assert.match(describeLocationFailure('TIMEOUT'), /GPS fix in time/);
  assert.match(describeLocationFailure('PERMISSION_DENIED'), /Settings/);
});

test('a weak GPS fix is flagged (and still used), a good one is not', () => {
  assert.deepEqual(describeGpsAccuracy(12), { poor: false, message: null });
  assert.deepEqual(describeGpsAccuracy(null), { poor: false, message: null });
  const weak = describeGpsAccuracy(420);
  assert.equal(weak.poor, true);
  assert.match(weak.message, /420 m/);
  assert.match(weak.message, /Check the pin/);
});

// ---- static guards for the specific defects behind the "Currently unavailable for delivery" report -------------------

test('every delivery surface uses the same server function and the same wording module', () => {
  const add = source('app/address/add.tsx');
  const location = source('app/location.tsx');
  const checkout = source('app/checkout.tsx');
  const header = source('components/home/LocationHeader.tsx');
  for (const [name, text] of [['add address', add], ['location', location], ['checkout', checkout], ['home header', header]]) {
    assert.match(text, /describeServiceability/, `${name} must word the result with the shared describeServiceability`);
  }
  // The old hard-coded dialog text is gone.
  assert.doesNotMatch(add, /Currently unavailable for delivery/);
  assert.doesNotMatch(location, /We're expanding fast/);
  const repo = source('services/repositories/storeRepository.ts');
  assert.match(repo, /rpc\('check_serviceability', \{ p_lat: position\.lat, p_lng: position\.lng \}\)/, 'latitude goes to p_lat and longitude to p_lng');
});

test('Add Address: a failed check is a retry/save prompt, not an "unsupported area" dialog', () => {
  const add = source('app/address/add.tsx');
  assert.match(add, /describeServiceabilityFailure\(\)/);
  assert.match(add, /text: 'Try Again'/);
  assert.match(add, /checkServiceability\(position\)/);
});

test('no screen falls back to a hard-coded delivery area (the old "Sanjay Place, Agra" default)', () => {
  const header = source('components/home/LocationHeader.tsx');
  assert.doesNotMatch(header, /Sanjay/i);
  assert.match(header, /Choose delivery location/);
  for (const file of ['store/locationStore.ts', 'services/location/geocodingService.ts', 'app/location.tsx', 'app/address/add.tsx', 'app/address/map-pick.tsx', 'services/repositories/storeRepository.ts']) {
    assert.doesNotMatch(source(file), /Sanjay/i, `${file} must not mention Sanjay Place`);
  }
});

test('the map picker never saves its Agra opening position unless the customer placed the pin', () => {
  const pick = source('app/address/map-pick.tsx');
  assert.match(pick, /onPress=\{handleConfirm\} disabled=\{!pinPlaced\}/);
  assert.match(pick, /if \(!pinPlaced \|\| !isValidCoordinate\(center\.lat, center\.lng\)\) return;/);
  // GPS failures are shown, not swallowed.
  assert.doesNotMatch(pick, /Silent — the picker still works/);
  assert.match(pick, /describeLocationError\(e\)/);
});

test('the GPS read clears its timeout and never falls back to a last-known position', () => {
  const service = source('services/location/locationService.ts');
  assert.match(service, /clearTimeout\(timer\)/);
  assert.doesNotMatch(service, /getLastKnownPositionAsync/);
  assert.match(service, /Accuracy\.High/);
});

test('Home keeps its revalidation: a stored "serviceable" is asked of the server again', () => {
  const home = source('app/(tabs)/index.tsx');
  assert.match(home, /useLocationRevalidation\(\)/);
  const hook = source('hooks/useLocationRevalidation.ts');
  assert.match(hook, /checkServiceability\(current\.position\)/);
  assert.match(hook, /AppState\.addEventListener\('change'/);
});
