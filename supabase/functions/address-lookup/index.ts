// Address search for the app: place suggestions while typing, the chosen place's coordinates and address parts, and
// reverse geocoding for a dropped pin — all through Google Maps Platform, with the API key kept HERE.
//
// Why a server in the middle: the web-service key (Places API New + Geocoding API) must not ship inside the app, and every
// request costs money. This function (1) only answers signed-in customers, (2) rate-limits each of them
// (enforce_rate_limit('places_lookup')), (3) validates every input before it is forwarded, (4) asks Google for the
// cheapest field set that answers the question (Essentials only; Autocomplete + Place Details share one billing session
// via sessionToken), and (5) returns a small normalised shape instead of Google's raw payload.
//
// Secret (Supabase → Edge Functions → Secrets, never in the app):  GOOGLE_MAPS_SERVER_API_KEY
// If it is not set the function answers 503 NOT_CONFIGURED and the app falls back to its previous providers.
import {
  BIAS_RADIUS_METERS,
  DETAILS_FIELD_MASK,
  GoogleLookupError,
  PLACES_AUTOCOMPLETE_URL,
  buildAutocompleteBody,
  buildDetailsUrl,
  buildReverseUrl,
  classifyHttpFailure,
  parseAutocompleteResponse,
  parseLookupRequest,
  parsePlaceDetails,
  parseReverseGeocode,
  type ResolvedPlace,
} from '../_shared/googlePlaces.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GOOGLE_KEY = Deno.env.get('GOOGLE_MAPS_SERVER_API_KEY');
const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 2048;

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const fail = (status: number, error: string, message: string) => reply(status, { ok: false, error, message });

function publicPlace(place: ResolvedPlace) {
  return {
    placeId: place.placeId,
    formattedAddress: place.formattedAddress,
    lat: place.location.lat,
    lng: place.location.lng,
    locationType: place.locationType,
    parts: place.parts,
  };
}

async function upstream(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'use POST');
  if (!GOOGLE_KEY) {
    console.error('address-lookup: GOOGLE_MAPS_SERVER_API_KEY is not set');
    return fail(503, 'NOT_CONFIGURED', 'address search is not set up yet');
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail(401, 'UNAUTHENTICATED', 'sign in to search for an address');

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, 'INVALID_REQUEST', 'request is too large');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(400, 'INVALID_REQUEST', 'request body must be JSON');
    }
    const parsed = parseLookupRequest(json);
    if (!parsed.ok) return fail(400, 'INVALID_REQUEST', parsed.message);

    // Per-customer budget. enforce_rate_limit also rejects a caller who is not a signed-in user (anon key only).
    const limitRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/enforce_rate_limit`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: 'places_lookup' }),
    });
    if (!limitRes.ok) {
      const text = await limitRes.text();
      if (text.includes('rate_limit_exceeded')) return fail(429, 'RATE_LIMITED', 'too many searches — wait a moment');
      if (text.includes('not authenticated')) return fail(401, 'UNAUTHENTICATED', 'sign in to search for an address');
      console.error('address-lookup: rate limit check failed with status', limitRes.status);
      return fail(503, 'NOT_CONFIGURED', 'address search is not available right now');
    }

    const request = parsed.request;

    if (request.action === 'autocomplete') {
      const res = await upstream(PLACES_AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY },
        body: JSON.stringify(buildAutocompleteBody(request)),
      });
      if (!res.ok) throw classifyHttpFailure(res.status);
      return reply(200, { ok: true, suggestions: parseAutocompleteResponse(await res.json()), biasRadiusMeters: request.bias ? BIAS_RADIUS_METERS : null });
    }

    if (request.action === 'details') {
      const res = await upstream(buildDetailsUrl(request.placeId, request.sessionToken), {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      });
      if (!res.ok) throw classifyHttpFailure(res.status);
      return reply(200, { ok: true, place: publicPlace(parsePlaceDetails(await res.json())) });
    }

    // reverse
    const res = await upstream(buildReverseUrl(request.lat, request.lng, GOOGLE_KEY), { method: 'GET' });
    if (!res.ok) throw classifyHttpFailure(res.status);
    const place = parseReverseGeocode(await res.json());
    return reply(200, { ok: true, place: place ? publicPlace(place) : null });
  } catch (e) {
    if (e instanceof GoogleLookupError) {
      // Kind only: Google's own error text can echo the request and the key restrictions.
      console.error('address-lookup: Google failure', e.kind);
      if (e.kind === 'INVALID_REQUEST') return fail(400, e.kind, 'that search could not be processed');
      if (e.kind === 'NOT_FOUND') return fail(404, e.kind, 'that place could not be found');
      if (e.kind === 'UPSTREAM_BUSY') return fail(503, e.kind, 'address search is busy — try again shortly');
      if (e.kind === 'UPSTREAM_DENIED') return fail(502, e.kind, 'address search is not set up correctly');
      return fail(502, 'UPSTREAM_ERROR', 'address search failed — try again');
    }
    if (e instanceof DOMException && e.name === 'AbortError') return fail(504, 'UPSTREAM_TIMEOUT', 'address search timed out — try again');
    console.error('address-lookup: unexpected failure');
    return fail(500, 'INTERNAL', 'address search failed — try again');
  }
});
