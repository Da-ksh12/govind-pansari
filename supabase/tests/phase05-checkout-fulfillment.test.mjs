#!/usr/bin/env node
/**
 * Phase 05 (Checkout + Fulfillment Engine + Inventory Reservation +
 * Order Creation) verification suite. Same live-integration philosophy
 * as Phase 02-04: real Auth sessions, real PostgREST/RPC calls, real
 * RLS, real Postgres concurrency (Promise.all, not mocked).
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/phase05-checkout-fulfillment.test.mjs
 *
 * SUPABASE_SERVICE_ROLE_KEY is used to: create a second customer
 * session for the concurrency tests, temporarily toggle inventory/
 * product state, and force an order into a later status to test the
 * owner-cancel boundary. Every mutation it makes is restored in a
 * `finally`.
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
async function clearVariant(headers, variantId) {
  await rpc(headers, 'remove_cart_item', { p_variant_id: variantId });
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
async function setInventory(storeId, variantId, patch) {
  await fetch(`${REST}/inventory?store_id=eq.${storeId}&product_variant_id=eq.${variantId}`, {
    method: 'PATCH',
    headers: svcHeaders,
    body: JSON.stringify(patch),
  });
}
async function getInventory(storeId, variantId) {
  const res = await fetch(`${REST}/inventory?select=quantity,reserved_quantity,is_available&store_id=eq.${storeId}&product_variant_id=eq.${variantId}`, {
    headers: svcHeaders,
  });
  const rows = await res.json();
  return rows[0];
}
/** Full service-role wipe of a user's cart — robust against a previous
 * run (or a previous test's assertion throw) leaving items behind that
 * the owner-scoped remove_cart_item RPC would need to be called for
 * one at a time. Used to make every cart-content-sensitive test start
 * from a hermetically known baseline. */
async function resetCart(userId) {
  const cartRes = await fetch(`${REST}/carts?user_id=eq.${userId}&select=id`, { headers: svcHeaders });
  const carts = await cartRes.json();
  if (carts[0]) {
    await fetch(`${REST}/cart_items?cart_id=eq.${carts[0].id}`, { method: 'DELETE', headers: svcHeaders });
  }
}

// ---------------------------------------------------------------------
// Fixtures — variant IDs and store IDs from supabase/seed/*.sql.
// Chosen to be distinct from Phase 02-04's owned variants (421, 431,
// 441 as a cart line, 473) except where noted.
// ---------------------------------------------------------------------
const STORE_SANJAY_PLACE = '00000000-0000-0000-0000-000000000101'; // stocks 403, 411, 412, 451, 461
const STORE_VIJAY_NAGAR = '00000000-0000-0000-0000-000000000102'; // stocks 411, 461 — not 403/412/451
const STORE_AWAS_VIKAS = '00000000-0000-0000-0000-000000000103'; // stocks 403, 412, 451, 461 — not 411
const V_ALMOND_500 = '00000000-0000-0000-0000-000000000403'; // ₹849, only @ 101 & 103
const V_CASHEW_250 = '00000000-0000-0000-0000-000000000411'; // ₹499, only @ 101 & 102
const V_CASHEW_500 = '00000000-0000-0000-0000-000000000412'; // ₹949, only @ 101 & 103
const V_DATES_250 = '00000000-0000-0000-0000-000000000451'; // ₹349, only @ 101 & 103
const V_MAKHANA_100 = '00000000-0000-0000-0000-000000000461'; // ₹149, @ all 3 stores
const V_RAISIN_250 = '00000000-0000-0000-0000-000000000441'; // ₹199, @ 101 & 102

// Right at Sanjay Place's own coordinates — inside every store's ~4km
// zone buffer (stores are 1-3km apart), so store selection is decided
// by inventory fulfillability, not geography.
const ADDR_NEAR = { lat: 27.199, lng: 78.0064 };
// New Delhi — ~200km from every store, inside no zone at all.
const ADDR_FAR = { lat: 28.6139, lng: 77.209 };

// Original seed quantities (supabase/seed/01_catalogue_and_stores.sql)
// for every (store, variant) this suite touches — re-applied at suite
// start so the run is hermetic regardless of what a previous run (or a
// previous run's assertion throw, which skips end-of-test cleanup)
// left behind.
const INVENTORY_BASELINE = [
  [STORE_SANJAY_PLACE, V_ALMOND_500, 20],
  [STORE_AWAS_VIKAS, V_ALMOND_500, 15],
  [STORE_SANJAY_PLACE, V_CASHEW_250, 30],
  [STORE_VIJAY_NAGAR, V_CASHEW_250, 40],
  [STORE_SANJAY_PLACE, V_CASHEW_500, 15],
  [STORE_AWAS_VIKAS, V_CASHEW_500, 20],
  [STORE_SANJAY_PLACE, V_DATES_250, 22],
  [STORE_AWAS_VIKAS, V_DATES_250, 40],
  [STORE_SANJAY_PLACE, V_MAKHANA_100, 3],
  [STORE_VIJAY_NAGAR, V_MAKHANA_100, 30],
  [STORE_AWAS_VIKAS, V_MAKHANA_100, 12],
  [STORE_SANJAY_PLACE, V_RAISIN_250, 50],
  [STORE_VIJAY_NAGAR, V_RAISIN_250, 28],
];
async function resetInventoryBaseline() {
  for (const [storeId, variantId, quantity] of INVENTORY_BASELINE) {
    await setInventory(storeId, variantId, { quantity, reserved_quantity: 0, is_available: true });
  }
}

console.log(`Running against ${URL}\n`);

const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
const customer2 = await otpLogin('+919000000299');
const customer2Headers = authed(customer2.access_token);

// This suite's whole fixture matrix (INVENTORY_BASELINE above) is
// deliberately built around all 3 seeded store ids, incl. Sanjay Place
// (101) — real-world that store was deactivated (it isn't an actual
// branch; see 20260826000076 and the "testing mode" store cleanup), so
// pin it active + open 24h for this run only and restore its real
// state after, same hermetic-baseline idiom Phase 07/08/09/10 already
// use for the identical reason.
const savedSanjayStore = await fetch(`${REST}/stores?id=eq.${STORE_SANJAY_PLACE}&select=is_active,is_accepting_orders,opening_time,closing_time`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
await fetch(`${REST}/stores?id=eq.${STORE_SANJAY_PLACE}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true, is_accepting_orders: true, opening_time: '00:00', closing_time: '23:59' }) });

// Hermetic baseline: previous runs (or a previous run's mid-test
// throw) can leave carts/reservations dirty — reset both fully rather
// than trusting incremental per-variant cleanup.
await resetInventoryBaseline();
await resetCart(customer.user.id);
await resetCart(customer2.user.id);

const addrNear = await createAddress(customerHeaders, { ...ADDR_NEAR, name: 'Test Customer', userId: customer.user.id });
const addrFar = await createAddress(customerHeaders, { ...ADDR_FAR, name: 'Test Customer (far)', userId: customer.user.id });
const addr2Near = await createAddress(customer2Headers, { ...ADDR_NEAR, name: 'Test Customer 2', userId: customer2.user.id });

const createdAddresses = [
  { headers: customerHeaders, id: addrNear },
  { headers: customerHeaders, id: addrFar },
  { headers: customer2Headers, id: addr2Near },
];

// ---------------------------------------------------------------------
// Security / auth boundary
// ---------------------------------------------------------------------

await check('1. Anonymous cannot call get_checkout_summary', async () => {
  const { status } = await rpc(anonHeaders, 'get_checkout_summary', { p_address_id: addrNear });
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

await check('2. Anonymous cannot call create_order_from_cart', async () => {
  const { status } = await rpc(anonHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: 'anon-test' });
  assert(status === 401 || status === 403, `expected 401/403, got ${status}`);
});

// ---------------------------------------------------------------------
// Validation: empty cart, bad address, outside service area
// ---------------------------------------------------------------------

await check('3. CART_EMPTY when the cart has no items', async () => {
  const { status, body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.success === false && body.code === 'CART_EMPTY', `expected CART_EMPTY, got ${JSON.stringify(body)}`);
});

await check('4. ADDRESS_NOT_FOUND for an address that does not belong to this user', async () => {
  await addToCart(customerHeaders, V_ALMOND_500, 1);
  const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: '00000000-0000-0000-0000-000000009999' });
  assert(body.success === false && body.code === 'ADDRESS_NOT_FOUND', `expected ADDRESS_NOT_FOUND, got ${JSON.stringify(body)}`);
});

await check('5. OUTSIDE_SERVICE_AREA for an address ~200km from any store', async () => {
  const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrFar });
  assert(body.success === false && body.code === 'OUTSIDE_SERVICE_AREA', `expected OUTSIDE_SERVICE_AREA, got ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------
// Happy path: summary math, free-delivery threshold, order creation
// ---------------------------------------------------------------------

let happyOrderId, happyOrderNumber, happyIdemKey;

await check('6. get_checkout_summary: correct subtotal/mrp/free delivery (single ₹849 item ≥ ₹499 threshold)', async () => {
  const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
  assert(body.success === true, `expected success, got ${JSON.stringify(body)}`);
  assert(Number(body.subtotal) === 849, `expected subtotal 849, got ${body.subtotal}`);
  assert(Number(body.mrpTotal) === 999, `expected mrpTotal 999, got ${body.mrpTotal}`);
  assert(Number(body.deliveryFee) === 0, `expected free delivery, got fee ${body.deliveryFee}`);
  assert(body.meetsMinimumOrder === true, 'expected meetsMinimumOrder true');
  assert(Number(body.total) === 849, `expected total 849, got ${body.total}`);
  assert(body.items.length === 1 && body.items[0].productVariantId === V_ALMOND_500, 'expected the almond line');
});

await check('7. create_order_from_cart: places the order and clears the cart', async () => {
  happyIdemKey = `test-happy-${Date.now()}`;
  const { status, body } = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: happyIdemKey });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `expected success, got ${JSON.stringify(body)}`);
  assert(body.idempotent === false, 'expected a fresh (non-idempotent) creation');
  assert(body.status === 'placed', `expected status placed, got ${body.status}`);
  assert(Number(body.total) === 849, `expected total 849, got ${body.total}`);
  happyOrderId = body.orderId;
  happyOrderNumber = body.orderNumber;

  const cartRes = await fetch(`${REST}/cart_items?select=id`, { headers: customerHeaders });
  const cartRows = await cartRes.json();
  assert(cartRows.length === 0, `expected cart cleared, found ${cartRows.length} items`);
});

await check('8. Order row + order_items snapshot are correct and immutable-shaped', async () => {
  const res = await fetch(
    `${REST}/orders?id=eq.${happyOrderId}&select=id,order_number,status,payment_status,subtotal,delivery_fee,total,store_id,order_items(product_name_snapshot,variant_snapshot,sku_snapshot,quantity,unit_price,mrp,total),payments(method,status,amount)`,
    { headers: customerHeaders },
  );
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 order row, got ${rows.length}`);
  const order = rows[0];
  assert(order.order_number === happyOrderNumber, 'order_number mismatch');
  assert(order.status === 'placed', `expected placed, got ${order.status}`);
  assert(order.payment_status === 'pending', `expected pending, got ${order.payment_status}`);
  assert(order.store_id === STORE_SANJAY_PLACE, `expected Sanjay Place, got ${order.store_id}`);
  assert(order.order_items.length === 1, 'expected 1 order item');
  const item = order.order_items[0];
  assert(item.product_name_snapshot && item.sku_snapshot === 'GP-ALM-500', `unexpected sku snapshot: ${item.sku_snapshot}`);
  assert(Number(item.unit_price) === 849 && Number(item.mrp) === 999, 'unexpected price/mrp snapshot');
  assert(order.payments.length === 1 && order.payments[0].method === 'cod' && order.payments[0].status === 'pending', 'unexpected payment row');
});

await check('9. Inventory reserved_quantity increased at the fulfilling store', async () => {
  const inv = await getInventory(STORE_SANJAY_PLACE, V_ALMOND_500);
  assert(inv.reserved_quantity >= 1, `expected reserved_quantity >= 1, got ${inv.reserved_quantity}`);
});

// ---------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------

await check('10. Replaying the same idempotency key returns the same order, not a new one', async () => {
  const { body } = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: happyIdemKey });
  assert(body.success === true && body.idempotent === true, `expected idempotent replay, got ${JSON.stringify(body)}`);
  assert(body.orderId === happyOrderId, `expected same orderId, got ${body.orderId}`);

  const res = await fetch(`${REST}/orders?idempotency_key=eq.${happyIdemKey}&select=id`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 order for this key, found ${rows.length}`);
});

await check('11. A genuinely new attempt (new key) against the now-empty cart gets CART_EMPTY, not a phantom order', async () => {
  const { body } = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: `test-new-${Date.now()}` });
  assert(body.success === false && body.code === 'CART_EMPTY', `expected CART_EMPTY, got ${JSON.stringify(body)}`);
});

await check('12. Concurrent double-submit with the SAME idempotency key still creates exactly one order', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_MAKHANA_100, 1); // 149
  await addToCart(customerHeaders, V_RAISIN_250, 1); // 199 -> 348, clears the 299 minimum
  const key = `test-concurrent-idem-${Date.now()}`;
  const [r1, r2] = await Promise.all([
    rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: key }),
    rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: key }),
  ]);
  assert(r1.body.success && r2.body.success, `both should succeed: ${JSON.stringify(r1.body)} / ${JSON.stringify(r2.body)}`);
  assert(r1.body.orderId === r2.body.orderId, 'both responses should reference the same order');

  const res = await fetch(`${REST}/orders?idempotency_key=eq.${key}&select=id`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 order for this concurrent key, found ${rows.length}`);
});

// ---------------------------------------------------------------------
// Pricing edge cases
// ---------------------------------------------------------------------

await check('13. BELOW_MINIMUM_ORDER blocks order creation but summary is still viewable', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_MAKHANA_100, 1); // ₹149 < ₹299 minimum
  const summary = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
  assert(summary.body.success === true, 'summary should still render for a below-minimum cart');
  assert(summary.body.meetsMinimumOrder === false, 'expected meetsMinimumOrder false');
  assert(Number(summary.body.amountToMinimumOrder) === 150, `expected 150 needed, got ${summary.body.amountToMinimumOrder}`);

  const create = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: `test-min-${Date.now()}` });
  assert(create.body.success === false && create.body.code === 'BELOW_MINIMUM_ORDER', `expected BELOW_MINIMUM_ORDER, got ${JSON.stringify(create.body)}`);
});

await check('14. Non-free delivery fee applies between minimum order value and the free threshold', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_MAKHANA_100, 1); // 149
  await addToCart(customerHeaders, V_RAISIN_250, 1); // 199  -> subtotal 348, in [299, 499)
  const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
  assert(body.success === true, `expected success, got ${JSON.stringify(body)}`);
  assert(Number(body.subtotal) === 348, `expected subtotal 348, got ${body.subtotal}`);
  assert(Number(body.deliveryFee) === 49, `expected delivery fee 49, got ${body.deliveryFee}`);
});

let priceRestoreDone = false;
await check('15. PRICE_CHANGED is surfaced as a non-blocking warning, and the order uses the live price', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_DATES_250, 1); // sets price_snapshot = 349
  await fetch(`${REST}/product_variants?id=eq.${V_DATES_250}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ price: 329 }) });
  try {
    const summary = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
    assert(summary.body.success === true, `expected success, got ${JSON.stringify(summary.body)}`);
    assert(summary.body.warnings.length === 1 && summary.body.warnings[0].code === 'PRICE_CHANGED', `expected a PRICE_CHANGED warning, got ${JSON.stringify(summary.body.warnings)}`);
    assert(Number(summary.body.warnings[0].oldPrice) === 349 && Number(summary.body.warnings[0].newPrice) === 329, 'unexpected old/new price in warning');
    assert(Number(summary.body.subtotal) === 329, `expected the live price (329) in the total, got ${summary.body.subtotal}`);

    const create = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: `test-pricechange-${Date.now()}` });
    assert(create.body.success === true, `expected order to succeed, got ${JSON.stringify(create.body)}`);
    // 329 subtotal + 49 delivery fee (329 is >= the 299 minimum but < the 499 free-delivery threshold).
    assert(Number(create.body.total) === 378, `expected charged total 378 (live price 329 + delivery 49), got ${create.body.total}`);
  } finally {
    await fetch(`${REST}/product_variants?id=eq.${V_DATES_250}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ price: 349 }) });
    priceRestoreDone = true;
  }
});

await check('16. PRODUCT_UNAVAILABLE when a variant is deactivated mid-cart', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_CASHEW_250, 1);
  await fetch(`${REST}/product_variants?id=eq.${V_CASHEW_250}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: false }) });
  try {
    const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
    assert(body.success === false && body.code === 'PRODUCT_UNAVAILABLE', `expected PRODUCT_UNAVAILABLE, got ${JSON.stringify(body)}`);
    assert(Array.isArray(body.unavailableItems) && body.unavailableItems.length === 1, 'expected one unavailable item named');
  } finally {
    await fetch(`${REST}/product_variants?id=eq.${V_CASHEW_250}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: true }) });
  }
});

// ---------------------------------------------------------------------
// Fulfillment store selection: whole-cart coverage, no order-splitting
// ---------------------------------------------------------------------

await check('17. Deterministic single-store selection: only the store stocking BOTH lines is chosen', async () => {
  // V_CASHEW_250 only @ 101/102. V_CASHEW_500 only @ 101/103. Only 101
  // covers both — this must be the pick, with no partial fulfillment.
  // QA_TEST_MODE (20260826000076) now stocks every real variant at
  // every real store, so explicitly disable the two combinations the
  // original fixture never had (250 @ 103, 500 @ 102) rather than
  // relying on their absence — otherwise 102 and 103 would each cover
  // both lines too and this would stop testing "only one store" at all.
  await resetCart(customer.user.id);
  const savedCashew250AtAwas = await getInventory(STORE_AWAS_VIKAS, V_CASHEW_250);
  const savedCashew500AtVijay = await getInventory(STORE_VIJAY_NAGAR, V_CASHEW_500);
  if (savedCashew250AtAwas) await setInventory(STORE_AWAS_VIKAS, V_CASHEW_250, { is_available: false });
  if (savedCashew500AtVijay) await setInventory(STORE_VIJAY_NAGAR, V_CASHEW_500, { is_available: false });
  try {
    await addToCart(customerHeaders, V_CASHEW_250, 1);
    await addToCart(customerHeaders, V_CASHEW_500, 1);
    const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
    assert(body.success === true, `expected success, got ${JSON.stringify(body)}`);
    assert(body.storeId === STORE_SANJAY_PLACE, `expected Sanjay Place as the sole covering store, got ${body.storeId}`);
    assert(body.items.length === 2, 'expected both lines present (no splitting)');
  } finally {
    if (savedCashew250AtAwas) await setInventory(STORE_AWAS_VIKAS, V_CASHEW_250, { is_available: savedCashew250AtAwas.is_available });
    if (savedCashew500AtVijay) await setInventory(STORE_VIJAY_NAGAR, V_CASHEW_500, { is_available: savedCashew500AtVijay.is_available });
    await clearVariant(customerHeaders, V_CASHEW_250);
    await clearVariant(customerHeaders, V_CASHEW_500);
  }
});

await check('18. CART_NOT_FULFILLABLE when no single store covers the cart, with the blocking item named', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_ALMOND_500, 1); // originally only @ 101 & 103
  // Temporarily take it off everywhere — no store can fulfill it
  // anywhere. QA_TEST_MODE (20260826000076) now also stocks this at
  // Vijay Nagar (102), so that must be disabled too or it silently
  // fulfills the "unfulfillable" cart this test is asserting on.
  const savedVijay = await getInventory(STORE_VIJAY_NAGAR, V_ALMOND_500);
  await setInventory(STORE_SANJAY_PLACE, V_ALMOND_500, { is_available: false });
  await setInventory(STORE_AWAS_VIKAS, V_ALMOND_500, { is_available: false });
  if (savedVijay) await setInventory(STORE_VIJAY_NAGAR, V_ALMOND_500, { is_available: false });
  try {
    const { body } = await rpc(customerHeaders, 'get_checkout_summary', { p_address_id: addrNear });
    assert(body.success === false && body.code === 'CART_NOT_FULFILLABLE', `expected CART_NOT_FULFILLABLE, got ${JSON.stringify(body)}`);
    assert(Array.isArray(body.unavailableItems) && body.unavailableItems.length === 1, 'expected the blocking item to be named');
  } finally {
    await setInventory(STORE_SANJAY_PLACE, V_ALMOND_500, { is_available: true });
    await setInventory(STORE_AWAS_VIKAS, V_ALMOND_500, { is_available: true });
    if (savedVijay) await setInventory(STORE_VIJAY_NAGAR, V_ALMOND_500, { is_available: savedVijay.is_available });
    await clearVariant(customerHeaders, V_ALMOND_500);
  }
});

// ---------------------------------------------------------------------
// Concurrency: the real oversell test
// ---------------------------------------------------------------------

await check('19. Exactly one of two simultaneous checkouts wins the last unit of stock', async () => {
  await resetCart(customer.user.id);
  await resetCart(customer2.user.id);
  const savedSanjay = await getInventory(STORE_SANJAY_PLACE, V_DATES_250);
  const savedAwas = await getInventory(STORE_AWAS_VIKAS, V_DATES_250);
  const savedVijay = await getInventory(STORE_VIJAY_NAGAR, V_DATES_250);
  // Force single-store contention with exactly 1 unit available,
  // regardless of geography: only Sanjay Place stocks it, and only 1
  // unit. Vijay Nagar is disabled too — QA_TEST_MODE (20260826000076)
  // now stocks every real variant at every real store, so without this
  // it would silently provide a second, non-scarce path to "success"
  // and this test would stop testing the actual race.
  await setInventory(STORE_AWAS_VIKAS, V_DATES_250, { is_available: false });
  if (savedVijay) await setInventory(STORE_VIJAY_NAGAR, V_DATES_250, { is_available: false });
  await setInventory(STORE_SANJAY_PLACE, V_DATES_250, { quantity: savedSanjay.quantity, reserved_quantity: savedSanjay.quantity - 1, is_available: true });
  try {
    await addToCart(customerHeaders, V_DATES_250, 1);
    await addToCart(customer2Headers, V_DATES_250, 1);

    const [r1, r2] = await Promise.all([
      rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: `test-oversell-a-${Date.now()}` }),
      rpc(customer2Headers, 'create_order_from_cart', { p_address_id: addr2Near, p_idempotency_key: `test-oversell-b-${Date.now()}` }),
    ]);
    const results = [r1.body, r2.body];
    const succeeded = results.filter((r) => r.success === true);
    const failed = results.filter((r) => r.success === false);
    assert(succeeded.length === 1, `expected exactly 1 success, got ${succeeded.length}: ${JSON.stringify(results)}`);
    // The loser is rejected at whichever stage its request happened to
    // reach relative to the winner's commit: OUT_OF_STOCK if both
    // requests' store-selection ran before either reserved (the tight
    // race, decided by the atomic UPDATE), or CART_NOT_FULFILLABLE if
    // the winner had already committed by the time the loser's
    // resolve_checkout ran its own availability check. Both are
    // correct — neither leaves an oversold unit; only the code differs
    // with HTTP-level timing.
    assert(
      failed.length === 1 && (failed[0].code === 'OUT_OF_STOCK' || failed[0].code === 'CART_NOT_FULFILLABLE'),
      `expected the loser to be correctly rejected, got ${JSON.stringify(failed)}`,
    );

    const finalInv = await getInventory(STORE_SANJAY_PLACE, V_DATES_250);
    assert(finalInv.reserved_quantity === savedSanjay.quantity, `expected reservation to exactly exhaust stock (${savedSanjay.quantity}), got ${finalInv.reserved_quantity}`);
  } finally {
    await setInventory(STORE_SANJAY_PLACE, V_DATES_250, { quantity: savedSanjay.quantity, reserved_quantity: savedSanjay.reserved_quantity, is_available: savedSanjay.is_available });
    await setInventory(STORE_AWAS_VIKAS, V_DATES_250, { quantity: savedAwas.quantity, reserved_quantity: savedAwas.reserved_quantity, is_available: savedAwas.is_available });
    if (savedVijay) await setInventory(STORE_VIJAY_NAGAR, V_DATES_250, { quantity: savedVijay.quantity, reserved_quantity: savedVijay.reserved_quantity, is_available: savedVijay.is_available });
    await clearVariant(customerHeaders, V_DATES_250);
    await clearVariant(customer2Headers, V_DATES_250);
  }
});

// ---------------------------------------------------------------------
// Cancellation + reservation release
// ---------------------------------------------------------------------

await check('20. Owner cancellation releases the reservation', async () => {
  const before = await getInventory(STORE_SANJAY_PLACE, V_ALMOND_500);
  const { status, body } = await rpc(customerHeaders, 'update_order_status', { p_order_id: happyOrderId, p_new_status: 'cancelled' });
  // update_order_status returns void -> PostgREST responds 204 No Content, not 200.
  assert(status === 204, `expected 204, got ${status}: ${JSON.stringify(body)}`);

  const res = await fetch(`${REST}/orders?id=eq.${happyOrderId}&select=status`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows[0].status === 'cancelled', `expected cancelled, got ${rows[0].status}`);

  const after = await getInventory(STORE_SANJAY_PLACE, V_ALMOND_500);
  assert(after.reserved_quantity === before.reserved_quantity - 1, `expected reservation released, before=${before.reserved_quantity} after=${after.reserved_quantity}`);

  const historyRes = await fetch(`${REST}/order_status_history?order_id=eq.${happyOrderId}&new_status=eq.cancelled`, { headers: customerHeaders });
  const historyRows = await historyRes.json();
  assert(historyRows.length >= 1, 'expected a cancellation row in order_status_history');
});

await check('21. Owner cannot cancel an order already being packed', async () => {
  await resetCart(customer.user.id);
  await addToCart(customerHeaders, V_MAKHANA_100, 3); // 447, clears the 299 minimum
  const create = await rpc(customerHeaders, 'create_order_from_cart', { p_address_id: addrNear, p_idempotency_key: `test-packed-${Date.now()}` });
  assert(create.body.success === true, `setup order failed: ${JSON.stringify(create.body)}`);
  const orderId = create.body.orderId;
  await fetch(`${REST}/orders?id=eq.${orderId}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'packed' }) });
  try {
    const { status, body } = await rpc(customerHeaders, 'update_order_status', { p_order_id: orderId, p_new_status: 'cancelled' });
    assert(status >= 400, `expected an error status, got ${status}: ${JSON.stringify(body)}`);
  } finally {
    // Cleanup: staff-cancel via service role so this doesn't leave a dangling reservation.
    await fetch(`${REST}/orders?id=eq.${orderId}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'placed' }) });
    await rpc(customerHeaders, 'update_order_status', { p_order_id: orderId, p_new_status: 'cancelled' });
  }
});

// ---------------------------------------------------------------------
// RLS / cross-account isolation
// ---------------------------------------------------------------------

await check("22. Another customer cannot read this customer's order via REST", async () => {
  const res = await fetch(`${REST}/orders?id=eq.${happyOrderId}`, { headers: customer2Headers });
  const rows = await res.json();
  assert(rows.length === 0, `expected order invisible to another user, got ${rows.length} rows`);
});

await check("23. Another customer cannot cancel this customer's order", async () => {
  const { status, body } = await rpc(customer2Headers, 'update_order_status', { p_order_id: happyOrderId, p_new_status: 'cancelled' });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------
// Snapshot immutability
// ---------------------------------------------------------------------

await check("24. delivery_address snapshot is unaffected by later edits to the live address", async () => {
  const before = await fetch(`${REST}/orders?id=eq.${happyOrderId}&select=delivery_address`, { headers: customerHeaders }).then((r) => r.json());
  const originalCity = before[0].delivery_address.city;
  await fetch(`${REST}/addresses?id=eq.${addrNear}`, { method: 'PATCH', headers: customerHeaders, body: JSON.stringify({ city: 'Definitely A Different City' }) });
  try {
    const after = await fetch(`${REST}/orders?id=eq.${happyOrderId}&select=delivery_address`, { headers: customerHeaders }).then((r) => r.json());
    assert(after[0].delivery_address.city === originalCity, `expected snapshot city unchanged (${originalCity}), got ${after[0].delivery_address.city}`);
  } finally {
    await fetch(`${REST}/addresses?id=eq.${addrNear}`, { method: 'PATCH', headers: customerHeaders, body: JSON.stringify({ city: 'Agra' }) });
  }
});

// ---------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------

for (const a of createdAddresses) {
  await fetch(`${REST}/addresses?id=eq.${a.id}`, { method: 'DELETE', headers: a.headers });
}
if (savedSanjayStore) {
  await fetch(`${REST}/stores?id=eq.${STORE_SANJAY_PLACE}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify(savedSanjayStore) });
}
void priceRestoreDone;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
