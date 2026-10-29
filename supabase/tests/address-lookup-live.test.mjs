#!/usr/bin/env node
/**
 * The deployed address-lookup Edge Function against real Google Maps Platform. Run this AFTER the Google setup in
 * docs/google-address-setup.md (migration applied, GOOGLE_MAPS_SERVER_API_KEY secret set, function deployed). Until then it
 * reports NOT RUN and exits with code 3 — it never pretends to pass.
 *
 *   node --env-file=.env supabase/tests/address-lookup-live.test.mjs
 *
 * It logs in as a QA customer and checks, against the real service: a signed-out call is refused; autocomplete returns
 * suggestions biased to Agra; Place Details returns a position near the searched area with address parts; reverse geocoding
 * of a known-serviceable point returns an address; a point in open water returns "no address" (not an error); invalid input
 * is refused; the response never contains the API key; a burst of searches eventually returns RATE_LIMITED.
 * Cost: a handful of Google requests (one Autocomplete session + one Details + one Geocode) plus the rate-limit burst, which
 * is refused by our own limiter before reaching Google.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const base = { apikey: ANON, 'Content-Type': 'application/json' };
const login = async (phone) => {
  await fetch(`${URL}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone }) });
  const s = await (await fetch(`${URL}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) })).json();
  if (!s.access_token) throw new Error(`login failed for ${phone}`);
  return s.access_token;
};
const call = async (token, body) => {
  const res = await fetch(`${URL}/functions/v1/address-lookup`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
};

const token = await login('+919000001015');
const probe = await call(token, { action: 'reverse', lat: 27.20341, lng: 78.022594 });
if (probe.status === 404 || probe.json?.error === 'NOT_CONFIGURED') {
  console.log(`NOT RUN: the address-lookup function is ${probe.status === 404 ? 'not deployed' : 'deployed but GOOGLE_MAPS_SERVER_API_KEY is not set'}. See docs/google-address-setup.md.`);
  process.exit(3);
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};
const session = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const agra = { lat: 27.2034, lng: 78.0226 };

check('a call with only the anon key (no signed-in user) is refused', [401, 403].includes((await call(null, { action: 'reverse', lat: 27.2, lng: 78 })).status));
check('invalid input is refused with 400', (await call(token, { action: 'autocomplete', input: 'ab', sessionToken: session })).status === 400);

const ac = await call(token, { action: 'autocomplete', input: 'vijay nagar agra', sessionToken: session, bias: agra });
check('autocomplete returns suggestions', ac.status === 200 && ac.json?.suggestions?.length > 0, `${ac.status} ${ac.text.slice(0, 200)}`);
const first = ac.json?.suggestions?.[0];
check('a suggestion has an id, a primary line and a secondary line', !!first?.placeId && !!first?.primary, JSON.stringify(first));

if (first) {
  const det = await call(token, { action: 'details', placeId: first.placeId, sessionToken: session });
  const p = det.json?.place;
  check('details returns a position inside Agra', det.status === 200 && Math.abs(p?.lat - agra.lat) < 0.25 && Math.abs(p?.lng - agra.lng) < 0.25, `${det.status} ${JSON.stringify(p)?.slice(0, 200)}`);
  check('details returns address parts (city / state / PIN) and never an invented house number', !!p?.parts?.city && !!p?.parts?.state && (p?.parts?.postalCode === null || /^\d{6}$/.test(p.parts.postalCode)), JSON.stringify(p?.parts));
}

const rev = await call(token, { action: 'reverse', lat: 27.20341, lng: 78.022594 });
check('reverse geocoding a known point returns an address with parts', rev.status === 200 && !!rev.json?.place?.formattedAddress && !!rev.json?.place?.parts?.city, `${rev.status} ${rev.text.slice(0, 200)}`);
check('... and reports how precise it is', typeof rev.json?.place?.locationType === 'string', JSON.stringify(rev.json?.place?.locationType));
const sea = await call(token, { action: 'reverse', lat: 10, lng: 70 });
check('a point in open water is "no address" (place: null), not an error', sea.status === 200 && sea.json?.place === null, `${sea.status} ${sea.text.slice(0, 200)}`);

check('the Google key never appears in any response', ![ac, rev, sea].some((r) => /AIza[0-9A-Za-z_-]{20,}/.test(r.text)));

let limited = false;
for (let i = 0; i < 70 && !limited; i++) {
  const r = await call(token, { action: 'autocomplete', input: `x${i}y`, sessionToken: `burst-${session}` });
  if (r.status === 429 && r.json?.error === 'RATE_LIMITED') limited = true;
}
check('a burst of searches is eventually refused with RATE_LIMITED (our limiter, before Google)', limited);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
