// The Add Address form as logic: geocoder results never overwrite what the customer typed, a house number is never
// invented, the legacy address lines are composed from the parts, and validation says what is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FIELDS, applyGeoParts, composeLine1, composeLine2, geocodeSourceFor, validateFields } from '../../services/addressForm.ts';
import {
  AddressLookupError,
  REVERSE_MIN_MOVE_METERS,
  canFallBack,
  describeLookupFailure,
  kindFromErrorCode,
  metersBetween,
  newSessionToken,
  shouldReverseGeocode,
} from '../../services/location/addressTypes.ts';

const touched = (...keys) => new Set(keys);
const GEO_A = { street: 'Rajpur Road', locality: 'Vijay Nagar', city: 'Agra', state: 'Uttar Pradesh', postalCode: '282002' };

test('a map pick fills the geocoder-owned fields and nothing else', () => {
  const next = applyGeoParts(EMPTY_FIELDS, touched(), GEO_A);
  assert.deepEqual(
    { street: next.street, locality: next.locality, city: next.city, state: next.state, pincode: next.pincode },
    { street: 'Rajpur Road', locality: 'Vijay Nagar', city: 'Agra', state: 'Uttar Pradesh', pincode: '282002' },
  );
  for (const own of ['receiverName', 'receiverPhone', 'houseNo', 'building', 'floor', 'landmark', 'instructions']) {
    assert.equal(next[own], '', `${own} is the customer's — a geocoder never fills it`);
  }
});

test('the house number is never taken from a geocoder, even if the result looks like it has one', () => {
  const next = applyGeoParts(EMPTY_FIELDS, touched(), { ...GEO_A, houseNo: '42', streetNumber: '42' });
  assert.equal(next.houseNo, '');
});

test('moving the pin again keeps everything the customer typed', () => {
  const typed = { ...EMPTY_FIELDS, receiverName: 'Asha', receiverPhone: '9876543210', houseNo: '12-B', building: 'Sharma Apartments', floor: '2nd', landmark: 'Near the temple', instructions: 'Call on arrival', street: 'My own street name' };
  const keys = touched('receiverName', 'receiverPhone', 'houseNo', 'building', 'floor', 'landmark', 'instructions', 'street');
  const next = applyGeoParts(typed, keys, { street: 'Other Road', locality: 'Other Colony', city: 'Mathura', state: 'Uttar Pradesh', postalCode: '281001' });
  assert.equal(next.street, 'My own street name', 'a street the customer edited survives the new pin');
  assert.equal(next.houseNo, '12-B');
  assert.equal(next.building, 'Sharma Apartments');
  assert.equal(next.floor, '2nd');
  assert.equal(next.landmark, 'Near the temple');
  assert.equal(next.instructions, 'Call on arrival');
  assert.equal(next.receiverName, 'Asha');
  assert.equal(next.locality, 'Other Colony', 'untouched geocoder fields follow the new pin');
  assert.equal(next.city, 'Mathura');
  assert.equal(next.pincode, '281001');
});

test('an auto-filled field that the new place cannot supply is cleared, not left describing the old place', () => {
  const first = applyGeoParts(EMPTY_FIELDS, touched(), GEO_A);
  const second = applyGeoParts(first, touched(), { city: 'Agra', state: 'Uttar Pradesh' });
  assert.equal(second.street, '');
  assert.equal(second.locality, '');
  assert.equal(second.pincode, '');
  assert.equal(second.city, 'Agra');
});

test('a field the customer emptied on purpose stays empty (touched means theirs)', () => {
  const next = applyGeoParts({ ...EMPTY_FIELDS, street: '' }, touched('street'), GEO_A);
  assert.equal(next.street, '');
});

test('address lines are composed in reading order for riders and old screens', () => {
  const f = { ...EMPTY_FIELDS, houseNo: '12-B', building: 'Sharma Apartments', floor: '2nd', street: 'Rajpur Road', locality: 'Vijay Nagar' };
  assert.equal(composeLine1(f), '12-B, Sharma Apartments, 2nd floor, Rajpur Road');
  assert.equal(composeLine2(f), 'Vijay Nagar');
  assert.equal(composeLine1({ ...f, floor: 'Ground floor' }), '12-B, Sharma Apartments, Ground floor, Rajpur Road', 'does not say "floor" twice');
  assert.equal(composeLine1({ ...EMPTY_FIELDS, houseNo: '7' }), '7');
  assert.equal(composeLine2(EMPTY_FIELDS), undefined);
  assert.equal(composeLine1({ ...f, building: '  ', floor: '' }), '12-B, Rajpur Road');
});

const VALID = { ...EMPTY_FIELDS, receiverName: 'Asha Sharma', receiverPhone: '9876543210', houseNo: '12-B', street: 'Rajpur Road', city: 'Agra', state: 'Uttar Pradesh', pincode: '282002' };

test('a complete form with a confirmed location is valid', () => {
  assert.deepEqual(validateFields(VALID, true), { ok: true, errors: {} });
});

test('each missing piece is named, so the customer knows what to fix', () => {
  const v = validateFields({ ...EMPTY_FIELDS }, false);
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), ['city', 'houseNo', 'pincode', 'position', 'receiverName', 'receiverPhone', 'state', 'street'].sort());
});

test('house number is required: the geocoder cannot supply it', () => {
  const v = validateFields({ ...VALID, houseNo: '   ' }, true);
  assert.equal(v.ok, false);
  assert.match(v.errors.houseNo, /house/i);
});

test('phone and PIN must be well formed', () => {
  assert.ok(validateFields({ ...VALID, receiverPhone: '98765' }, true).errors.receiverPhone);
  assert.ok(validateFields({ ...VALID, receiverPhone: '98765 43210' }, true).ok, 'spaces are ignored');
  assert.ok(validateFields({ ...VALID, pincode: '2820' }, true).errors.pincode);
  assert.ok(validateFields({ ...VALID, pincode: '28200A' }, true).errors.pincode);
});

test('some locating text is needed so the rider can find the place: street, building or area', () => {
  assert.ok(validateFields({ ...VALID, street: '' }, true).errors.street);
  assert.equal(validateFields({ ...VALID, street: '', locality: 'Vijay Nagar' }, true).ok, true);
  assert.equal(validateFields({ ...VALID, street: '', building: 'Sharma Apartments' }, true).ok, true);
});

test('overlong free text is refused before the database constraint would', () => {
  assert.ok(validateFields({ ...VALID, instructions: 'x'.repeat(501) }, true).errors.instructions);
  assert.equal(validateFields({ ...VALID, instructions: 'x'.repeat(500) }, true).ok, true);
});

test('the geocode source stored with an address is explicit; an unlooked-up pin is "manual"', () => {
  assert.equal(geocodeSourceFor('google'), 'google');
  assert.equal(geocodeSourceFor('device'), 'device');
  assert.equal(geocodeSourceFor(null), 'manual');
  assert.equal(geocodeSourceFor(undefined), 'manual');
});

// ---- lookup helpers -------------------------------------------------------

test('only "not set up / refused / down" falls back to the previous provider; offline and rate-limited do not', () => {
  assert.equal(canFallBack('not_configured'), true);
  assert.equal(canFallBack('denied'), true);
  assert.equal(canFallBack('unavailable'), true);
  assert.equal(canFallBack('offline'), false);
  assert.equal(canFallBack('rate_limited'), false);
});

test('edge function error codes map to customer-meaningful kinds', () => {
  assert.equal(kindFromErrorCode('NOT_CONFIGURED'), 'not_configured');
  assert.equal(kindFromErrorCode('RATE_LIMITED'), 'rate_limited');
  assert.equal(kindFromErrorCode('UPSTREAM_DENIED'), 'denied');
  assert.equal(kindFromErrorCode('UNAUTHENTICATED'), 'denied');
  assert.equal(kindFromErrorCode('UPSTREAM_TIMEOUT'), 'unavailable');
  assert.equal(kindFromErrorCode(undefined, 429), 'rate_limited');
  assert.equal(kindFromErrorCode(undefined, 500), 'unavailable');
});

test('every failure has a plain message that still lets the customer finish by moving the pin', () => {
  for (const kind of ['offline', 'not_configured', 'rate_limited', 'unavailable', 'denied']) {
    const m = describeLookupFailure(kind);
    assert.ok(m.length > 20 && !/undefined|\[object/.test(m), kind);
  }
  assert.match(describeLookupFailure('offline'), /offline/i);
  assert.match(describeLookupFailure('unavailable'), /move the map pin/i);
  assert.equal(new AddressLookupError('offline').kind, 'offline');
});

test('session tokens are Google-acceptable and different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = newSessionToken();
    assert.match(t, /^[A-Za-z0-9_-]{16,64}$/);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
});

test('a billable reverse geocode is skipped when the pin barely moved', () => {
  const a = { lat: 27.2, lng: 78.0 };
  assert.equal(shouldReverseGeocode(null, a), true);
  assert.equal(shouldReverseGeocode(a, { lat: 27.2 + 5 / 111_320, lng: 78.0 }), false, '5 m');
  assert.equal(shouldReverseGeocode(a, { lat: 27.2 + (REVERSE_MIN_MOVE_METERS + 1) / 111_320, lng: 78.0 }), true);
  assert.ok(Math.abs(metersBetween(a, { lat: 27.2 + 100 / 111_320, lng: 78.0 }) - 100) < 1);
});
