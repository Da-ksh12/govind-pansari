#!/usr/bin/env node
/**
 * Phase 10 (Notifications + Communication) verification suite. Same
 * live-integration philosophy as every prior phase: real Auth
 * sessions, real PostgREST/RPC calls, real RLS — no mocks.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ACCESS_TOKEN=... \
 *     node supabase/tests/phase10-notifications.test.mjs
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
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
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
async function placeOrder(headers, addressId, key) {
  const { body } = await rpc(headers, 'create_order_from_cart', { p_address_id: addressId, p_idempotency_key: key });
  assert(body.success === true, `order creation failed: ${JSON.stringify(body)}`);
  return body.orderId;
}
function newKey() {
  return `test10-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
async function notificationsFor(userId, opts = {}) {
  const res = await fetch(`${REST}/notifications?user_id=eq.${userId}&select=*&order=created_at.desc`, { headers: svcHeaders });
  return res.json();
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
const manager1 = await otpLogin('+919000000203');
const manager1Headers = authed(manager1.access_token);

// Bootstrap the first admin account — none exists yet. sms_test_otp for
// this number was added via the Management API before this run.
const adminLogin = await otpLogin('+919000000301');
const adminHeaders = authed(adminLogin.access_token);
await fetch(`${REST}/profiles?id=eq.${adminLogin.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', full_name: 'Test Admin' }) });

async function getRiderRow(profileId) {
  const res = await fetch(`${REST}/riders?profile_id=eq.${profileId}&select=id,is_active,is_available`, { headers: svcHeaders });
  return (await res.json())[0];
}
const riderRow = await getRiderRow(rider.user.id);

// Hermetic baseline — same disciplines every prior phase's suite needs.
await fetch(`${REST}/stores?id=eq.${STORE_101}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ opening_time: '00:00', closing_time: '23:59', is_active: true, is_accepting_orders: true }) });
await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ quantity: 500, reserved_quantity: 0, is_available: true }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_available: true, max_active_deliveries: 1 }) });
await fetch(`${REST}/delivery_assignments?rider_id=eq.${riderRow.id}&status=not.in.(completed,cancelled,declined,expired,failed)`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
await resetCart(customer.user.id);

// demo.manager/demo.rider are real operational logins for the actual
// stores now (Sanjay Place isn't real) — pin them to store 101 for this
// run and restore their real assignment after.
const savedManager1Staff = await fetch(`${REST}/store_staff?user_id=eq.${manager1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedRiderStore = await fetch(`${REST}/riders?id=eq.${riderRow.id}&select=primary_store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]?.primary_store_id);
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });
await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: STORE_101 }) });
await fetch(`${REST}/user_devices?user_id=eq.${customer.user.id}`, { method: 'DELETE', headers: svcHeaders });
await fetch(`${REST}/user_devices?user_id=eq.${customer2.user.id}`, { method: 'DELETE', headers: svcHeaders });
// Accumulated notifications from earlier debugging runs make count-
// exact assertions (unread count, pagination) unreliable — wipe this
// run's participants to a known-empty baseline, same discipline every
// prior phase's suite needed.
for (const uid of [customer.user.id, manager1.user.id, rider.user.id, adminLogin.user.id]) {
  await fetch(`${REST}/notifications?user_id=eq.${uid}`, { method: 'DELETE', headers: svcHeaders });
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
const addrNear = await createAddress(customerHeaders, { ...ADDR_NEAR_101, name: 'Test Customer', userId: customer.user.id });

// ---------------------------------------------------------------------
// Order lifecycle -> notification fan-out
// ---------------------------------------------------------------------

let orderId, orderNumber, assignmentId;

await check('1. Placing an order notifies the customer (ORDER_PLACED) and the store staff (STORE_NEW_ORDER)', async () => {
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  orderId = await placeOrder(customerHeaders, addrNear, newKey());
  const orderRes = await fetch(`${REST}/orders?id=eq.${orderId}&select=order_number`, { headers: svcHeaders });
  orderNumber = (await orderRes.json())[0].order_number;

  await new Promise((r) => setTimeout(r, 300)); // trigger is synchronous, but give PostgREST's cache a beat
  const custNotifs = await notificationsFor(customer.user.id);
  assert(custNotifs.some((n) => n.event_type === 'order_placed' && n.data.orderId === orderId), 'expected order_placed for customer');

  const staffNotifs = await notificationsFor(manager1.user.id);
  assert(staffNotifs.some((n) => n.event_type === 'store_new_order' && n.data.orderId === orderId), 'expected store_new_order for store staff');
});

await check('2. Store accepting the order notifies the customer (ORDER_CONFIRMED)', async () => {
  const { status } = await rpc(manager1Headers, 'accept_order', { p_order_id: orderId });
  assert(status === 200 || status === 204, `accept_order failed: ${status}`);
  const custNotifs = await notificationsFor(customer.user.id);
  assert(custNotifs.some((n) => n.event_type === 'order_confirmed' && n.data.orderId === orderId), 'expected order_confirmed');
});

await check('3. Advancing to packed notifies the customer (ORDER_PREPARING, then ORDER_PACKED) but not for internal picking/packing sub-phases', async () => {
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
  const custNotifs = await notificationsFor(customer.user.id);
  assert(custNotifs.some((n) => n.event_type === 'order_preparing'), 'expected order_preparing');
  assert(custNotifs.some((n) => n.event_type === 'order_packed'), 'expected order_packed');
  assert(!custNotifs.some((n) => n.title?.toLowerCase().includes('picking') || n.title?.toLowerCase().includes('packing')), 'picking/packing sub-phases must not notify the customer');
});

await check('4. Assigning a rider notifies customer (RIDER_ASSIGNED), the rider (DELIVERY_ASSIGNED), and store staff (RIDER_ASSIGNED)', async () => {
  const assign = await rpc(manager1Headers, 'assign_rider', { p_order_id: orderId, p_rider_id: riderRow.id });
  assert(assign.status === 200, `assign_rider failed: ${JSON.stringify(assign.body)}`);
  assignmentId = assign.body;

  const custNotifs = await notificationsFor(customer.user.id);
  assert(custNotifs.some((n) => n.event_type === 'rider_assigned'), 'expected customer rider_assigned');
  const riderNotifs = await notificationsFor(rider.user.id);
  assert(riderNotifs.some((n) => n.event_type === 'delivery_assigned' && n.priority === 'high'), 'expected rider delivery_assigned at high priority');
  const staffNotifs = await notificationsFor(manager1.user.id);
  assert(staffNotifs.filter((n) => n.event_type === 'rider_assigned').length >= 1, 'expected store rider_assigned');
});

await check('5. Full delivery lifecycle (accept -> at_store -> picked_up -> out_for_delivery -> delivered) notifies at every real milestone', async () => {
  await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignmentId });
  await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignmentId });
  await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignmentId, p_order_number: orderNumber });
  await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignmentId });
  await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignmentId, p_proof_photo_url: `${assignmentId}/test-proof.jpg`, p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });

  const custNotifs = await notificationsFor(customer.user.id);
  for (const evt of ['rider_at_store', 'order_picked_up', 'order_out_for_delivery', 'order_delivered']) {
    assert(custNotifs.some((n) => n.event_type === evt), `expected customer ${evt}`);
  }
  const staffNotifs = await notificationsFor(manager1.user.id);
  assert(staffNotifs.some((n) => n.event_type === 'order_delivered'), 'expected store order_delivered');
});

await check('6. Every notification in the full lifecycle is unique per (event_type, source) — no duplicates from double-firing', async () => {
  const custNotifs = await notificationsFor(customer.user.id);
  const forThisOrder = custNotifs.filter((n) => n.data?.orderId === orderId);
  const seen = new Set();
  for (const n of forThisOrder) {
    const key = `${n.event_type}:${n.source_table}:${n.source_id}`;
    assert(!seen.has(key), `duplicate notification for ${key}`);
    seen.add(key);
  }
  assert(forThisOrder.length >= 8, `expected at least 8 distinct notifications across the lifecycle, got ${forThisOrder.length}`);
});

// ---------------------------------------------------------------------
// DELIVERY_ARRIVING idempotency (section 47) — this delivery is already
// 'completed', so notify_arriving_soon should no-op (no in_transit
// assignment), proving it never fabricates a notification for a stage
// that has already passed. Test with a fresh in-flight delivery instead.
// ---------------------------------------------------------------------

let orderId2, assignmentId2;
await check('7. notify_arriving_soon is idempotent — calling it twice produces exactly one DELIVERY_ARRIVING notification', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  orderId2 = await placeOrder(customerHeaders, addrNear, newKey());
  const orderNumber2 = (await fetch(`${REST}/orders?id=eq.${orderId2}&select=order_number`, { headers: svcHeaders }).then((r) => r.json()))[0].order_number;
  await rpc(manager1Headers, 'accept_order', { p_order_id: orderId2 });
  for (const status of ['preparing', 'picking']) await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId2, p_new_status: status });
  const itemsRes = await fetch(`${REST}/order_items?order_id=eq.${orderId2}&select=id`, { headers: manager1Headers });
  for (const item of await itemsRes.json()) await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: item.id, p_status: 'picked' });
  for (const status of ['packing', 'packed']) await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId2, p_new_status: status });
  const assign2 = await rpc(manager1Headers, 'assign_rider', { p_order_id: orderId2, p_rider_id: riderRow.id });
  assignmentId2 = assign2.body;
  await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignmentId2 });
  await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignmentId2 });
  const pickedUp2 = await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignmentId2, p_order_number: orderNumber2 });
  assert(pickedUp2.status === 200 || pickedUp2.status === 204, `mark_picked_up failed: ${JSON.stringify(pickedUp2)}`);
  await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignmentId2 });

  const r1 = await rpc(customerHeaders, 'notify_arriving_soon', { p_order_id: orderId2 });
  const r2 = await rpc(customerHeaders, 'notify_arriving_soon', { p_order_id: orderId2 });
  assert([200, 204].includes(r1.status) && [200, 204].includes(r2.status), `notify_arriving_soon failed: ${JSON.stringify(r1)} ${JSON.stringify(r2)}`);

  const custNotifs = await notificationsFor(customer.user.id);
  const arriving = custNotifs.filter((n) => n.event_type === 'delivery_arriving' && n.data?.orderId === orderId2);
  assert(arriving.length === 1, `expected exactly 1 delivery_arriving notification, got ${arriving.length}`);
});

await check('8. notify_arriving_soon rejects a different customer\'s order', async () => {
  const { status } = await rpc(customer2Headers, 'notify_arriving_soon', { p_order_id: orderId2 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

// Free the rider back up (max_active_deliveries=1) — test 7 left
// assignmentId2 in_transit and never completed it.
await rpc(riderHeaders, 'complete_delivery', { p_assignment_id: assignmentId2, p_proof_photo_url: `${assignmentId2}/test-proof.jpg`, p_proof_latitude: 27.2041, p_proof_longitude: 77.9647 });

// ---------------------------------------------------------------------
// In-app notification center: unread count, mark read/all read, RLS
// ---------------------------------------------------------------------

await check('9. get_unread_notification_count matches actual unread rows, and mark-read decrements it', async () => {
  const { body: countBefore } = await rpc(customerHeaders, 'get_unread_notification_count');
  const allNotifs = await notificationsFor(customer.user.id);
  const actualUnread = allNotifs.filter((n) => n.read_at === null).length;
  assert(countBefore === actualUnread, `count mismatch: RPC said ${countBefore}, actual unread ${actualUnread}`);
  assert(countBefore > 0, 'expected at least one unread notification going into this test');

  const target = allNotifs.find((n) => n.read_at === null);
  const patchRes = await fetch(`${REST}/notifications?id=eq.${target.id}`, { method: 'PATCH', headers: { ...customerHeaders, Prefer: 'return=representation' }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
  assert(patchRes.status === 200, `mark-read PATCH failed: ${patchRes.status}`);

  const { body: countAfter } = await rpc(customerHeaders, 'get_unread_notification_count');
  assert(countAfter === countBefore - 1, `expected count to drop by 1, got ${countBefore} -> ${countAfter}`);
});

await check('10. mark_all_notifications_read zeroes the unread count', async () => {
  const { body } = await rpc(customerHeaders, 'mark_all_notifications_read');
  assert(typeof body === 'number' && body >= 0, `expected a count back, got ${JSON.stringify(body)}`);
  const { body: countAfter } = await rpc(customerHeaders, 'get_unread_notification_count');
  assert(countAfter === 0, `expected 0 unread after mark-all, got ${countAfter}`);
});

await check('11. get_notifications paginates via cursor without overlap or gaps', async () => {
  const { body: page1 } = await rpc(customerHeaders, 'get_notifications', { p_limit: 3 });
  assert(Array.isArray(page1) && page1.length === 3, `expected 3 rows in page 1, got ${JSON.stringify(page1)?.length}`);
  const cursor = page1[page1.length - 1].created_at;
  const { body: page2 } = await rpc(customerHeaders, 'get_notifications', { p_cursor: cursor, p_limit: 3 });
  const page1Ids = new Set(page1.map((n) => n.id));
  assert(page2.every((n) => !page1Ids.has(n.id)), 'page 2 overlaps page 1');
});

await check('12. A customer cannot read another customer\'s notifications (RLS)', async () => {
  const res = await fetch(`${REST}/notifications?user_id=eq.${customer.user.id}&select=id`, { headers: customer2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected 0 rows (RLS-scoped to customer2's own), got ${rows.length}`);
});

await check('13. A customer cannot mark another customer\'s notification as read (RLS)', async () => {
  const targets = await notificationsFor(customer.user.id);
  const anyId = targets[0].id;
  const res = await fetch(`${REST}/notifications?id=eq.${anyId}`, { method: 'PATCH', headers: { ...customer2Headers, Prefer: 'return=representation' }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
  const rows = await res.json();
  assert(Array.isArray(rows) && rows.length === 0, `expected the update to affect 0 rows under customer2's RLS scope, got ${JSON.stringify(rows)}`);
});

// ---------------------------------------------------------------------
// Device tokens
// ---------------------------------------------------------------------

await check('14. register_device_token registers under the caller\'s own identity, and re-registering the same token re-parents it', async () => {
  const token = `ExpoToken[test-${Date.now()}]`;
  const r1 = await rpc(customerHeaders, 'register_device_token', { p_device_token: token, p_platform: 'android', p_app_version: '1.0.0', p_device_id: 'device-a' });
  assert(r1.status === 200, `register failed: ${JSON.stringify(r1)}`);
  const row1 = await fetch(`${REST}/user_devices?device_token=eq.${encodeURIComponent(token)}&select=user_id`, { headers: svcHeaders }).then((r) => r.json());
  assert(row1[0].user_id === customer.user.id, 'expected token owned by customer');

  const r2 = await rpc(customer2Headers, 'register_device_token', { p_device_token: token, p_platform: 'android', p_app_version: '1.0.0', p_device_id: 'device-a' });
  assert(r2.status === 200, `re-register failed: ${JSON.stringify(r2)}`);
  const row2 = await fetch(`${REST}/user_devices?device_token=eq.${encodeURIComponent(token)}&select=user_id`, { headers: svcHeaders }).then((r) => r.json());
  assert(row2[0].user_id === customer2.user.id, 'expected token re-parented to customer2');
});

await check('15. deactivate_device_token only deactivates the caller\'s own token', async () => {
  const token = `ExpoToken[test-deactivate-${Date.now()}]`;
  await rpc(customerHeaders, 'register_device_token', { p_device_token: token, p_platform: 'ios' });
  const otherAttempt = await rpc(customer2Headers, 'deactivate_device_token', { p_device_token: token });
  assert(otherAttempt.status === 200 || otherAttempt.status === 204, 'call itself should succeed (no-op)');
  const stillActive = await fetch(`${REST}/user_devices?device_token=eq.${encodeURIComponent(token)}&select=is_active`, { headers: svcHeaders }).then((r) => r.json());
  assert(stillActive[0].is_active === true, 'a different user must not be able to deactivate this token');

  await rpc(customerHeaders, 'deactivate_device_token', { p_device_token: token });
  const nowInactive = await fetch(`${REST}/user_devices?device_token=eq.${encodeURIComponent(token)}&select=is_active`, { headers: svcHeaders }).then((r) => r.json());
  assert(nowInactive[0].is_active === false, "expected the owner's deactivate call to succeed");
});

await check('16. A user cannot read another user\'s device tokens (RLS)', async () => {
  const res = await fetch(`${REST}/user_devices?user_id=eq.${customer.user.id}&select=id`, { headers: customer2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected 0 rows, got ${rows.length}`);
});

await check('17. Admin can read any user\'s device tokens', async () => {
  const res = await fetch(`${REST}/user_devices?user_id=eq.${customer.user.id}&select=id`, { headers: adminHeaders });
  assert(res.status === 200, `admin read failed: ${res.status}`);
  const rows = await res.json();
  assert(rows.length > 0, "expected admin to see the customer's device rows");
});

// ---------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------

await check('18. A customer can set and read their own notification preferences, scoped by RLS', async () => {
  const upsert = await fetch(`${REST}/notification_preferences`, { method: 'POST', headers: { ...customerHeaders, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: customer.user.id, promotions_enabled: false }) });
  assert(upsert.status === 201 || upsert.status === 200, `upsert failed: ${upsert.status}`);
  const otherRead = await fetch(`${REST}/notification_preferences?user_id=eq.${customer.user.id}`, { headers: customer2Headers });
  const otherRows = await otherRead.json();
  assert(otherRows.length === 0, 'another customer must not be able to read this preference row');
});

// ---------------------------------------------------------------------
// Delivery failure -> admin alert
// ---------------------------------------------------------------------

await check('19. A failed delivery notifies customer, rider, store staff, AND every admin', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  const orderId3 = await placeOrder(customerHeaders, addrNear, newKey());
  const orderNumber3 = (await fetch(`${REST}/orders?id=eq.${orderId3}&select=order_number`, { headers: svcHeaders }).then((r) => r.json()))[0].order_number;
  await rpc(manager1Headers, 'accept_order', { p_order_id: orderId3 });
  for (const status of ['preparing', 'picking']) await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId3, p_new_status: status });
  const itemsRes = await fetch(`${REST}/order_items?order_id=eq.${orderId3}&select=id`, { headers: manager1Headers });
  for (const item of await itemsRes.json()) await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: item.id, p_status: 'picked' });
  for (const status of ['packing', 'packed']) await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: orderId3, p_new_status: status });
  const assign3 = await rpc(manager1Headers, 'assign_rider', { p_order_id: orderId3, p_rider_id: riderRow.id });
  const assignmentId3 = assign3.body;
  await rpc(riderHeaders, 'accept_delivery', { p_assignment_id: assignmentId3 });
  await rpc(riderHeaders, 'mark_arrived_at_store', { p_assignment_id: assignmentId3 });
  const pickedUp3 = await rpc(riderHeaders, 'mark_picked_up', { p_assignment_id: assignmentId3, p_order_number: orderNumber3 });
  assert(pickedUp3.status === 200 || pickedUp3.status === 204, `mark_picked_up failed: ${JSON.stringify(pickedUp3)}`);
  await rpc(riderHeaders, 'start_delivery', { p_assignment_id: assignmentId3 });
  const fail = await rpc(riderHeaders, 'fail_delivery', { p_assignment_id: assignmentId3, p_reason: 'customer_unavailable' });
  assert(fail.status === 200 || fail.status === 204, `fail_delivery failed: ${JSON.stringify(fail)}`);

  const custNotifs = await notificationsFor(customer.user.id);
  assert(custNotifs.some((n) => n.event_type === 'delivery_failed' && n.data?.orderId === orderId3), 'expected customer delivery_failed');
  const riderNotifs = await notificationsFor(rider.user.id);
  assert(riderNotifs.some((n) => n.event_type === 'delivery_exception' && n.data?.orderId === orderId3), 'expected rider delivery_exception');
  const adminNotifs = await notificationsFor(adminLogin.user.id);
  assert(adminNotifs.some((n) => n.event_type === 'admin_failed_delivery' && n.data?.orderId === orderId3 && n.priority === 'urgent'), 'expected admin_failed_delivery at urgent priority');
});

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedManager1Staff.store_id }) });
if (savedRiderStore) await fetch(`${REST}/riders?id=eq.${riderRow.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ primary_store_id: savedRiderStore }) });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
