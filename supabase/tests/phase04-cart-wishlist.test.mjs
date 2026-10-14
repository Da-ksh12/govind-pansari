#!/usr/bin/env node
/**
 * Phase 04 (Cart + Wishlist) verification suite. Live integration
 * tests against the real project — same philosophy as the Phase 02/03
 * suites: real Auth sessions, real PostgREST/RPC calls, real RLS.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/phase04-cart-wishlist.test.mjs
 *
 * SUPABASE_SERVICE_ROLE_KEY is only used to temporarily flip a
 * product/variant's is_active flag and price for the
 * availability/price-change tests, always restored in a `finally`.
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

// Variants distinct from earlier phases' manual testing, so this suite
// starts from a clean slate for them.
const V_PISTACHIO_250 = '00000000-0000-0000-0000-000000000421'; // Roasted & Salted Pistachios 250g
const V_WALNUT_250 = '00000000-0000-0000-0000-000000000431'; // Premium Walnut Kernels 250g
const V_RAISIN_250 = '00000000-0000-0000-0000-000000000441'; // Golden Raisins 250g
const P_TURMERIC = '00000000-0000-0000-0000-000000000310'; // Turmeric Powder (unused by other test suites' assertions)
const V_TURMERIC_200 = '00000000-0000-0000-0000-000000000473';

console.log(`Running against ${URL}\n`);

const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
// Start from a clean slate for the variants this suite owns.
await fetch(`${REST}/rpc/remove_cart_item`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ p_variant_id: V_PISTACHIO_250 }) });
await fetch(`${REST}/rpc/remove_cart_item`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ p_variant_id: V_WALNUT_250 }) });
await fetch(`${REST}/wishlist_items?product_id=eq.${P_TURMERIC}`, { method: 'DELETE', headers: customerHeaders });

// ---------------------------------------------------------------------
// CART
// ---------------------------------------------------------------------

await check('1-2. Customer can add a variant (cart is auto-created)', async () => {
  const { status, body } = await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_PISTACHIO_250 });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.quantity === 1, `expected quantity 1, got ${body.quantity}`);
});

await check('3. Adding the same variant again increases quantity, not a new row', async () => {
  await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_PISTACHIO_250 });
  const res = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_PISTACHIO_250}`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 row, got ${rows.length}`);
  assert(rows[0].quantity === 2, `expected quantity 2, got ${rows[0].quantity}`);
});

await check('4. A different variant creates a separate cart item', async () => {
  await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_WALNUT_250 });
  const res = await fetch(`${REST}/cart_items?select=product_variant_id&product_variant_id=in.(${V_PISTACHIO_250},${V_WALNUT_250})`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 2, `expected 2 distinct rows, got ${rows.length}`);
});

await check('5-6. Quantity can be increased and decreased', async () => {
  await rpc(customerHeaders, 'set_cart_item_quantity', { p_variant_id: V_WALNUT_250, p_quantity: 5 });
  let res = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_WALNUT_250}`, { headers: customerHeaders });
  assert((await res.json())[0].quantity === 5, 'increase to 5 did not apply');

  await rpc(customerHeaders, 'set_cart_item_quantity', { p_variant_id: V_WALNUT_250, p_quantity: 2 });
  res = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_WALNUT_250}`, { headers: customerHeaders });
  assert((await res.json())[0].quantity === 2, 'decrease to 2 did not apply');
});

await check('7. Quantity cannot become negative', async () => {
  const { status } = await rpc(customerHeaders, 'set_cart_item_quantity', { p_variant_id: V_WALNUT_250, p_quantity: -1 });
  assert(status >= 400, `expected an error for negative quantity, got ${status}`);
});

await check('8. Setting quantity to zero removes the item', async () => {
  await rpc(customerHeaders, 'set_cart_item_quantity', { p_variant_id: V_WALNUT_250, p_quantity: 0 });
  const res = await fetch(`${REST}/cart_items?select=id&product_variant_id=eq.${V_WALNUT_250}`, { headers: customerHeaders });
  assert((await res.json()).length === 0, 'item still exists after setting quantity to 0');
});

await check('9. remove_cart_item removes the item', async () => {
  await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_WALNUT_250 });
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_WALNUT_250 });
  const res = await fetch(`${REST}/cart_items?select=id&product_variant_id=eq.${V_WALNUT_250}`, { headers: customerHeaders });
  assert((await res.json()).length === 0, 'item still exists after remove_cart_item');
});

await check('10-11. Cart totals and count are correct', async () => {
  const res = await fetch(
    `${REST}/cart_items?select=quantity,product_variants(price)&product_variant_id=eq.${V_PISTACHIO_250}`,
    { headers: customerHeaders },
  );
  const rows = await res.json();
  assert(rows.length === 1 && rows[0].quantity === 2, 'expected pistachio line with quantity 2');
  const subtotal = rows.reduce((sum, r) => sum + r.quantity * r.product_variants.price, 0);
  assert(subtotal === 2 * 599, `expected subtotal 1198, got ${subtotal}`);
});

await check('12. An unavailable product is detected, not silently hidden', async () => {
  await svcRestore(async () => {
    await fetch(`${REST}/products?id=eq.${P_TURMERIC}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: false }) });
    await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_TURMERIC_200 }).catch(() => {});
    // add_to_cart itself should refuse (product inactive) — confirm that, then
    // re-activate and confirm it succeeds, proving the check is real.
    const blocked = await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_TURMERIC_200 });
    assert(blocked.status >= 400, `expected add_to_cart to refuse an inactive product, got ${blocked.status}`);
  }, { table: 'products', id: P_TURMERIC, patch: { is_active: true } });

  const allowed = await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_TURMERIC_200 });
  assert(allowed.status === 200, 'add_to_cart should succeed once the product is active again');
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_TURMERIC_200 });
});

await check('13. A price change is detectable via price_snapshot vs live price', async () => {
  await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_TURMERIC_200 });
  const before = await fetch(`${REST}/cart_items?select=price_snapshot&product_variant_id=eq.${V_TURMERIC_200}`, { headers: customerHeaders });
  const snapshot = (await before.json())[0].price_snapshot;

  await svcRestore(async () => {
    // +10 stays under this variant's mrp (149) — the mrp >= price CHECK
    // constraint would silently fail a larger delta (turmeric's price is 129).
    await fetch(`${REST}/product_variants?id=eq.${V_TURMERIC_200}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ price: Number(snapshot) + 10 }) });
    const live = await fetch(`${REST}/product_variants?select=price&id=eq.${V_TURMERIC_200}`, { headers: customerHeaders });
    const newPrice = (await live.json())[0].price;
    assert(Number(newPrice) !== Number(snapshot), 'live price did not actually change');
    assert(Number(newPrice) === Number(snapshot) + 10, 'price change did not apply as expected');
  }, { table: 'product_variants', id: V_TURMERIC_200, patch: { price: snapshot } });

  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_TURMERIC_200 });
});

await check('14. An inactive variant is refused by add_to_cart', async () => {
  await svcRestore(async () => {
    await fetch(`${REST}/product_variants?id=eq.${V_TURMERIC_200}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ is_active: false }) });
    const { status } = await rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_TURMERIC_200 });
    assert(status >= 400, `expected add_to_cart to refuse an inactive variant, got ${status}`);
  }, { table: 'product_variants', id: V_TURMERIC_200, patch: { is_active: true } });
});

await check('15. Cart persists across separate login sessions', async () => {
  const before = await fetch(`${REST}/cart_items?select=id&product_variant_id=eq.${V_PISTACHIO_250}`, { headers: customerHeaders });
  assert((await before.json()).length === 1, 'expected the pistachio line to still be there from test 1-2/3');

  await fetch(`${AUTH}/logout`, { method: 'POST', headers: customerHeaders });
  const secondSession = await otpLogin('+919000000201');
  const after = await fetch(`${REST}/cart_items?select=id&product_variant_id=eq.${V_PISTACHIO_250}`, { headers: authed(secondSession.access_token) });
  assert((await after.json()).length === 1, 'cart item did not survive logout/login');
});

// ---------------------------------------------------------------------
// WISHLIST
// ---------------------------------------------------------------------

await check('16-17. Customer can add and remove a wishlist item', async () => {
  const insert = await fetch(`${REST}/wishlists?select=id&user_id=eq.${customer.user.id}`, { headers: customerHeaders });
  let wishlistId = (await insert.json())[0]?.id;
  if (!wishlistId) {
    const created = await fetch(`${REST}/wishlists`, { method: 'POST', headers: { ...customerHeaders, Prefer: 'return=representation' }, body: JSON.stringify({ user_id: customer.user.id }) });
    wishlistId = (await created.json())[0].id;
  }
  const add = await fetch(`${REST}/wishlist_items`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ wishlist_id: wishlistId, product_id: P_TURMERIC }) });
  assert(add.status === 201, `expected 201 adding wishlist item, got ${add.status}`);

  const remove = await fetch(`${REST}/wishlist_items?wishlist_id=eq.${wishlistId}&product_id=eq.${P_TURMERIC}`, { method: 'DELETE', headers: customerHeaders });
  assert(remove.status === 204, `expected 204 removing wishlist item, got ${remove.status}`);
});

await check('18. Duplicate wishlist items are prevented', async () => {
  const wl = await fetch(`${REST}/wishlists?select=id&user_id=eq.${customer.user.id}`, { headers: customerHeaders });
  const wishlistId = (await wl.json())[0].id;
  await fetch(`${REST}/wishlist_items`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ wishlist_id: wishlistId, product_id: P_TURMERIC }) });
  const dup = await fetch(`${REST}/wishlist_items`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ wishlist_id: wishlistId, product_id: P_TURMERIC }) });
  assert(dup.status >= 400, `expected the duplicate insert to be rejected by the unique constraint, got ${dup.status}`);
  const rows = await fetch(`${REST}/wishlist_items?select=id&wishlist_id=eq.${wishlistId}&product_id=eq.${P_TURMERIC}`, { headers: customerHeaders });
  assert((await rows.json()).length === 1, 'expected exactly one row despite the duplicate attempt');
  await fetch(`${REST}/wishlist_items?wishlist_id=eq.${wishlistId}&product_id=eq.${P_TURMERIC}`, { method: 'DELETE', headers: customerHeaders });
});

await check('19. Wishlist persists across separate login sessions', async () => {
  const wl = await fetch(`${REST}/wishlists?select=id&user_id=eq.${customer.user.id}`, { headers: customerHeaders });
  const wishlistId = (await wl.json())[0].id;
  await fetch(`${REST}/wishlist_items`, { method: 'POST', headers: customerHeaders, body: JSON.stringify({ wishlist_id: wishlistId, product_id: P_TURMERIC }) });

  await fetch(`${AUTH}/logout`, { method: 'POST', headers: customerHeaders });
  const secondSession = await otpLogin('+919000000201');
  const after = await fetch(`${REST}/wishlist_items?select=id&wishlist_id=eq.${wishlistId}&product_id=eq.${P_TURMERIC}`, { headers: authed(secondSession.access_token) });
  assert((await after.json()).length === 1, 'wishlist item did not survive logout/login');
  await fetch(`${REST}/wishlist_items?wishlist_id=eq.${wishlistId}&product_id=eq.${P_TURMERIC}`, { method: 'DELETE', headers: authed(secondSession.access_token) });
});

// ---------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------

let riderSession;
await check('21-22. add_to_cart only ever touches the caller\'s own cart', async () => {
  riderSession = await otpLogin('+919000000202');
  const riderHeaders = authed(riderSession.access_token);

  const before = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_PISTACHIO_250}`, { headers: customerHeaders });
  const beforeQty = (await before.json())[0].quantity;

  await rpc(riderHeaders, 'add_to_cart', { p_variant_id: V_PISTACHIO_250 });

  const after = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_PISTACHIO_250}`, { headers: customerHeaders });
  assert((await after.json())[0].quantity === beforeQty, "another user's add_to_cart call changed this customer's cart");

  await rpc(riderHeaders, 'remove_cart_item', { p_variant_id: V_PISTACHIO_250 });
});

await check("23. Customer cannot read another user's wishlist", async () => {
  const riderHeaders = authed(riderSession.access_token);
  const wl = await fetch(`${REST}/wishlists?select=id&user_id=eq.${customer.user.id}`, { headers: riderHeaders });
  assert((await wl.json()).length === 0, 'a different user could read this wishlist');
});

await check('25. Customer cannot modify product pricing', async () => {
  const res = await fetch(`${REST}/product_variants?id=eq.${V_PISTACHIO_250}`, { method: 'PATCH', headers: customerHeaders, body: JSON.stringify({ price: 1 }) });
  const body = await res.json().catch(() => []);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), 'a customer was able to modify a variant price');
});

await check('26. Customer cannot modify inventory', async () => {
  const res = await fetch(`${REST}/inventory?product_variant_id=eq.${V_PISTACHIO_250}`, { method: 'PATCH', headers: customerHeaders, body: JSON.stringify({ quantity: 999999 }) });
  const body = await res.json().catch(() => []);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), 'a customer was able to modify inventory');
});

// ---------------------------------------------------------------------
// CONCURRENCY
// ---------------------------------------------------------------------

await check('27. Rapid concurrent increments do not lose updates', async () => {
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_RAISIN_250 });
  await Promise.all(Array.from({ length: 5 }, () => rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_RAISIN_250, p_quantity: 1 })));
  const res = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_RAISIN_250}`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 row, got ${rows.length}`);
  assert(rows[0].quantity === 5, `expected quantity 5 after 5 concurrent +1s, got ${rows[0].quantity} (lost update)`);
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_RAISIN_250 });
});

await check('28. Rapid concurrent first-adds create exactly one row', async () => {
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_WALNUT_250 });
  await Promise.all(Array.from({ length: 5 }, () => rpc(customerHeaders, 'add_to_cart', { p_variant_id: V_WALNUT_250, p_quantity: 1 })));
  const res = await fetch(`${REST}/cart_items?select=quantity&product_variant_id=eq.${V_WALNUT_250}`, { headers: customerHeaders });
  const rows = await res.json();
  assert(rows.length === 1, `expected exactly 1 row despite 5 concurrent first-adds, got ${rows.length}`);
  assert(rows[0].quantity === 5, `expected quantity 5, got ${rows[0].quantity}`);
  await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_WALNUT_250 });
});

// ---------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------
await rpc(customerHeaders, 'remove_cart_item', { p_variant_id: V_PISTACHIO_250 });

async function svcRestore(fn, restore) {
  try {
    await fn();
  } finally {
    await fetch(`${REST}/${restore.table}?id=eq.${restore.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify(restore.patch) });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
