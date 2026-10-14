#!/usr/bin/env node
/**
 * Phase 07 (Store Operations + Store Manager + Order Fulfillment)
 * verification suite. Same live-integration philosophy as Phase 02-05:
 * real Auth sessions, real PostgREST/RPC calls, real RLS, real
 * Postgres concurrency.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/phase07-store-operations.test.mjs
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
      user_id: userId,
      label: 'home',
      recipient_name: name,
      phone: '+919876500000',
      address_line_1: '1 Test Lane',
      city: 'Agra',
      state: 'Uttar Pradesh',
      postal_code: '282001',
      latitude: lat,
      longitude: lng,
      is_default: false,
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
async function getInventory(storeId, variantId) {
  const res = await fetch(`${REST}/inventory?select=id,quantity,reserved_quantity,is_available&store_id=eq.${storeId}&product_variant_id=eq.${variantId}`, { headers: svcHeaders });
  return (await res.json())[0];
}

const STORE_101 = '00000000-0000-0000-0000-000000000101'; // Sanjay Place
const STORE_102 = '00000000-0000-0000-0000-000000000102'; // Vijay Nagar
const V_ALMOND_500 = '00000000-0000-0000-0000-000000000403'; // ₹849, stocked @ 101 & 103, NOT 102
const ADDR_NEAR_101 = { lat: 27.199, lng: 78.0064 };

console.log(`Running against ${URL}\n`);

const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
const manager1 = await otpLogin('+919000000203'); // store 101 manager
const manager1Headers = authed(manager1.access_token);
const staff1 = await otpLogin('+919000000204'); // store 101 staff (non-manager)
const staff1Headers = authed(staff1.access_token);
const manager2 = await otpLogin('+919000000205'); // store 102 manager — wrong store for everything below
const manager2Headers = authed(manager2.access_token);

// Hermetic setup: widen store hours so this suite is never time-of-day
// dependent (Phase 07 made find_serviceable_stores() enforce
// opening/closing time for the first time), and start from a clean cart.
const savedHours101 = await fetch(`${REST}/stores?id=eq.${STORE_101}&select=opening_time,closing_time,is_active,is_accepting_orders`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
await fetch(`${REST}/stores?id=eq.${STORE_101}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ opening_time: '00:00', closing_time: '23:59', is_active: true, is_accepting_orders: true }) });
await resetCart(customer.user.id);

// demo.manager/demo.staff are real operational logins for the actual
// stores now (Sanjay Place isn't real) — pin them to store 101 for this
// run and restore their real assignment after.
const savedManager1Staff = await fetch(`${REST}/store_staff?user_id=eq.${manager1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedStaff1Staff = await fetch(`${REST}/store_staff?user_id=eq.${staff1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_101 }) });

const addrNear = await createAddress(customerHeaders, { ...ADDR_NEAR_101, name: 'Test Customer', userId: customer.user.id });
const createdAddresses = [{ headers: customerHeaders, id: addrNear }];

async function freshOrder() {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  return placeOrder(customerHeaders, addrNear, `test07-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ---------------------------------------------------------------------
// Access control on the new-order queue
// ---------------------------------------------------------------------

let order1;
await check('1. A fresh order lands at the correct store, status placed', async () => {
  order1 = await freshOrder();
  const res = await fetch(`${REST}/orders?id=eq.${order1}&select=status,store_id`, { headers: manager1Headers });
  const rows = await res.json();
  assert(rows.length === 1, 'manager could not see the new order');
  assert(rows[0].status === 'placed' && rows[0].store_id === STORE_101, `unexpected order state: ${JSON.stringify(rows[0])}`);
});

await check('2. Anonymous cannot call accept_order', async () => {
  const { status } = await rpc(anonHeaders, 'accept_order', { p_order_id: order1 });
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

await check("3. The order's own customer (not staff) cannot accept it", async () => {
  const { status, body } = await rpc(customerHeaders, 'accept_order', { p_order_id: order1 });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
});

await check('4. A manager of a DIFFERENT store cannot accept this order', async () => {
  const { status, body } = await rpc(manager2Headers, 'accept_order', { p_order_id: order1 });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
});

await check("5. Manager of the CORRECT store can accept it — status, accepted_at, event all recorded", async () => {
  const { status, body } = await rpc(manager1Headers, 'accept_order', { p_order_id: order1 });
  assert(status === 204, `expected 204, got ${status}: ${JSON.stringify(body)}`);

  const res = await fetch(`${REST}/orders?id=eq.${order1}&select=status,accepted_at`, { headers: manager1Headers });
  const row = (await res.json())[0];
  assert(row.status === 'confirmed' && row.accepted_at !== null, `unexpected: ${JSON.stringify(row)}`);

  const evRes = await fetch(`${REST}/order_events?order_id=eq.${order1}&event_type=eq.order_accepted`, { headers: manager1Headers });
  assert((await evRes.json()).length === 1, 'expected exactly one order_accepted event');
});

await check('6. Accepting an already-accepted order fails (not idempotent — a real state error)', async () => {
  const { status } = await rpc(manager1Headers, 'accept_order', { p_order_id: order1 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('7. Rejecting a non-placed order fails, and a reason is mandatory for rejection', async () => {
  const rejectAlreadyAccepted = await rpc(manager1Headers, 'reject_order', { p_order_id: order1, p_reason: 'store_closed' });
  assert(rejectAlreadyAccepted.status >= 400, 'expected rejection of reject_order on a non-placed order');

  const order2 = await freshOrder();
  const missingReason = await fetch(`${REST}/rpc/reject_order`, {
    method: 'POST',
    headers: manager1Headers,
    body: JSON.stringify({ p_order_id: order2 }), // no p_reason
  });
  assert(missingReason.status >= 400, 'expected reject_order to require p_reason');

  const rejected = await rpc(manager1Headers, 'reject_order', { p_order_id: order2, p_reason: 'inventory_mismatch', p_notes: 'shelf was empty' });
  assert(rejected.status === 204, `expected 204, got ${rejected.status}: ${JSON.stringify(rejected.body)}`);
  const row = (await fetch(`${REST}/orders?id=eq.${order2}&select=status,rejection_reason,rejection_notes`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'cancelled' && row.rejection_reason === 'inventory_mismatch' && row.rejection_notes === 'shelf was empty', `unexpected: ${JSON.stringify(row)}`);
});

// ---------------------------------------------------------------------
// The strict picking/packing state machine — no skipping, no going back
// ---------------------------------------------------------------------

await check('8. Skipping ahead (preparing -> packed, past picking/packing) is rejected', async () => {
  const adv1 = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'preparing' });
  assert(adv1.status === 204, `expected 204, got ${adv1.status}: ${JSON.stringify(adv1.body)}`);

  const skip = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'packed' });
  assert(skip.status >= 400, `expected rejection of a skip-ahead transition, got ${skip.status}`);

  const row = (await fetch(`${REST}/orders?id=eq.${order1}&select=status,processing_started_at`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'preparing' && row.processing_started_at !== null, `unexpected: ${JSON.stringify(row)}`);
});

await check('9. picking -> packing is blocked while any item is still pending', async () => {
  const toPicking = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'picking' });
  assert(toPicking.status === 204, `expected 204, got ${toPicking.status}`);

  const early = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'packing' });
  assert(early.status >= 400, `expected rejection while items are still pending, got ${early.status}`);
});

let itemId;
await check('10. Cannot mark a nonexistent order item picked', async () => {
  const res = await fetch(`${REST}/order_items?order_id=eq.${order1}&select=id`, { headers: manager1Headers });
  itemId = (await res.json())[0].id;

  const { status } = await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: '00000000-0000-0000-0000-000000009999', p_status: 'picked' });
  assert(status >= 400, `expected rejection for a nonexistent item, got ${status}`);
});

await check('11. Marking an item UNAVAILABLE flags the order exception and blocks packing', async () => {
  const { status } = await rpc(staff1Headers, 'mark_order_item_picked', { p_order_item_id: itemId, p_status: 'unavailable' });
  assert(status === 204, `expected 204, got ${status}`);

  const row = (await fetch(`${REST}/orders?id=eq.${order1}&select=has_exception`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.has_exception === true, 'expected has_exception = true');

  const ev = await fetch(`${REST}/order_events?order_id=eq.${order1}&event_type=eq.item_unavailable`, { headers: manager1Headers }).then((r) => r.json());
  assert(ev.length === 1, 'expected an item_unavailable event');
});

await check('12. Regular staff cannot resolve an exception — only a manager can', async () => {
  const { status } = await rpc(staff1Headers, 'resolve_order_exception', { p_order_id: order1 });
  assert(status >= 400, `expected rejection for non-manager staff, got ${status}`);
});

await check('13. Picking -> packing stays blocked (all items resolved, but exception unresolved)', async () => {
  const attempt = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'packing' });
  assert(attempt.status >= 400, `expected rejection while has_exception is true, got ${attempt.status}`);
});

await check('14. Manager resolves the exception and re-marks the item picked; packing then proceeds', async () => {
  const resolve = await rpc(manager1Headers, 'resolve_order_exception', { p_order_id: order1, p_notes: 'found it on the top shelf' });
  assert(resolve.status === 204, `expected 204, got ${resolve.status}`);

  const rePick = await rpc(manager1Headers, 'mark_order_item_picked', { p_order_item_id: itemId, p_status: 'picked' });
  assert(rePick.status === 204, `expected 204, got ${rePick.status}`);

  const toPacking = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'packing' });
  assert(toPacking.status === 204, `expected 204, got ${toPacking.status}: ${JSON.stringify(toPacking.body)}`);
});

await check('15. packing -> packed (READY_FOR_PICKUP) succeeds and logs both events', async () => {
  const toPacked = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'packed' });
  assert(toPacked.status === 204, `expected 204, got ${toPacked.status}: ${JSON.stringify(toPacked.body)}`);

  const row = (await fetch(`${REST}/orders?id=eq.${order1}&select=status,ready_at`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'packed' && row.ready_at !== null, `unexpected: ${JSON.stringify(row)}`);

  const events = await fetch(`${REST}/order_events?order_id=eq.${order1}&event_type=in.(order_packed,order_ready_for_pickup)`, { headers: manager1Headers }).then((r) => r.json());
  assert(events.length === 2, `expected 2 events, got ${events.length}`);
});

await check('16. Backward transitions are rejected (packed cannot go back to confirmed)', async () => {
  const back = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'confirmed' });
  assert(back.status >= 400, `expected rejection, got ${back.status}`);
});

await check('17. Store staff cannot mark an order delivered — that belongs to the delivery system', async () => {
  const viaAdvance = await rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order1, p_new_status: 'delivered' });
  assert(viaAdvance.status >= 400, `expected rejection, got ${viaAdvance.status}`);
  const viaUpdate = await rpc(manager1Headers, 'update_order_status', { p_order_id: order1, p_new_status: 'delivered' });
  assert(viaUpdate.status >= 400, `expected rejection (update_order_status is cancel-only now), got ${viaUpdate.status}`);
});

// ---------------------------------------------------------------------
// Inventory adjustments — controlled, audited, never silent
// ---------------------------------------------------------------------

await check('18. record_inventory_adjustment writes both the audit row and the inventory row correctly', async () => {
  const before = await getInventory(STORE_101, V_ALMOND_500);
  const newQty = before.quantity - 2;
  const { status, body } = await rpc(manager1Headers, 'record_inventory_adjustment', {
    p_store_id: STORE_101, p_variant_id: V_ALMOND_500, p_new_quantity: newQty, p_reason: 'stock_count', p_notes: 'weekly count',
  });
  assert(status === 200 && body.success === true, `expected success, got ${status}: ${JSON.stringify(body)}`);
  assert(body.oldQuantity === before.quantity && body.newQuantity === newQty && body.difference === -2, `unexpected result: ${JSON.stringify(body)}`);

  const auditRes = await fetch(`${REST}/inventory_adjustments?inventory_id=eq.${before.id}&order=created_at.desc&limit=1`, { headers: manager1Headers });
  const audit = (await auditRes.json())[0];
  assert(audit.old_quantity === before.quantity && audit.new_quantity === newQty && audit.reason === 'stock_count' && audit.difference === -2, `unexpected audit row: ${JSON.stringify(audit)}`);

  // Restore.
  await rpc(manager1Headers, 'record_inventory_adjustment', { p_store_id: STORE_101, p_variant_id: V_ALMOND_500, p_new_quantity: before.quantity, p_reason: 'manual_correction', p_notes: 'test restore' });
});

await check('19. An adjustment cannot drop quantity below what is already reserved for other orders', async () => {
  const inv = await getInventory(STORE_101, V_ALMOND_500);
  if (inv.reserved_quantity === 0) {
    // Ensure there is something reserved to violate, deterministically.
    await fetch(`${REST}/inventory?id=eq.${inv.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ reserved_quantity: 1 }) });
  }
  const current = await getInventory(STORE_101, V_ALMOND_500);
  const { status, body } = await rpc(manager1Headers, 'record_inventory_adjustment', {
    p_store_id: STORE_101, p_variant_id: V_ALMOND_500, p_new_quantity: current.reserved_quantity - 1, p_reason: 'damaged',
  });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
  if (inv.reserved_quantity === 0) {
    await fetch(`${REST}/inventory?id=eq.${inv.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ reserved_quantity: 0 }) });
  }
});

await check("20. A manager of a different store cannot adjust this store's inventory", async () => {
  const { status } = await rpc(manager2Headers, 'record_inventory_adjustment', { p_store_id: STORE_101, p_variant_id: V_ALMOND_500, p_new_quantity: 5, p_reason: 'found' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('21. Direct client writes to inventory.quantity are blocked (must go through record_inventory_adjustment)', async () => {
  const inv = await getInventory(STORE_101, V_ALMOND_500);
  const direct = await fetch(`${REST}/inventory?id=eq.${inv.id}`, { method: 'PATCH', headers: manager1Headers, body: JSON.stringify({ quantity: inv.quantity + 100 }) });
  assert(direct.status >= 400, `expected the direct quantity write to be rejected, got ${direct.status}`);

  // is_available, an operational flag with no audit requirement, is still directly editable.
  const flagWrite = await fetch(`${REST}/inventory?id=eq.${inv.id}`, { method: 'PATCH', headers: manager1Headers, body: JSON.stringify({ is_available: true }) });
  assert(flagWrite.status < 300, `expected is_available to remain directly writable, got ${flagWrite.status}`);
});

// ---------------------------------------------------------------------
// Store operational status — the customer fulfillment engine must
// actually stop selecting a temporarily-unavailable store.
// ---------------------------------------------------------------------

await check('22. Only a manager (not plain staff) can change store operational status', async () => {
  const { status } = await rpc(staff1Headers, 'set_store_accepting_orders', { p_store_id: STORE_101, p_accepting: false });
  assert(status >= 400, `expected rejection for non-manager staff, got ${status}`);
});

await check('23. Manager sets the store temporarily unavailable — customer fulfillment engine stops selecting it', async () => {
  const setStatus = await rpc(manager1Headers, 'set_store_accepting_orders', { p_store_id: STORE_101, p_accepting: false });
  assert(setStatus.status === 204, `expected 204, got ${setStatus.status}`);

  const opStatus = await rpc(manager1Headers, 'get_store_operational_status', { p_store_id: STORE_101 });
  assert(opStatus.body === 'temporarily_unavailable', `expected temporarily_unavailable, got ${JSON.stringify(opStatus.body)}`);

  const findRes = await rpc(customerHeaders, 'find_serviceable_stores', { customer_lat: ADDR_NEAR_101.lat, customer_lng: ADDR_NEAR_101.lng });
  const stillListed = (findRes.body ?? []).some((s) => s.store_id === STORE_101);
  assert(!stillListed, 'expected store 101 to be excluded from serviceable stores while temporarily unavailable');

  // Restore.
  await rpc(manager1Headers, 'set_store_accepting_orders', { p_store_id: STORE_101, p_accepting: true });
  const restored = await rpc(customerHeaders, 'find_serviceable_stores', { customer_lat: ADDR_NEAR_101.lat, customer_lng: ADDR_NEAR_101.lng });
  assert((restored.body ?? []).some((s) => s.store_id === STORE_101), 'expected store 101 to be selectable again after restoring is_accepting_orders');
});

await check('24. An order already placed before closure remains recoverable (not silently dropped)', async () => {
  const stillThere = await fetch(`${REST}/orders?id=eq.${order1}&select=id,status`, { headers: manager1Headers });
  const rows = await stillThere.json();
  assert(rows.length === 1 && rows[0].status === 'packed', `expected the earlier order to still exist and be packed, got ${JSON.stringify(rows)}`);
});

// ---------------------------------------------------------------------
// Dashboard — real aggregates, store-scoped
// ---------------------------------------------------------------------

await check('25. get_store_dashboard returns real, non-fabricated counts', async () => {
  const { status, body } = await rpc(manager1Headers, 'get_store_dashboard', { p_store_id: STORE_101 });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(typeof body.todayOrderCount === 'number' && body.todayOrderCount >= 1, `expected at least 1 order today, got ${JSON.stringify(body)}`);
  assert(body.readyForPickup >= 1, `expected at least 1 order ready for pickup (order1), got ${body.readyForPickup}`);
  assert(body.operationalStatus === 'open', `expected open, got ${body.operationalStatus}`);
});

await check('26. A manager of a different store cannot view this dashboard', async () => {
  const { status } = await rpc(manager2Headers, 'get_store_dashboard', { p_store_id: STORE_101 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

// ---------------------------------------------------------------------
// RLS, directly (not just function-level authorization)
// ---------------------------------------------------------------------

await check("27. A manager of a different store cannot read this store's inventory via REST", async () => {
  const res = await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&limit=1`, { headers: manager2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected RLS to hide store 101's inventory from store 102's manager, got ${rows.length} rows`);
});

await check("28. A manager of a different store cannot read this store's orders via REST", async () => {
  const res = await fetch(`${REST}/orders?store_id=eq.${STORE_101}&limit=5`, { headers: manager2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected RLS to hide store 101's orders from store 102's manager, got ${rows.length} rows`);
});

await check('29. A customer cannot read store_staff or inventory_adjustments at all', async () => {
  const staffRes = await fetch(`${REST}/store_staff?limit=5`, { headers: customerHeaders });
  assert((await staffRes.json()).length === 0, 'expected customer to see no store_staff rows');
  const adjRes = await fetch(`${REST}/inventory_adjustments?limit=5`, { headers: customerHeaders });
  assert((await adjRes.json()).length === 0, 'expected customer to see no inventory_adjustments rows');
});

await check('30. A manager can see their colleagues at the same store; plain staff sees only their own row', async () => {
  const managerView = await fetch(`${REST}/store_staff?store_id=eq.${STORE_101}`, { headers: manager1Headers }).then((r) => r.json());
  assert(managerView.length >= 2, `expected the manager to see at least 2 staff rows (self + staff1), got ${managerView.length}`);

  const staffView = await fetch(`${REST}/store_staff?store_id=eq.${STORE_101}`, { headers: staff1Headers }).then((r) => r.json());
  assert(staffView.length === 1 && staffView[0].user_id === staff1.user.id, `expected plain staff to see only their own row, got ${JSON.stringify(staffView)}`);
});

// ---------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------

await check('31. Two staff members racing to accept the same order: exactly one succeeds', async () => {
  const order3 = await freshOrder();
  const [r1, r2] = await Promise.all([
    rpc(manager1Headers, 'accept_order', { p_order_id: order3 }),
    rpc(staff1Headers, 'accept_order', { p_order_id: order3 }),
  ]);
  const succeeded = [r1, r2].filter((r) => r.status === 204);
  const rejected = [r1, r2].filter((r) => r.status >= 400);
  assert(succeeded.length === 1 && rejected.length === 1, `expected exactly one success and one rejection, got ${JSON.stringify([r1.status, r2.status])}`);

  const row = (await fetch(`${REST}/orders?id=eq.${order3}&select=status`, { headers: manager1Headers }).then((r) => r.json()))[0];
  assert(row.status === 'confirmed', `expected confirmed (accepted exactly once), got ${row.status}`);

  // Cleanup for a clean suite re-run.
  await rpc(manager1Headers, 'update_order_status', { p_order_id: order3, p_new_status: 'cancelled' });
});

await check('32. Two staff racing the same forward transition: exactly one succeeds, order does not double-advance', async () => {
  const order4 = await freshOrder();
  await rpc(manager1Headers, 'accept_order', { p_order_id: order4 });
  const [r1, r2] = await Promise.all([
    rpc(manager1Headers, 'advance_order_fulfillment', { p_order_id: order4, p_new_status: 'preparing' }),
    rpc(staff1Headers, 'advance_order_fulfillment', { p_order_id: order4, p_new_status: 'preparing' }),
  ]);
  const succeeded = [r1, r2].filter((r) => r.status === 204);
  assert(succeeded.length === 1, `expected exactly one success, got ${JSON.stringify([r1.status, r2.status])}`);

  await rpc(manager1Headers, 'update_order_status', { p_order_id: order4, p_new_status: 'cancelled' });
});

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------

await fetch(`${REST}/stores?id=eq.${STORE_101}`, {
  method: 'PATCH',
  headers: svcHeaders,
  body: JSON.stringify({ opening_time: savedHours101.opening_time, closing_time: savedHours101.closing_time, is_active: savedHours101.is_active, is_accepting_orders: savedHours101.is_accepting_orders }),
});
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedManager1Staff.store_id }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedStaff1Staff.store_id }) });
for (const a of createdAddresses) {
  await fetch(`${REST}/addresses?id=eq.${a.id}`, { method: 'DELETE', headers: a.headers });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
