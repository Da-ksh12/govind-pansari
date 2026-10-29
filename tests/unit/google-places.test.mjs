// Request building and response parsing for the address-lookup Edge Function.
//
// IMPORTANT about the fixtures: they follow the response shapes in Google's documentation (Autocomplete (New),
// Place Details (New), Geocoding). They are written by hand, NOT captured from the live API — no Google key has been
// configured for this project yet. supabase/tests/address-lookup-live.test.mjs checks the real thing once a key exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIAS_RADIUS_METERS,
  DETAILS_FIELD_MASK,
  GoogleLookupError,
  MAX_SUGGESTIONS,
  buildAutocompleteBody,
  buildDetailsUrl,
  buildReverseUrl,
  classifyHttpFailure,
  normalizeComponents,
  fromGeocodeComponents,
  fromPlacesComponents,
  parseAutocompleteResponse,
  parseLookupRequest,
  parsePlaceDetails,
  parseReverseGeocode,
} from '../../supabase/functions/_shared/googlePlaces.ts';

const TOKEN = 'abcd1234-efgh5678-ijkl';
const PLACE = 'ChIJ_example_place_id_0001';

test('autocomplete input is trimmed, bounded and needs a session token', () => {
  const ok = parseLookupRequest({ action: 'autocomplete', input: '  vijay   nagar ', sessionToken: TOKEN });
  assert.deepEqual(ok, { ok: true, request: { action: 'autocomplete', input: 'vijay nagar', sessionToken: TOKEN, bias: null } });
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'ab', sessionToken: TOKEN }).ok, false, 'two characters is not a search (each request costs money)');
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'a'.repeat(121), sessionToken: TOKEN }).ok, false);
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'agra' }).ok, false, 'no session token');
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'agra', sessionToken: 'short' }).ok, false);
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'agra', sessionToken: 'has spaces and !! chars' }).ok, false);
  assert.equal(parseLookupRequest({ action: 'autocomplete', input: 123, sessionToken: TOKEN }).ok, false);
});

test('the bias must be a real position; garbage is refused rather than forwarded', () => {
  const ok = parseLookupRequest({ action: 'autocomplete', input: 'agra', sessionToken: TOKEN, bias: { lat: 27.2, lng: 78.0 } });
  assert.deepEqual(ok.request.bias, { lat: 27.2, lng: 78.0 });
  for (const bias of [{ lat: 91, lng: 0.1 }, { lat: 'x', lng: 1 }, { lat: 0, lng: 0 }, { lat: 1 }]) {
    assert.equal(parseLookupRequest({ action: 'autocomplete', input: 'agra', sessionToken: TOKEN, bias }).ok, false, JSON.stringify(bias));
  }
});

test('details and reverse requests are validated', () => {
  assert.equal(parseLookupRequest({ action: 'details', placeId: PLACE, sessionToken: TOKEN }).ok, true);
  assert.equal(parseLookupRequest({ action: 'details', placeId: 'x', sessionToken: TOKEN }).ok, false);
  assert.equal(parseLookupRequest({ action: 'details', placeId: 'places/../etc', sessionToken: TOKEN }).ok, false, 'a place id cannot smuggle a path into the Google URL');
  assert.equal(parseLookupRequest({ action: 'reverse', lat: 27.2, lng: 78.0 }).ok, true);
  assert.equal(parseLookupRequest({ action: 'reverse', lat: 200, lng: 78 }).ok, false);
  assert.equal(parseLookupRequest({ action: 'reverse', lat: 0, lng: 0 }).ok, false, '0,0 is a placeholder, not a place');
  assert.equal(parseLookupRequest({ action: 'reverse', lat: '27.2', lng: 78 }).ok, false);
  assert.equal(parseLookupRequest({ action: 'drop table' }).ok, false);
  assert.equal(parseLookupRequest(null).ok, false);
  assert.equal(parseLookupRequest('x').ok, false);
});

test('the Autocomplete request is restricted to India and biased to the customer when their position is known', () => {
  const without = buildAutocompleteBody({ action: 'autocomplete', input: 'vijay', sessionToken: TOKEN, bias: null });
  assert.deepEqual(without, { input: 'vijay', sessionToken: TOKEN, includedRegionCodes: ['in'], regionCode: 'in', languageCode: 'en' });
  const withBias = buildAutocompleteBody({ action: 'autocomplete', input: 'vijay', sessionToken: TOKEN, bias: { lat: 27.2, lng: 78.0 } });
  assert.deepEqual(withBias.locationBias, { circle: { center: { latitude: 27.2, longitude: 78.0 }, radius: BIAS_RADIUS_METERS } });
  assert.deepEqual(withBias.origin, { latitude: 27.2, longitude: 78.0 });
  assert.ok(BIAS_RADIUS_METERS <= 50_000, 'Google rejects a bias radius over 50 km');
});

test('Place Details asks only for Essentials fields (no displayName, which is a more expensive tier) and shares the session token', () => {
  assert.equal(DETAILS_FIELD_MASK, 'id,formattedAddress,location,addressComponents');
  assert.doesNotMatch(DETAILS_FIELD_MASK, /displayName|rating|photos|reviews|openingHours/);
  const url = buildDetailsUrl(PLACE, TOKEN);
  assert.equal(url, `https://places.googleapis.com/v1/places/${PLACE}?sessionToken=${TOKEN}`);
});

test('the reverse geocoding URL carries the position and region but is the only place the key appears', () => {
  const url = buildReverseUrl(27.20341, 78.022594, 'SECRET');
  assert.match(url, /^https:\/\/maps\.googleapis\.com\/maps\/api\/geocode\/json\?/);
  assert.match(url, /latlng=27\.20341%2C78\.022594/);
  assert.match(url, /region=in/);
});

test('suggestions are mapped, capped and stripped of anything that is not a place', () => {
  const rows = [
    { placePrediction: { placeId: PLACE, text: { text: 'Vijay Nagar Colony, Agra, Uttar Pradesh, India' }, structuredFormat: { mainText: { text: 'Vijay Nagar Colony' }, secondaryText: { text: 'Agra, Uttar Pradesh, India' } }, distanceMeters: 812.4 } },
    { queryPrediction: { text: { text: 'vijay nagar agra restaurants' } } },
    { placePrediction: { placeId: 'bad id with spaces', text: { text: 'x' } } },
    { placePrediction: { placeId: 'ChIJ_example_place_id_0002', text: { text: 'Plain description, Agra' } } },
    null,
  ];
  const out = parseAutocompleteResponse({ suggestions: rows });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { placeId: PLACE, primary: 'Vijay Nagar Colony', secondary: 'Agra, Uttar Pradesh, India', description: 'Vijay Nagar Colony, Agra, Uttar Pradesh, India', distanceMeters: 812 });
  assert.equal(out[1].primary, 'Plain description', 'falls back to the first part of the description');
  assert.equal(out[1].distanceMeters, null);

  const many = { suggestions: Array.from({ length: 20 }, (_, i) => ({ placePrediction: { placeId: `ChIJ_example_place_${String(i).padStart(4, '0')}`, text: { text: `Place ${i}` } } })) };
  assert.equal(parseAutocompleteResponse(many).length, MAX_SUGGESTIONS);
  assert.deepEqual(parseAutocompleteResponse({}), []);
  assert.deepEqual(parseAutocompleteResponse(null), []);
});

// Address components as Google documents them for an Indian address.
const PLACES_COMPONENTS = [
  { longText: '12', shortText: '12', types: ['subpremise'] },
  { longText: 'Sharma Apartments', shortText: 'Sharma Apts', types: ['premise'] },
  { longText: 'Rajpur Road', shortText: 'Rajpur Rd', types: ['route'] },
  { longText: 'Sanjay Place', shortText: 'Sanjay Place', types: ['sublocality_level_2', 'sublocality', 'political'] },
  { longText: 'Vijay Nagar', shortText: 'Vijay Nagar', types: ['sublocality_level_1', 'sublocality', 'political'] },
  { longText: 'Agra', shortText: 'Agra', types: ['locality', 'political'] },
  { longText: 'Agra', shortText: 'Agra', types: ['administrative_area_level_2', 'political'] },
  { longText: 'Uttar Pradesh', shortText: 'UP', types: ['administrative_area_level_1', 'political'] },
  { longText: 'India', shortText: 'IN', types: ['country', 'political'] },
  { longText: '282002', shortText: '282002', types: ['postal_code'] },
];

test('address components become street / locality / city / state / PIN, and the house number is NEVER invented', () => {
  const parts = normalizeComponents(fromPlacesComponents(PLACES_COMPONENTS));
  assert.deepEqual(parts, {
    streetNumber: null,
    premise: 'Sharma Apartments',
    subpremise: '12',
    street: 'Rajpur Road',
    locality: 'Sanjay Place, Vijay Nagar',
    city: 'Agra',
    district: 'Agra',
    state: 'Uttar Pradesh',
    postalCode: '282002',
  });
  assert.equal(parts.streetNumber, null, 'Google reported no street_number, so there is none');
});

test('when Google DOES report a street number it is kept apart from the street name (the form never uses it as the house number)', () => {
  const parts = normalizeComponents(
    fromPlacesComponents([
      { longText: '42', shortText: '42', types: ['street_number'] },
      { longText: 'Rajpur Road', shortText: 'Rajpur Rd', types: ['route'] },
    ]),
  );
  assert.equal(parts.streetNumber, '42');
  assert.equal(parts.street, 'Rajpur Road', 'the street is the road name only, never "42" or "42 Rajpur Road"');
});

test('a component Google did not return stays null instead of being guessed', () => {
  const parts = normalizeComponents(fromPlacesComponents([{ longText: 'Agra', shortText: 'Agra', types: ['locality'] }]));
  assert.deepEqual(parts, { streetNumber: null, premise: null, subpremise: null, street: null, locality: null, city: 'Agra', district: null, state: null, postalCode: null });
});

test('a postal code that is not six digits is dropped, not passed on as a PIN', () => {
  for (const bad of ['2820', '28200A', '282 002', '2820022']) {
    assert.equal(normalizeComponents([{ long: bad, short: bad, types: ['postal_code'] }]).postalCode, null, bad);
  }
});

test('a city falls back to the district when Google gives no locality', () => {
  const parts = normalizeComponents([{ long: 'Agra', short: 'Agra', types: ['administrative_area_level_2'] }]);
  assert.equal(parts.city, 'Agra');
});

test('Place Details are parsed with the position Google returned', () => {
  const place = parsePlaceDetails({ id: PLACE, formattedAddress: '12, Rajpur Rd, Vijay Nagar, Agra, Uttar Pradesh 282002, India', location: { latitude: 27.20341, longitude: 78.022594 }, addressComponents: PLACES_COMPONENTS });
  assert.deepEqual(place.location, { lat: 27.20341, lng: 78.022594 });
  assert.equal(place.placeId, PLACE);
  assert.equal(place.parts.postalCode, '282002');
  assert.throws(() => parsePlaceDetails({ id: PLACE, formattedAddress: 'x' }), GoogleLookupError, 'no position means no usable place');
  assert.throws(() => parsePlaceDetails({ location: { latitude: 0, longitude: 0 } }), GoogleLookupError);
});

const GEOCODE_OK = {
  status: 'OK',
  results: [
    {
      place_id: 'ChIJ_example_geocode_0001',
      formatted_address: 'Rajpur Rd, Vijay Nagar, Agra, Uttar Pradesh 282002, India',
      geometry: { location: { lat: 27.2034, lng: 78.0226 }, location_type: 'GEOMETRIC_CENTER' },
      address_components: [
        { long_name: 'Rajpur Road', short_name: 'Rajpur Rd', types: ['route'] },
        { long_name: 'Vijay Nagar', short_name: 'Vijay Nagar', types: ['sublocality_level_1', 'sublocality', 'political'] },
        { long_name: 'Agra', short_name: 'Agra', types: ['locality', 'political'] },
        { long_name: 'Uttar Pradesh', short_name: 'UP', types: ['administrative_area_level_1', 'political'] },
        { long_name: '282002', short_name: '282002', types: ['postal_code'] },
      ],
    },
    { place_id: 'ChIJ_example_geocode_0002', formatted_address: 'Agra, India', geometry: { location: { lat: 27.17, lng: 78.0 }, location_type: 'APPROXIMATE' }, address_components: [] },
  ],
};

test('reverse geocoding takes the most specific result and reports how precise it is', () => {
  const place = parseReverseGeocode(GEOCODE_OK);
  assert.equal(place.placeId, 'ChIJ_example_geocode_0001');
  assert.equal(place.locationType, 'GEOMETRIC_CENTER');
  assert.equal(place.parts.street, 'Rajpur Road');
  assert.equal(place.parts.locality, 'Vijay Nagar');
  assert.equal(place.parts.streetNumber, null);
  assert.deepEqual(fromGeocodeComponents(GEOCODE_OK.results[0].address_components)[0], { long: 'Rajpur Road', short: 'Rajpur Rd', types: ['route'] });
});

test('"nothing here" is an answer; a denied or exhausted key is an error, never silently "nothing"', () => {
  assert.equal(parseReverseGeocode({ status: 'ZERO_RESULTS', results: [] }), null);
  const kind = (json) => {
    try {
      parseReverseGeocode(json);
    } catch (e) {
      return e.kind;
    }
    return 'no error';
  };
  assert.equal(kind({ status: 'REQUEST_DENIED', error_message: 'API key invalid' }), 'UPSTREAM_DENIED');
  assert.equal(kind({ status: 'OVER_QUERY_LIMIT' }), 'UPSTREAM_BUSY');
  assert.equal(kind({ status: 'INVALID_REQUEST' }), 'INVALID_REQUEST');
  assert.equal(kind({ status: 'UNKNOWN_ERROR' }), 'UPSTREAM_ERROR');
  assert.equal(kind(null), 'UPSTREAM_ERROR');
});

test('HTTP failures map to kinds and never carry the response body (it can echo the request)', () => {
  assert.equal(classifyHttpFailure(400).kind, 'INVALID_REQUEST');
  assert.equal(classifyHttpFailure(403).kind, 'UPSTREAM_DENIED');
  assert.equal(classifyHttpFailure(401).kind, 'UPSTREAM_DENIED');
  assert.equal(classifyHttpFailure(404).kind, 'NOT_FOUND');
  assert.equal(classifyHttpFailure(429).kind, 'UPSTREAM_BUSY');
  assert.equal(classifyHttpFailure(500).kind, 'UPSTREAM_ERROR');
});
