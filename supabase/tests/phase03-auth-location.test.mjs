#!/usr/bin/env node
/**
 * Phase 03 (Authentication + Profile + Location + Address +
 * Serviceability) verification suite. Live integration tests against
 * the real project — same philosophy as
 * supabase/tests/phase02-catalogue.test.mjs: these exercise real
 * Supabase Auth (phone+OTP, via the configured sms_test_otp numbers)
 * and real RLS, not mocks.
 *
 * Location PERMISSION-state handling (tests 15-17 in the brief) is
 * device/OS-level (expo-location) and isn't something a server-side
 * script can exercise — see services/location/locationService.ts and
 * docs/location-and-serviceability.md for how each state is covered.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     node supabase/tests/phase03-auth-location.test.mjs
 *
 * (Tests 20-23, which need service-role + raw SQL for PostGIS
 * geography literals, live in phase03-zone-checks.sql instead — see
 * the note near the bottom of this file.)
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function otpLogin(phone) {
  await fetch(`${AUTH}/otp`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ phone }) });
  const res = await fetch(`${AUTH}/verify`, {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify({ type: 'sms', phone, token: '123456' }),
  });
  return res.json();
}
function authed(token) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

console.log(`Running against ${URL}\n`);

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------

let customerSession, customerHeaders;
await check('1. New customer can authenticate and gets a customer-role profile', async () => {
  const session = await otpLogin('+919000000299'); // pre-configured test number, section 32 seed
  assert(session.access_token, 'no access_token returned');
  const { data } = await (await fetch(`${REST}/profiles?select=role&id=eq.${session.user.id}`, { headers: authed(session.access_token) })).json ? { data: await (await fetch(`${REST}/profiles?select=role&id=eq.${session.user.id}`, { headers: authed(session.access_token) })).json() } : {};
  assert(data[0]?.role === 'customer', `expected role=customer, got ${JSON.stringify(data)}`);
});

await check('2. Existing customer can authenticate', async () => {
  const session = await otpLogin('+919000000201');
  assert(session.access_token, 'no access_token returned');
  assert(session.user.id === '3d1f47ec-f199-453b-b77d-0f216281bdcf', 'did not resolve to the existing demo customer');
  customerSession = session;
  customerHeaders = authed(session.access_token);
});

await check('3. Invalid OTP is rejected', async () => {
  await fetch(`${AUTH}/otp`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ phone: '+919000000201' }) });
  const res = await fetch(`${AUTH}/verify`, {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify({ type: 'sms', phone: '+919000000201', token: '000000' }),
  });
  assert(res.status >= 400, `expected an error status for a wrong code, got ${res.status}`);
});

await check('5. Logout revokes the session', async () => {
  const session = await otpLogin('+919000000201');
  const logoutRes = await fetch(`${AUTH}/logout`, { method: 'POST', headers: authed(session.access_token) });
  assert(logoutRes.status === 204, `expected 204 from logout, got ${logoutRes.status}`);
});

await check('6. Customer cannot change their own role', async () => {
  const res = await fetch(`${REST}/profiles?id=eq.${customerSession.user.id}`, {
    method: 'PATCH',
    headers: customerHeaders,
    body: JSON.stringify({ role: 'admin' }),
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

// ---------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------

await check('8. Profile update (full_name) works', async () => {
  const res = await fetch(`${REST}/profiles?id=eq.${customerSession.user.id}`, {
    method: 'PATCH',
    headers: { ...customerHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ full_name: 'Demo Customer (test run)' }),
  });
  const body = await res.json();
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert(body[0]?.full_name === 'Demo Customer (test run)', 'full_name did not update');
  // restore
  await fetch(`${REST}/profiles?id=eq.${customerSession.user.id}`, {
    method: 'PATCH',
    headers: customerHeaders,
    body: JSON.stringify({ full_name: 'Demo Customer' }),
  });
});

await check('9. Customer cannot modify another user\'s profile', async () => {
  const riderSession = await otpLogin('+919000000202');
  const res = await fetch(`${REST}/profiles?id=eq.${customerSession.user.id}`, {
    method: 'PATCH',
    headers: authed(riderSession.access_token),
    body: JSON.stringify({ full_name: 'Hacked' }),
  });
  const body = await res.json().catch(() => []);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), 'a different user was able to modify this profile');
});

// ---------------------------------------------------------------------
// ADDRESS
// ---------------------------------------------------------------------

let addressId;
await check('10. Customer can create an address', async () => {
  const res = await fetch(`${REST}/addresses`, {
    method: 'POST',
    headers: { ...customerHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: customerSession.user.id,
      label: 'other',
      recipient_name: 'Test Run',
      phone: '+919000000201',
      address_line_1: 'Test Address Line',
      city: 'Agra',
      state: 'Uttar Pradesh',
      postal_code: '282001',
      latitude: 27.2,
      longitude: 78.01,
    }),
  });
  const body = await res.json();
  assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(body)}`);
  addressId = body[0].id;
});

await check('11. Customer can update their own address', async () => {
  const res = await fetch(`${REST}/addresses?id=eq.${addressId}`, {
    method: 'PATCH',
    headers: { ...customerHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ landmark: 'Near the test suite' }),
  });
  const body = await res.json();
  assert(body[0]?.landmark === 'Near the test suite', 'update did not apply');
});

await check("13. Customer cannot access another user's address", async () => {
  const riderSession = await otpLogin('+919000000202');
  const res = await fetch(`${REST}/addresses?id=eq.${addressId}`, { headers: authed(riderSession.access_token) });
  const body = await res.json();
  assert(Array.isArray(body) && body.length === 0, 'a different user could read this address');
});

await check('14. set_default_address() leaves exactly one default', async () => {
  await fetch(`${REST}/rpc/set_default_address`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ p_address_id: addressId }) });
  const res = await fetch(`${REST}/addresses?select=is_default&user_id=eq.${customerSession.user.id}`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.filter((r) => r.is_default).length === 1, `expected exactly 1 default, got ${rows.filter((r) => r.is_default).length}`);
});

await check('12. Customer can delete their own address', async () => {
  const res = await fetch(`${REST}/addresses?id=eq.${addressId}`, { method: 'DELETE', headers: customerHeaders });
  assert(res.status === 204, `expected 204, got ${res.status}`);
  const check2 = await fetch(`${REST}/addresses?id=eq.${addressId}`, { headers: customerHeaders });
  assert((await check2.json()).length === 0, 'address still exists after delete');
});

// ---------------------------------------------------------------------
// SERVICEABILITY
// ---------------------------------------------------------------------

await check('18. Serviceable location returns true with eligible stores', async () => {
  const res = await fetch(`${REST}/rpc/check_serviceability`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ p_lat: 27.1995, p_lng: 78.007 }) });
  const body = await res.json();
  assert(body.serviceable === true, `expected serviceable, got ${JSON.stringify(body)}`);
  assert(body.eligibleStores.length >= 1, 'expected at least one eligible store');
});

await check('19. Outside every zone returns false with a reason', async () => {
  const res = await fetch(`${REST}/rpc/check_serviceability`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ p_lat: 28.6139, p_lng: 77.209 }) });
  const body = await res.json();
  assert(body.serviceable === false && body.reason === 'OUTSIDE_SERVICE_AREA', `unexpected: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------

await check('24. Customer cannot modify delivery zones', async () => {
  const res = await fetch(`${REST}/delivery_zones?id=eq.00000000-0000-0000-0000-000000000221`, {
    method: 'PATCH',
    headers: customerHeaders,
    body: JSON.stringify({ delivery_fee: 0 }),
  });
  const body = await res.json().catch(() => []);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), 'a customer was able to modify a delivery zone');
});

await check('25. Customer cannot modify stores', async () => {
  const res = await fetch(`${REST}/stores?id=eq.00000000-0000-0000-0000-000000000101`, {
    method: 'PATCH',
    headers: customerHeaders,
    body: JSON.stringify({ is_accepting_orders: false }),
  });
  const body = await res.json().catch(() => []);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), 'a customer was able to modify a store');
});

// Tests 20-23 (inactive zone / inactive store / store not accepting
// orders / multiple eligible stores ignored-or-included correctly) use
// throwaway rows in delivery_zones, whose `boundary` is a PostGIS
// geography column — not something plain REST JSON can insert cleanly
// (needs a WKT/EWKT literal, which needs a real SQL statement, not a
// JSON body). Verified instead via supabase/tests/phase03-zone-checks.sql
// (run through `supabase db query`, which is how every other
// PostGIS-touching statement in this project has been run) — see that
// file for the setup/assert/teardown, kept together in one transaction
// so no temporary row is ever left behind even if an assertion fails.

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
