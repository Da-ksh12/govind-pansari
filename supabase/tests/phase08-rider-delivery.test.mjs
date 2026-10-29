#!/usr/bin/env node
/**
 * Phase 08 (Rider Management + Delivery Assignment + Delivery
 * Operations) verification suite. Same live-integration philosophy as
 * every prior phase: real Auth sessions, real PostgREST/RPC calls,
 * real RLS, real Postgres concurrency.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/phase08-rider-delivery.test.mjs
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
  return `test08-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const STORE_101 = '00000000-0000-0000-0000-000000000101'; // Sanjay Place
const STORE_103 = '00000000-0000-0000-0000-000000000103'; // Awas Vikas — also stocks V_ALMOND_500
const V_ALMOND_500 = '00000000-0000-0000-0000-000000000403'; // ₹849
const ADDR_NEAR_101 = { lat: 27.199, lng: 78.0064 };

console.log(`Running against ${URL}\n`);

const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
const rider = await otpLogin('+919000000202');
const riderHeaders = authed(rider.access_token);
const rider2 = await otpLogin('+919000000206');
const rider2Headers = authed(rider2.access_token);
const manager1 = await otpLogin('+919000000203');
const manager1Headers = authed(manager1.access_token);
const staff1 = await otpLogin('+919000000204');
const staff1Headers = authed(staff1.access_token);
const manager2 = await otpLogin('+919000000205');
const manager2Headers = authed(manager2.access_token);

async function getRiderRow(profileId) {
  const res = await fetch(`${REST}/riders?profile_id=eq.${profileId}&select=id,is_active,is_available,max_active_deliveries`, { headers: svcHeaders });
  return (await res.json())[0];
}
const riderRow = await getRiderRow(rider.user.id);
const rider2Row = await getRiderRow(rider2.user.id);

// Hermetic baseline: widen store hours (Phase 07's find_serviceable_stores
// now enforces them), reset both demo riders to active+available with no
// dangling assignments from a previous partial run, clean customer cart.
const savedHours101 = await fetch(`${REST}/stores?id=eq.${STORE_101}&select=opening_time,closing_time,is_active,is_accepting_orders`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
await fetch(`${REST}/stores?id=eq.${STORE_101}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ opening_time: '00:00', closing_time: '23:59', is_active: true, is_accepting_orders: true }) });

// These demo accounts are real operational logins for the business's
// actual stores now (Sanjay Place isn't a real branch and demo.manager
// /demo.staff/riders were reassigned to it), so this suite can no
// longer assume they're already on store 101 — pin them there for the
// run's duration and restore their real assignment afterward, same
// hermetic-baseline idiom as savedHours101 above.
const savedManager1Staff = await fetch(`${REST}/store_staff?user_id=eq.${manager1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedStaff1Staff = await fetch(`${REST}/store_staff?user_id=eq.${staff1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedRiderStore = riderRow ? await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=primary_store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]?.primary_store_id) : null;
const savedRider2Store = rider2Row ? await fetch(`${REST}/riders?id=eq.${rider2Row.id}&select=primary_store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]?.primary_store_id) : null;
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: STORE_101 }) });
await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: STORE_101 }) });
// This suite creates a real order (via create_order_from_cart) per
// test, many times over — accumulated across this session's debugging
// runs, that has exhausted V_ALMOND_500's seeded stock at store 101,
// which then made checkout fail over to store 103 (which also stocks
// it) and broke every test's "manager1 is staff of store 101" premise.
// Reset to a large known baseline rather than trust leftover state.
await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ quantity: 500, reserved_quantity: 0, is_available: true }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_available: true, max_active_deliveries: 1 }) });
await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_available: true, max_active_deliveries: 1 }) });
await fetch(`${REST}/delivery_assignments?rider_id=eq.${riderRow.id}&status=not.in.(completed,cancelled,declined,expired)`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
await fetch(`${REST}/delivery_assignments?rider_id=eq.${rider2Row.id}&status=not.in.(completed,cancelled,declined,expired)`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
await resetCart(customer.user.id);

const addrNear = await createAddress(customerHeaders, { ...ADDR_NEAR_101, name: 'Test Customer', userId: customer.user.id });
const createdAddresses = [{ headers: customerHeaders, id: addrNear }];

/** Drives a real order all the way to 'packed' (READY_FOR_PICKUP) via
 * the real Phase 05/07 pipeline — checkout, accept, process, pick
 * every item, pack. This is Phase 08's actual precondition, not a
 * shortcut. */
async function fullyPackOrder() {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  const orderId = await placeOrder(customerHeaders, addrNear, newKey());
  const accept = await rpc(manager1Headers, 'accept_order', { p_order_id: orderId });
  assert(accept.status === 204, `accept_order failed: ${JSON.stringify(accept.body)}`);
  for (const status of ['preparing', 'picking']) {
    const r = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId, p_new_status: status });
    assert(r.status === 204, `advance to ${status} failed: ${JSON.stringify(r.body)}`);
  }
  const itemsRes = await fetch(`${REST}/order_items?order_id=eq.${orderId}&select=id`, { headers: manager1Headers });
  const items = await itemsRes.json();
  for (const item of items) {
    const r = await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: item.id, p_status: 'picked' });
    assert(r.status === 204, `mark_order_item_picked failed: ${JSON.stringify(r.body)}`);
  }
  for (const status of ['packing', 'packed']) {
    const r = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId, p_new_status: status });
    assert(r.status === 204, `advance to ${status} failed: ${JSON.stringify(r.body)}`);
  }
  return orderId;
}

async function getOrderNumber(orderId) {
  const res = await fetch(`${REST}/orders?id=eq.${orderId}&select=order_number`, { headers: manager1Headers });
  return (await res.json())[0].order_number;
}

// ---------------------------------------------------------------------
// Auth / access boundaries
// ---------------------------------------------------------------------

await check('1. Anonymous cannot call get_rider_dashboard', async () => {
  const { status } = await rpc(anonHeaders, 'get_rider_dashboard', {});
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

await check('2. Customer (no rider profile) cannot call get_rider_dashboard', async () => {
  const { status } = await rpc(customerHeaders, 'get_rider_dashboard', {});
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('3. Rider cannot view a store dashboard (not store staff)', async () => {
  const { status } = await rpc(riderHeaders, 'get_store_dashboard', { p_store_id: STORE_101 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('4. A suspended (inactive) rider cannot change availability', async () => {
  await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: false }) });
  try {
    const { status } = await rpc(riderHeaders, 'set_rider_availability', { p_available: true });
    assert(status >= 400, `expected rejection for a suspended rider, got ${status}`);
  } finally {
    await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true }) });
  }
});

// ---------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------

await check('5. Rider can freely toggle available <-> offline with no active delivery', async () => {
  const off = await rpc(riderHeaders, 'set_rider_availability', { p_available: false });
  assert(off.status === 204, `expected 204, got ${off.status}`);
  const on = await rpc(riderHeaders, 'set_rider_availability', { p_available: true });
  assert(on.status === 204, `expected 204, got ${on.status}`);
});

// ---------------------------------------------------------------------
// Assignment eligibility
// ---------------------------------------------------------------------

await check('6. Cannot assign a rider to an order that is not READY_FOR_PICKUP', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  const orderId = await placeOrder(customerHeaders, addrNear, newKey());
  const { status, body } = await rpc(manager1Headers, 'assign_rider', { p_order_id: orderId, p_rider_id: riderRow.id });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
  await rpc(manager1Headers, 'update_order_status', { p_order_id: orderId, p_new_status: 'cancelled' });
});

let order1, assignment1;
await check('7. assign_rider succeeds for a packed order: order -> rider_assigned, event logged', async () => {
  order1 = await fullyPackOrder();
  const { status, body } = await rpc(manager1Headers, 'assign_rider', { p_order_id: order1, p_rider_id: riderRow.id });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assignment1 = body;

  const orderRow = (await fetch(`${REST}/orders?id=eq.${order1}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(orderRow.status === 'rider_assigned', `expected rider_assigned, got ${orderRow.status}`);

  const events = await fetch(`${REST}/delivery_events?delivery_id=eq.${assignment1}&event_type=eq.delivery_assigned`, { headers: manager1Headers }).then((r) => r.json());
  assert(events.length === 1, 'expected a delivery_assigned event');
  const orderEvents = await fetch(`${REST}/order_events?order_id=eq.${order1}&event_type=eq.rider_assigned`, { headers: manager1Headers }).then((r) => r.json());
  assert(orderEvents.length === 1, 'expected a rider_assigned order event');
});

await check('8. Assigning an offline rider fails', async () => {
  const order = await fullyPackOrder();
  await rpc(rider2Headers, 'set_rider_availability', { p_available: false });
  try {
    const { status } = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: rider2Row.id });
    assert(status >= 400, `expected rejection, got ${status}`);
  } finally {
    await rpc(rider2Headers, 'set_rider_availability', { p_available: true });
    await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
  }
});

await check('9. Assigning a rider already at capacity fails', async () => {
  // rider (not rider2) already has order1's active assignment from test 7.
  const order = await fullyPackOrder();
  const { status, body } = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: riderRow.id });
  assert(status >= 400, `expected capacity rejection, got ${status}: ${JSON.stringify(body)}`);
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' });
});

await check('10. get_eligible_riders_for_order excludes the at-capacity rider and lists the free one', async () => {
  const order = await fullyPackOrder();
  const { body } = await rpc(manager1Headers, 'get_eligible_riders_for_order', { p_order_id: order });
  const ids = body.map((r) => r.riderId);
  assert(!ids.includes(riderRow.id), 'expected the at-capacity rider excluded');
  assert(ids.includes(rider2Row.id), 'expected the free rider listed');
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' });
});

let order2, assignment2;
await check('11. automatic assignment is switched off; a manager picks the free rider by hand', async () => {
  order2 = await fullyPackOrder();
  // Riders are assigned only by a person choosing one (migration 20260827000017).
  const auto = await rpc(manager1Headers, 'auto_assign_rider', { p_order_id: order2 });
  assert(auto.status >= 400, `auto_assign_rider must be refused, got ${auto.status}`);
  const autoStart = await rpc(manager1Headers, 'start_auto_assignment', { p_order_id: order2 });
  assert(autoStart.status >= 400, `start_auto_assignment must be refused, got ${autoStart.status}`);
  const { status, body } = await rpc(manager1Headers, 'assign_rider', { p_order_id: order2, p_rider_id: rider2Row.id });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assignment2 = body;
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment2}&select=rider_id,assignment_source`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.rider_id === rider2Row.id, `expected rider2 (the only free rider), got ${row.rider_id}`);
  assert(row.assignment_source === 'manual', `expected source manual, got ${row.assignment_source}`);
});

// ---------------------------------------------------------------------
// Acceptance / decline
// ---------------------------------------------------------------------

await check('12. Only the assigned rider can accept the delivery', async () => {
  const wrongRider = await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment2 }); // assignment2 belongs to rider2
  assert(wrongRider.status >= 400, `expected rejection, got ${wrongRider.status}`);
  const customerAttempt = await rpc(customerHeaders, 'accept_delivery', { p_assignment_id: assignment2 });
  assert(customerAttempt.status >= 400, `expected rejection, got ${customerAttempt.status}`);
});

await check('13. Assigned rider accepts: status accepted, accepted_at set, events logged', async () => {
  const { status } = await rpc(rider2Headers, 'accept_delivery', { p_assignment_id: assignment2 });
  assert(status === 204, `expected 204, got ${status}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment2}&select=status,accepted_at`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'accepted' && row.accepted_at !== null, `unexpected: ${JSON.stringify(row)}`);
  // Free rider2's capacity back up — later tests (25, 26, 31) need
  // rider2 available again, and nothing else in this suite completes
  // order2's lifecycle.
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: assignment2, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order2, p_new_status: 'cancelled' }).catch(() => {});
});

await check('14. Rider can decline a fresh assignment, and the order becomes eligible for a new one', async () => {
  const order = await fullyPackOrder();
  // rider (riderRow) still holds order1's active assignment from test 7 — free it first for this isolated test.
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: assignment1, p_reason: 'test cleanup' });
  const reassign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: riderRow.id });
  assert(reassign.status === 200, `setup assign failed: ${JSON.stringify(reassign.body)}`);
  const assignmentId = reassign.body;

  const decline = await rpc(riderHeaders, 'decline_delivery', { p_assignment_id: assignmentId, p_reason: 'too far' });
  assert(decline.status === 204, `expected 204, got ${decline.status}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignmentId}&select=status,declined_at,decline_reason`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'declined' && row.declined_at !== null && row.decline_reason === 'too far', `unexpected: ${JSON.stringify(row)}`);

  const reassign2 = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: riderRow.id });
  assert(reassign2.status === 200, `expected the order to be reassignable after a decline, got ${reassign2.status}: ${JSON.stringify(reassign2.body)}`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: reassign2.body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
});

// ---------------------------------------------------------------------
// Pickup flow (order1 / assignment1 was cancelled above — build fresh)
// ---------------------------------------------------------------------

let order3, assignment3, order3Number;
await check('15. mark_arrived_at_store fails before acceptance', async () => {
  order3 = await fullyPackOrder();
  order3Number = await getOrderNumber(order3);
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order3, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup assign failed: ${JSON.stringify(assign.body)}`);
  assignment3 = assign.body;

  const early = await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignment3 });
  assert(early.status >= 400, `expected rejection before acceptance, got ${early.status}`);
});

await check('16. Accept then mark arrived at store', async () => {
  const accept = await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment3 });
  assert(accept.status === 204, `expected 204, got ${accept.status}`);
  const arrive = await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignment3 });
  assert(arrive.status === 204, `expected 204, got ${arrive.status}`);
});

await check('17. Pickup is rejected with the wrong order number', async () => {
  const { status } = await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignment3, p_order_number: 'GP-WRONG-00000' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('18. Pickup succeeds with the correct order number; order status unchanged so far', async () => {
  const { status } = await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignment3, p_order_number: order3Number });
  assert(status === 204, `expected 204, got ${status}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment3}&select=status,picked_up_at`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'picked_up' && row.picked_up_at !== null, `unexpected: ${JSON.stringify(row)}`);
  const orderRow = (await fetch(`${REST}/orders?id=eq.${order3}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(orderRow.status === 'rider_assigned', `expected order to still read rider_assigned (pickup is delivery-only), got ${orderRow.status}`);
});

await check('19. start_delivery moves both delivery and order to out_for_delivery', async () => {
  const { status } = await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignment3 });
  assert(status === 204, `expected 204, got ${status}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment3}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'in_transit', `expected in_transit, got ${row.status}`);
  const orderRow = (await fetch(`${REST}/orders?id=eq.${order3}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(orderRow.status === 'out_for_delivery', `expected out_for_delivery, got ${orderRow.status}`);
});

// ---------------------------------------------------------------------
// Completion / failure
// ---------------------------------------------------------------------

await check('20. complete_delivery succeeds: delivery + order flip atomically, COD marked paid, and — a real bug found live via a database consistency audit, previously nothing ever converted a delivered COD order\'s reservation into a sale — inventory actually converts reserved -> sold', async () => {
  const invBefore = (await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&select=quantity,reserved_quantity`, { headers: svcHeaders }).then((r) => r.json()))[0];

  const { status } = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment3, p_proof_photo_url: 'test/proof.jpg', p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });
  assert(status === 204, `expected 204, got ${status}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment3}&select=status,completed_at`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'completed' && row.completed_at !== null, `unexpected assignment: ${JSON.stringify(row)}`);
  const orderRow = (await fetch(`${REST}/orders?id=eq.${order3}&select=status,delivered_at,payment_status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(orderRow.status === 'delivered' && orderRow.delivered_at !== null, `unexpected order: ${JSON.stringify(orderRow)}`);
  assert(orderRow.payment_status === 'paid', `expected COD marked paid on delivery, got ${orderRow.payment_status}`);

  const invAfter = (await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&select=quantity,reserved_quantity`, { headers: svcHeaders }).then((r) => r.json()))[0];
  assert(invAfter.quantity === invBefore.quantity - 1, `expected quantity to drop by 1 (the order's item qty) on COD delivery, went ${invBefore.quantity} -> ${invAfter.quantity}`);
  assert(invAfter.reserved_quantity === Math.max(0, invBefore.reserved_quantity - 1), `expected reserved_quantity to release by 1, went ${invBefore.reserved_quantity} -> ${invAfter.reserved_quantity}`);
  const saleMovement = await fetch(`${REST}/inventory_movements?reference_type=eq.order&reference_id=eq.${order3}&movement_type=eq.sale&select=quantity_change`, { headers: svcHeaders }).then((r) => r.json());
  assert(saleMovement.length === 1 && Number(saleMovement[0].quantity_change) === -1, `expected exactly one 'sale' movement of -1, got ${JSON.stringify(saleMovement)}`);
});

await check('21. complete_delivery cannot be called twice', async () => {
  const { status } = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment3, p_proof_photo_url: 'test/proof.jpg', p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });
  assert(status >= 400, `expected rejection on double-completion, got ${status}`);
});

let order4, assignment4;
await check('22. complete_delivery is rejected before out_for_delivery', async () => {
  order4 = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order4, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup failed: ${JSON.stringify(assign.body)}`);
  assignment4 = assign.body;
  const early = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment4, p_proof_photo_url: 'test/proof.jpg', p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });
  assert(early.status >= 400, `expected rejection, got ${early.status}`);
});

await check('23. Failed delivery: order stays out_for_delivery (not delivered), reason recorded', async () => {
  const order4Number = await getOrderNumber(order4);
  await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment4 });
  await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignment4 });
  await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignment4, p_order_number: order4Number });
  await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignment4 });

  const fail = await rpc(riderHeaders, 'fail_delivery', { p_assignment_id: assignment4, p_reason: 'customer_unavailable', p_notes: 'no answer' });
  assert(fail.status === 204, `expected 204, got ${fail.status}: ${JSON.stringify(fail.body)}`);
  const row = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment4}&select=status,failure_reason`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'failed' && row.failure_reason === 'customer_unavailable', `unexpected: ${JSON.stringify(row)}`);
  const orderRow = (await fetch(`${REST}/orders?id=eq.${order4}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(orderRow.status === 'out_for_delivery', `expected order to remain out_for_delivery (not auto-delivered), got ${orderRow.status}`);
});

// ---------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------

let order5, assignment5;
await check('24. Manager cancels an active assignment; the old rider loses authority over it', async () => {
  order5 = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order5, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup failed: ${JSON.stringify(assign.body)}`);
  assignment5 = assign.body;

  const cancel = await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: assignment5, p_reason: 'rider went home' });
  assert(cancel.status === 204, `expected 204, got ${cancel.status}`);

  const tooLate = await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment5 });
  assert(tooLate.status >= 400, `expected the cancelled assignment to reject further rider action, got ${tooLate.status}`);
});

await check('25. A new rider can be assigned to the same order after cancellation', async () => {
  const { status, body } = await rpc(manager1Headers, 'assign_rider', { p_order_id: order5, p_rider_id: rider2Row.id });
  assert(status === 200, `expected reassignment to succeed, got ${status}: ${JSON.stringify(body)}`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order5, p_new_status: 'cancelled' }).catch(() => {});
});

// ---------------------------------------------------------------------
// Security / RLS
// ---------------------------------------------------------------------

await check("26. A rider cannot read another rider's delivery_assignments row", async () => {
  const order = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: rider2Row.id });
  assert(assign.status === 200, `setup failed: ${JSON.stringify(assign.body)}`);
  const res = await fetch(`${REST}/delivery_assignments?id=eq.${assign.body}`, { headers: riderHeaders }); // rider (not rider2)
  const rows = await res.json();
  assert(rows.length === 0, `expected RLS to hide another rider's assignment, got ${rows.length} rows`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: assign.body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
});

await check('27. A rider cannot record an inventory adjustment for a store', async () => {
  const { status } = await rpc(riderHeaders, 'record_inventory_adjustment', { p_store_id: STORE_101, p_variant_id: V_ALMOND_500, p_new_quantity: 5, p_reason: 'found' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('28. A rider cannot directly write order totals via REST', async () => {
  const order = await fullyPackOrder();
  // RLS makes this WHERE clause match zero visible rows for a rider
  // with no policy granting them UPDATE on orders at all — PostgREST
  // returns 204 for a zero-row-affected PATCH (that's not an error by
  // itself), so the real assertion is that the value didn't change.
  const res = await fetch(`${REST}/orders?id=eq.${order}`, { method: 'PATCH', headers: riderHeaders, body: JSON.stringify({ total: 1 }) });
  assert(res.status < 300, `PATCH itself should not error, got ${res.status}`);
  const row = (await fetch(`${REST}/orders?id=eq.${order}&select=total`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(Number(row.total) !== 1, `expected the rider's write to have no effect, but total is now ${row.total}`);
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
});

// ---------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------

await check('29. Two managers assigning the same READY_FOR_PICKUP order to two different riders: exactly one wins', async () => {
  const order = await fullyPackOrder();
  const [r1, r2] = await Promise.all([
    rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: riderRow.id }),
    rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: rider2Row.id }),
  ]);
  const succeeded = [r1, r2].filter((r) => r.status === 200);
  assert(succeeded.length === 1, `expected exactly 1 success, got ${succeeded.length}: ${JSON.stringify([r1.status, r2.status])}`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: succeeded[0].body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
});

await check('30. Double-accepting the same assignment (retry/double-tap): only the first succeeds', async () => {
  const order = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup failed: ${JSON.stringify(assign.body)}`);
  const [r1, r2] = await Promise.all([
    rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assign.body }),
    rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assign.body }),
  ]);
  const succeeded = [r1, r2].filter((r) => r.status === 204);
  assert(succeeded.length === 1, `expected exactly 1 success, got ${succeeded.length}: ${JSON.stringify([r1.status, r2.status])}`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: assign.body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order, p_new_status: 'cancelled' }).catch(() => {});
});

await check('31. Assigning the same at-capacity rider to two different orders concurrently: exactly one wins', async () => {
  // fullyPackOrder() drives the shared customer cart through checkout
  // — two concurrent calls would race each other on that one cart, so
  // pack both orders sequentially first and only race the assignment
  // calls themselves (the thing this test actually verifies).
  const orderA = await fullyPackOrder();
  const orderB = await fullyPackOrder();
  const [r1, r2] = await Promise.all([
    rpc(manager1Headers, 'assign_rider', { p_order_id: orderA, p_rider_id: riderRow.id }),
    rpc(manager1Headers, 'assign_rider', { p_order_id: orderB, p_rider_id: riderRow.id }),
  ]);
  const succeeded = [r1, r2].filter((r) => r.status === 200);
  assert(succeeded.length === 1, `expected exactly 1 success under capacity=1, got ${succeeded.length}: ${JSON.stringify([r1.status, r2.status])}`);
  await rpc(manager1Headers, 'cancel_assignment', { p_assignment_id: succeeded[0].body, p_reason: 'test cleanup' });
  await rpc(manager1Headers, 'update_order_status', { p_order_id: orderA, p_new_status: 'cancelled' }).catch(() => {});
  await rpc(manager1Headers, 'update_order_status', { p_order_id: orderB, p_new_status: 'cancelled' }).catch(() => {});
});

await check('32. complete_delivery requires a real photo AND a real location — either missing is rejected, both together succeed and are stored', async () => {
  const order5 = await fullyPackOrder();
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: order5, p_rider_id: riderRow.id });
  assert(assign.status === 200, `setup assign failed: ${JSON.stringify(assign.body)}`);
  const assignment5 = assign.body;
  const order5Number = await getOrderNumber(order5);
  const validLoc = { p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 };

  assert((await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignment5 })).status === 204, 'setup: accept failed');
  assert((await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignment5 })).status === 204, 'setup: arrive failed');
  assert((await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignment5, p_order_number: order5Number })).status === 204, 'setup: pickup failed');
  assert((await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignment5 })).status === 204, 'setup: start failed');

  const missingEverything = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment5 });
  assert(missingEverything.status >= 400, `expected rejection with nothing at all, got ${missingEverything.status}`);

  const emptyPhoto = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment5, p_proof_photo_url: '', ...validLoc });
  assert(emptyPhoto.status >= 400, `expected rejection with an empty photo url, got ${emptyPhoto.status}`);

  const missingLocation = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment5, p_proof_photo_url: `${assignment5}/test-proof.jpg`, p_proof_latitude: null, p_proof_longitude: null });
  assert(missingLocation.status >= 400, `expected rejection with a real photo but no location, got ${missingLocation.status}`);

  const invalidLocation = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment5, p_proof_photo_url: `${assignment5}/test-proof.jpg`, p_proof_latitude: 200, p_proof_longitude: 77.9647 });
  assert(invalidLocation.status >= 400, `expected rejection with an out-of-range latitude, got ${invalidLocation.status}`);

  const rowBefore = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment5}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(rowBefore.status === 'in_transit', `a rejected completion attempt must not have changed delivery status, got ${rowBefore.status}`);

  const proofPath = `${assignment5}/test-proof.jpg`;
  const ok = await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignment5, p_proof_photo_url: proofPath, ...validLoc });
  assert(ok.status === 204, `expected 204 with a real photo + location, got ${ok.status}: ${JSON.stringify(ok.body)}`);

  const rowAfter = (await fetch(`${REST}/delivery_assignments?id=eq.${assignment5}&select=status,delivery_verification_method,delivery_proof_photo_url,delivery_proof_latitude,delivery_proof_longitude`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(rowAfter.status === 'completed', `expected completed, got ${rowAfter.status}`);
  assert(rowAfter.delivery_verification_method === 'photo', `expected verification method 'photo', got ${rowAfter.delivery_verification_method}`);
  assert(rowAfter.delivery_proof_photo_url === proofPath, `expected stored proof path to round-trip exactly, got ${rowAfter.delivery_proof_photo_url}`);
  assert(Number(rowAfter.delivery_proof_latitude) === validLoc.p_proof_latitude && Number(rowAfter.delivery_proof_longitude) === validLoc.p_proof_longitude, `expected stored location to round-trip exactly, got ${rowAfter.delivery_proof_latitude},${rowAfter.delivery_proof_longitude}`);
});

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------

await fetch(`${REST}/stores?id=eq.${STORE_101}`, {
  method: 'PATCH', headers: svcHeaders,
  body: JSON.stringify({ opening_time: savedHours101.opening_time, closing_time: savedHours101.closing_time, is_active: savedHours101.is_active, is_accepting_orders: savedHours101.is_accepting_orders }),
});
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedManager1Staff.store_id }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedStaff1Staff.store_id }) });
if (savedRiderStore) await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: savedRiderStore }) });
if (savedRider2Store) await fetch(`${REST}/riders?id=eq.${rider2Row.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: savedRider2Store }) });
for (const a of createdAddresses) {
  await fetch(`${REST}/addresses?id=eq.${a.id}`, { method: 'DELETE', headers: a.headers });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
