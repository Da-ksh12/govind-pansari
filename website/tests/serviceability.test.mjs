// The delivery sentences. The server decides; these tests pin down how the website words each answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBrowserLocationFailure, describeServiceability, describeServiceabilityFailure, formatClock, formatDistance, isValidCoordinate, shortStoreName } from '../lib/serviceability.ts';

const store = { storeId: 's1', storeName: 'Govind Pansari — Awas Vikas', distanceMeters: 1400.6 };

test('small helpers', () => {
  assert.equal(shortStoreName('Govind Pansari — Vijay Nagar'), 'Vijay Nagar');
  assert.equal(formatDistance(76), '76 m');
  assert.equal(formatDistance(1400.6), '1.4 km');
  assert.equal(formatClock('21:00'), '9:00 PM');
  assert.equal(formatClock('00:30'), '12:30 AM');
  assert.equal(isValidCoordinate(27.2, 78), true);
  assert.equal(isValidCoordinate(91, 0), false);
  assert.equal(isValidCoordinate(NaN, 0), false);
});

test('a serviceable point says which store serves it', () => {
  const m = describeServiceability({ serviceable: true, zoneId: 'z', deliveryFee: 49, minimumOrderValue: 299, estimatedDeliveryMinutes: 35, eligibleStores: [store], nearestStore: store });
  assert.equal(m.tone, 'ok');
  assert.match(m.message, /Awas Vikas/);
  assert.match(m.message, /1\.4 km/);
});

test('outside the area names the radius the SERVER reports, not a number written into the website', () => {
  const m = describeServiceability({ serviceable: false, reason: 'OUTSIDE_SERVICE_AREA', maxRadiusKm: 10, nearestStore: store });
  assert.equal(m.tone, 'unavailable');
  assert.match(m.message, /10 km/);
  const other = describeServiceability({ serviceable: false, reason: 'OUTSIDE_SERVICE_AREA', maxRadiusKm: 7.5 });
  assert.match(other.message, /7\.5 km/);
});

test('closed, paused and invalid are each told apart', () => {
  assert.equal(describeServiceability({ serviceable: false, reason: 'STORE_CLOSED', opensAt: '09:00', closesAt: '21:00' }).title, "We're closed right now");
  assert.match(describeServiceability({ serviceable: false, reason: 'STORE_CLOSED', opensAt: '09:00', closesAt: '21:00' }).message, /9:00 AM and 9:00 PM/);
  assert.equal(describeServiceability({ serviceable: false, reason: 'STORES_NOT_ACCEPTING_ORDERS' }).tone, 'closed');
  assert.equal(describeServiceability({ serviceable: false, reason: 'INVALID_COORDINATES' }).addressStillValid, false);
});

test('a failed check is never reported as "outside the area"', () => {
  const m = describeServiceabilityFailure();
  assert.equal(m.tone, 'error');
  assert.doesNotMatch(m.title + m.message, /outside/i);
});

test('browser location failures end with a way forward', () => {
  for (const code of [1, 2, 3, undefined]) assert.match(describeBrowserLocationFailure(code), /search|Search/);
});
