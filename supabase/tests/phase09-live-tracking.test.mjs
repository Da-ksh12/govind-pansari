#!/usr/bin/env node
/**
 * Phase 09 (Live GPS + Real-time Rider Tracking) verification suite.
 * Same live-integration philosophy as every prior phase: real Auth
 * sessions, real PostgREST/RPC calls, real RLS.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/phase09-live-tracking.test.mjs
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

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
  const res = await fetch(`${AUTH}/verify`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) });
  return res.json();
}
function authed(token) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function rpc(headers, name, body) {
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
async function addToCart(headers, variantId, qty = 1) {
  const r = await rpc(headers, 'add_to_cart', { p_variant_id: variantId, p_quantity: qty });
  assert(r.status === 200, `add_to_cart(${variantId}) failed: ${r.status} ${JSON.stringify(r.body)}`);
}
async function resetCart(userId) {
  const cartRes = await fetch(`${REST}/carts?user_id=eq.${userId}&select=id`, { headers: svcHeaders });
  const carts = await cartRes.json();
  if (carts[0]) await fetch(`${REST}/cart_items?cart_id=eq.${carts[0].id}`, { method: 'DELETE', headers: svcHeaders });
}
async function createAddress(headers, { lat, lng, name, userId }) {
  const res = await fetch(`${REST}/addresses`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: userId, label: 'home', recipient_name: name, phone: '+919876500000',
      address_line_1: '1 Test Lane', city: 'Agra', state: 'Uttar Pradesh', postal_code: '282001',
      latitude: lat, longitude: lng, is_default: false,
    }),
  });
  const rows = await res.json();
  assert(res.status === 201, `address create failed: ${JSON.stringify(rows)}`);
  return rows[0].id;
}
async function placeOrder(headers, addressId, key) {
  const { body } = await rpc(headers, 'create_order_from_cart', { p_address_id: addressId, p_idempotency_key: key });
  assert(body.success === true, `order creation failed: ${JSON.stringify(body)}`);
  return body.orderId;
}
function newKey() {
  return `test09-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const STORE_101 = '00000000-0000-0000-0000-000000000101';
const V_ALMOND_500 = '00000000-0000-0000-0000-000000000403';
const ADDR_NEAR_101 = { lat: 27.199, lng: 78.0064 };

console.log(`Running against ${URL}\n`);

const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
const customer2 = await otpLogin('+919000000299');
const customer2Headers = authed(customer2.access_token);
const rider = await otpLogin('+919000000202');
const riderHeaders = authed(rider.access_token);
const rider2 = await otpLogin('+919000000206');
const rider2Headers = authed(rider2.access_token);
const manager1 = await otpLogin('+919000000203');
const manager1Headers = authed(manager1.access_token);
const manager2 = await otpLogin('+919000000205');
const manager2Headers = authed(manager2.access_token);

async function getRiderRow(profileId) {
  const res = await fetch(`${REST}/riders?profile_id=eq.${profileId}&select=id,is_active,is_available`, { headers: svcHeaders });
  return (await res.json())[0];
}
const riderRow = await getRiderRow(rider.user.id);
const rider2Row = await getRiderRow(rider2.user.id);

// Hermetic baseline — same disciplines Phase 05/07/08 needed.
const savedHours101 = await fetch(`${REST}/stores?id=eq.${STORE_101}&select=opening_time,closing_time,is_active,is_accepting_orders`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
await fetch(`${REST}/stores?id=eq.${STORE_101}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ opening_time: '00:00', closing_time: '23:59', is_active: true, is_accepting_orders: true }) });
await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ quantity: 500, reserved_quantity: 0, is_available: true }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_available: true, max_active_deliveries: 1 }) });
await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_available: true, max_active_deliveries: 1 }) });

// demo.manager/demo riders are real operational logins for the actual
// stores now (Sanjay Place isn't real) — pin them to store 101 for this
// run and restore their real assignment after, same idiom as savedHours101.
const savedManager1Staff = await fetch(`${REST}/store_staff?user_id=eq.${manager1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedRiderStore = await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=primary_store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]?.primary_store_id);
const savedRider2Store = await fetch(`${REST}/riders?id=eq.${rider2Row.id}&select=primary_store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]?.primary_store_id);
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: STORE_101 }) });
await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: STORE_101 }) });
await fetch(`${REST}/delivery_assignments?rider_id=eq.${riderRow.id}&status=not.in.(completed,cancelled,declined,expired,failed)`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
await fetch(`${REST}/delivery_assignments?rider_id=eq.${rider2Row.id}&status=not.in.(completed,cancelled,declined,expired,failed)`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
await resetCart(customer.user.id);

const addrNear = await createAddress(customerHeaders, { ...ADDR_NEAR_101, name: 'Test Customer', userId: customer.user.id });
const createdAddresses = [{ headers: customerHeaders, id: addrNear }];

async function fullyPackOrder() {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  const orderId = await placeOrder(customerHeaders, addrNear, newKey());
  await rpc(manager1Headers, 'accept_order', { p_order_id: orderId });
  for (const status of ['preparing', 'picking']) {
    await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId, p_new_status: status });
  }
  const itemsRes = await fetch(`${REST}/order_items?order_id=eq.${orderId}&select=id`, { headers: manager1Headers });
  for (const item of await itemsRes.json()) {
    await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: item.id, p_status: 'picked' });
  }
  for (const status of ['packing', 'packed']) {
    await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId, p_new_status: status });
  }
  return orderId;
}
async function getOrderNumber(orderId) {
  const res = await fetch(`${REST}/orders?id=eq.${orderId}&select=order_number`, { headers: manager1Headers });
  return (await res.json())[0].order_number;
}

// ---------------------------------------------------------------------
// Tracking eligibility
// ---------------------------------------------------------------------

let order1, assignment1;
await check('1. Rider cannot submit location before the assignment is accepted', async () => {
  order1 = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order1, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup failed: ${JSON.stringify(assign.body)}`);
  assignment1 = assign.body;

  const { status } = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.199, p_longitude: 78.0064 });
  assert(status >= 400, `expected rejection (only 'assigned', not yet accepted), got ${status}`);
});

await check('2. Location succeeds once accepted, and riders.current_lat/lng is synced', async () => {
  await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment1 });
  const { status, body } = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.199, p_longitude: 78.0064, p_accuracy: 8, p_heading: 90, p_speed: 5 });
  assert(status === 200 && body.success === true, `expected success, got ${status}: ${JSON.stringify(body)}`);
  assert(body.deliveryId === assignment1, `expected deliveryId ${assignment1}, got ${body.deliveryId}`);
  assert(body.flagged === false, `expected first ping not flagged, got ${JSON.stringify(body)}`);

  const row = (await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=current_latitude,current_longitude`, { headers: svcHeaders }).then((r) => r.json()))[0];
  assert(Math.abs(row.current_latitude - 27.199) < 0.0001, `expected current_latitude synced, got ${row.current_latitude}`);
});

await check('3. Invalid latitude/longitude rejected', async () => {
  const badLat = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 95, p_longitude: 78.0064 });
  assert(badLat.status >= 400, `expected rejection for lat=95, got ${badLat.status}`);
  const badLng = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.199, p_longitude: -190 });
  assert(badLng.status >= 400, `expected rejection for lng=-190, got ${badLng.status}`);
});

await check('4. An implausible jump is flagged as an outlier and does not move the fast-read current location', async () => {
  const before = (await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=current_latitude,current_longitude`, { headers: svcHeaders }).then((r) => r.json()))[0];
  // ~150km away, submitted moments after the last real ping — no real vehicle covers that in a few seconds.
  const { status, body } = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 28.6139, p_longitude: 77.2090 });
  assert(status === 200, `expected the ping to still be accepted (flagged, not rejected), got ${status}`);
  assert(body.flagged === true, `expected this jump to be flagged as an outlier, got ${JSON.stringify(body)}`);

  const after = (await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=current_latitude,current_longitude`, { headers: svcHeaders }).then((r) => r.json()))[0];
  assert(Math.abs(after.current_latitude - before.current_latitude) < 0.0001, `expected current_latitude unchanged by the flagged outlier, before=${before.current_latitude} after=${after.current_latitude}`);

  // Restore a plausible position for subsequent tests.
  await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.1991, p_longitude: 78.0065 });
});

// ---------------------------------------------------------------------
// get_delivery_tracking authorization
// ---------------------------------------------------------------------

await check("5. The order's own customer can read tracking", async () => {
  const { status, body } = await rpc(customerHeaders, 'get_delivery_tracking', { p_order_id: order1 });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.deliveryStatus === 'accepted', `expected accepted, got ${body.deliveryStatus}`);
  assert(body.currentLocation && Math.abs(body.currentLocation.latitude - 27.1991) < 0.001, `expected the latest good (non-outlier) location, got ${JSON.stringify(body.currentLocation)}`);
});

await check('6. A different customer cannot read this tracking', async () => {
  const { status } = await rpc(customer2Headers, 'get_delivery_tracking', { p_order_id: order1 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('7. The assigned rider can read their own delivery tracking', async () => {
  const { status } = await rpc(riderHeaders, 'get_delivery_tracking', { p_order_id: order1 });
  assert(status === 200, `expected 200, got ${status}`);
});

await check("8. Store staff of the fulfilling store can read tracking", async () => {
  const { status } = await rpc(manager1Headers, 'get_delivery_tracking', { p_order_id: order1 });
  assert(status === 200, `expected 200, got ${status}`);
});

await check('9. A manager of a different store cannot read this tracking', async () => {
  const { status } = await rpc(manager2Headers, 'get_delivery_tracking', { p_order_id: order1 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('10. Anonymous cannot call either tracking function', async () => {
  const s1 = await rpc(anonHeaders, 'get_delivery_tracking', { p_order_id: order1 });
  assert(s1.status === 401 || s1.status === 403, `expected 401/403, got ${s1.status}`);
  const s2 = await rpc(anonHeaders, 'submit_rider_location', { p_latitude: 27.2, p_longitude: 78.0 });
  assert(s2.status === 401 || s2.status === 403, `expected 401/403, got ${s2.status}`);
});

// ---------------------------------------------------------------------
// Direct table access is blocked — only the function can write
// ---------------------------------------------------------------------

await check('11. A rider cannot INSERT directly into rider_locations via REST', async () => {
  const res = await fetch(`${REST}/rider_locations`, {
    method: 'POST',
    headers: { ...riderHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ rider_id: riderRow.id, delivery_id: assignment1, latitude: 27.2, longitude: 78.0 }),
  });
  assert(res.status >= 400, `expected the direct insert to be rejected, got ${res.status}`);
});

// ---------------------------------------------------------------------
// RLS on rider_locations reads
// ---------------------------------------------------------------------

await check('12. The customer with an active delivery from this rider can read rider_locations rows', async () => {
  const res = await fetch(`${REST}/rider_locations?delivery_id=eq.${assignment1}&limit=1`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected the customer to see at least one location row, got ${rows.length}`);
});

await check("13. A different customer cannot read this rider's location rows", async () => {
  const res = await fetch(`${REST}/rider_locations?delivery_id=eq.${assignment1}&limit=1`, { headers: customer2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected RLS to hide these rows from an unrelated customer, got ${rows.length}`);
});

// ---------------------------------------------------------------------
// Tracking through the rest of the delivery lifecycle
// ---------------------------------------------------------------------

await check('14. Location tracking continues through at_store/picked_up/in_transit', async () => {
  await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignment1 });
  const atStore = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.199, p_longitude: 78.0064 });
  assert(atStore.status === 200, `expected location to succeed at_store, got ${atStore.status}`);

  const orderNumber = await getOrderNumber(order1);
  await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignment1, p_order_number: orderNumber });
  await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignment1 });
  const inTransit = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.2, p_longitude: 78.007 });
  assert(inTransit.status === 200, `expected location to succeed in_transit, got ${inTransit.status}`);

  const tracking = await rpc(customerHeaders, 'get_delivery_tracking', { p_order_id: order1 });
  assert(tracking.body.deliveryStatus === 'in_transit' && tracking.body.orderStatus === 'out_for_delivery', `unexpected: ${JSON.stringify(tracking.body)}`);
});

await check('15. After delivery completes, the rider can no longer submit location, but tracking is still readable', async () => {
  await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment1, p_proof_photo_url: `${assignment1}/test-proof.jpg`, p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });

  const { status } = await rpc(riderHeaders, 'submit_rider_location', { p_latitude: 27.2, p_longitude: 78.007 });
  assert(status >= 400, `expected rejection after delivery completion, got ${status}`);

  const tracking = await rpc(customerHeaders, 'get_delivery_tracking', { p_order_id: order1 });
  assert(tracking.status === 200 && tracking.body.deliveryStatus === 'completed', `expected completed, got ${JSON.stringify(tracking.body)}`);
});

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------

await fetch(`${REST}/stores?id=eq.${STORE_101}`, {
  method: 'PATCH', headers: svcHeaders,
  body: JSON.stringify({ opening_time: savedHours101.opening_time, closing_time: savedHours101.closing_time, is_active: savedHours101.is_active, is_accepting_orders: savedHours101.is_accepting_orders }),
});
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedManager1Staff.store_id }) });
if (savedRiderStore) await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: savedRiderStore }) });
if (savedRider2Store) await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: savedRider2Store }) });
for (const a of createdAddresses) {
  await fetch(`${REST}/addresses?id=eq.${a.id}`, { method: 'DELETE', headers: a.headers });
}
void rider2Headers;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
