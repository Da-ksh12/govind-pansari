// The address-lookup Edge Function's request handling, run as written (supabase/functions/address-lookup/index.ts) under a
// small Deno shim with a mocked fetch. No Google key is involved: Google's answers are the documented shapes, hand-written.
import test from 'node:test';
import assert from 'node:assert/strict';

const TOKEN = 'abcd1234-efgh5678-ijkl';
const PLACE = 'ChIJ_example_place_id_0001';
const FUNCTION_URL = new URL('../../supabase/functions/address-lookup/index.ts', import.meta.url).href;

let importCount = 0;
async function loadHandler({ googleKey = 'TEST_GOOGLE_KEY' } = {}) {
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.test', SUPABASE_ANON_KEY: 'anon-key', ...(googleKey ? { GOOGLE_MAPS_SERVER_API_KEY: googleKey } : {}) };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  importCount += 1;
  await import(`${FUNCTION_URL}?case=${importCount}`);
  return handler;
}

/** Replaces fetch; returns the calls made. `routes` decides the answer by URL substring. */
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [needle, answer] of routes) {
      if (String(url).includes(needle)) return typeof answer === 'function' ? answer(url, init) : answer;
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const RATE_OK = ['/rpc/enforce_rate_limit', new Response(null, { status: 204 })];
const request = (body, headers = { Authorization: 'Bearer user-jwt' }, method = 'POST') =>
  new Request('https://example.test/address-lookup', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const read = async (res) => ({ status: res.status, body: await res.json() });

test('only POST is answered', async () => {
  const handler = await loadHandler();
  mockFetch([]);
  assert.equal((await handler(request(null, {}, 'GET'))).status, 405);
});

test('without the Google key the function says NOT_CONFIGURED (so the app falls back) and calls nothing', async () => {
  const handler = await loadHandler({ googleKey: null });
  const calls = mockFetch([]);
  const { status, body } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78 })));
  assert.equal(status, 503);
  assert.equal(body.error, 'NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('an unauthenticated call is refused before anything else happens', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([]);
  const { status, body } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78 }, {})));
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHENTICATED');
  assert.equal(calls.length, 0);
});

test('invalid input is rejected BEFORE it can cost a rate-limit token or a Google request', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([]);
  for (const bad of ['not json', { action: 'autocomplete', input: 'ab', sessionToken: TOKEN }, { action: 'details', placeId: '../x', sessionToken: TOKEN }, { action: 'reverse', lat: 999, lng: 1 }, { action: 'nope' }]) {
    const { status, body } = await read(await handler(request(bad)));
    assert.equal(status, 400, JSON.stringify(bad));
    assert.equal(body.error, 'INVALID_REQUEST');
  }
  assert.equal(calls.length, 0);
});

test('an oversized body is refused', async () => {
  const handler = await loadHandler();
  mockFetch([]);
  const res = await handler(request({ action: 'autocomplete', input: 'x'.repeat(5000), sessionToken: TOKEN }));
  assert.equal(res.status, 413);
});

test('a caller who is not a signed-in user (anon key only) is turned away by the rate-limit check', async () => {
  const handler = await loadHandler();
  mockFetch([['/rpc/enforce_rate_limit', new Response('{"message":"not authenticated"}', { status: 400 })]]);
  const { status, body } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78 })));
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHENTICATED');
});

test('too many searches get a 429 and Google is never called', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([['/rpc/enforce_rate_limit', new Response('{"message":"rate_limit_exceeded: too many requests"}', { status: 400 })]]);
  const { status, body } = await read(await handler(request({ action: 'autocomplete', input: 'vijay nagar', sessionToken: TOKEN })));
  assert.equal(status, 429);
  assert.equal(body.error, 'RATE_LIMITED');
  assert.equal(calls.length, 1, 'only the rate-limit call was made');
});

test('if the rate limiter itself is unavailable the function fails closed rather than spending money unmetered', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([['/rpc/enforce_rate_limit', new Response('{"message":"unknown rate limit action"}', { status: 400 })]]);
  const { status } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78 })));
  assert.equal(status, 503);
  assert.equal(calls.length, 1);
});

test('autocomplete: key goes to Google only in a header, the caller token is used for the limit, and the response is the normalised shape', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([
    RATE_OK,
    [
      'places.googleapis.com/v1/places:autocomplete',
      json({ suggestions: [{ placePrediction: { placeId: PLACE, text: { text: 'Vijay Nagar Colony, Agra, India' }, structuredFormat: { mainText: { text: 'Vijay Nagar Colony' }, secondaryText: { text: 'Agra, India' } } } }] }),
    ],
  ]);
  const res = await handler(request({ action: 'autocomplete', input: 'vijay nagar', sessionToken: TOKEN, bias: { lat: 27.2, lng: 78.0 } }));
  const { status, body } = await read(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.suggestions, [{ placeId: PLACE, primary: 'Vijay Nagar Colony', secondary: 'Agra, India', description: 'Vijay Nagar Colony, Agra, India', distanceMeters: null }]);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');

  const limit = calls[0];
  assert.match(limit.url, /enforce_rate_limit/);
  assert.equal(limit.init.headers.Authorization, 'Bearer user-jwt', 'the limit is charged to the CALLER');
  assert.deepEqual(JSON.parse(limit.init.body), { p_action: 'places_lookup' });

  const google = calls[1];
  assert.equal(google.init.headers['X-Goog-Api-Key'], 'TEST_GOOGLE_KEY');
  assert.doesNotMatch(google.url, /TEST_GOOGLE_KEY/, 'the key is not in the URL for Places');
  const sent = JSON.parse(google.init.body);
  assert.deepEqual(sent.includedRegionCodes, ['in']);
  assert.equal(sent.sessionToken, TOKEN);
  assert.equal(sent.locationBias.circle.radius, 30000);
  assert.doesNotMatch(JSON.stringify(body), /TEST_GOOGLE_KEY/, 'the key never reaches the app');
});

test('details: Essentials-only field mask, session token passed, normalised place returned', async () => {
  const handler = await loadHandler();
  const calls = mockFetch([
    RATE_OK,
    [
      `places.googleapis.com/v1/places/${PLACE}`,
      json({
        id: PLACE,
        formattedAddress: 'Rajpur Rd, Vijay Nagar, Agra 282002, India',
        location: { latitude: 27.2034, longitude: 78.0226 },
        addressComponents: [
          { longText: 'Rajpur Road', shortText: 'Rajpur Rd', types: ['route'] },
          { longText: 'Agra', shortText: 'Agra', types: ['locality'] },
          { longText: '282002', shortText: '282002', types: ['postal_code'] },
        ],
      }),
    ],
  ]);
  const { status, body } = await read(await handler(request({ action: 'details', placeId: PLACE, sessionToken: TOKEN })));
  assert.equal(status, 200);
  assert.equal(body.place.lat, 27.2034);
  assert.equal(body.place.parts.street, 'Rajpur Road');
  assert.equal(body.place.parts.postalCode, '282002');
  assert.equal(body.place.parts.streetNumber, null, 'no house number is invented');
  const google = calls[1];
  assert.equal(google.init.headers['X-Goog-FieldMask'], 'id,formattedAddress,location,addressComponents');
  assert.match(google.url, new RegExp(`sessionToken=${TOKEN}`));
});

test('reverse: a point with nothing known is an answer (place: null), not an error', async () => {
  const handler = await loadHandler();
  mockFetch([RATE_OK, ['maps.googleapis.com/maps/api/geocode/json', json({ status: 'ZERO_RESULTS', results: [] })]]);
  const { status, body } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78.0 })));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, place: null });
});

test('Google refusing the key is reported as UPSTREAM_DENIED (502) and Google\'s own text is never passed on', async () => {
  const handler = await loadHandler();
  mockFetch([RATE_OK, ['places:autocomplete', new Response('{"error":{"message":"API key not valid. key=TEST_GOOGLE_KEY"}}', { status: 403 })]]);
  const res = await handler(request({ action: 'autocomplete', input: 'agra fort', sessionToken: TOKEN }));
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.match(text, /UPSTREAM_DENIED/);
  assert.doesNotMatch(text, /TEST_GOOGLE_KEY|API key not valid/);
});

test('Google quota exhaustion is UPSTREAM_BUSY (503); a bad Geocoding status maps the same way', async () => {
  const handler = await loadHandler();
  mockFetch([RATE_OK, ['places:autocomplete', new Response('{}', { status: 429 })]]);
  assert.equal((await read(await handler(request({ action: 'autocomplete', input: 'agra fort', sessionToken: TOKEN })))).body.error, 'UPSTREAM_BUSY');
  mockFetch([RATE_OK, ['geocode/json', json({ status: 'OVER_QUERY_LIMIT' })]]);
  const { status, body } = await read(await handler(request({ action: 'reverse', lat: 27.2, lng: 78.0 })));
  assert.equal(status, 503);
  assert.equal(body.error, 'UPSTREAM_BUSY');
});

test('a Google timeout is a 504 the app can retry', async () => {
  const handler = await loadHandler();
  mockFetch([RATE_OK, ['places:autocomplete', () => { throw new DOMException('aborted', 'AbortError'); }]]);
  const { status, body } = await read(await handler(request({ action: 'autocomplete', input: 'agra fort', sessionToken: TOKEN })));
  assert.equal(status, 504);
  assert.equal(body.error, 'UPSTREAM_TIMEOUT');
});
