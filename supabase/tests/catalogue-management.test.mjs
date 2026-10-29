#!/usr/bin/env node
/**
 * Pre-production hardening — catalogue management verification.
 * Before this phase, admin could not create/edit products, variants,
 * or initialize store inventory at all (only toggle is_active). This
 * suite verifies the new admin_create_product_full / admin_update_product
 * / admin_upsert_variant / admin_set_variant_active /
 * admin_initialize_inventory / admin_create_category / admin_update_category
 * RPCs — real permission enforcement, real transactional rollback on
 * bad data, real audit trail, and closes the exact gap
 * (adjust_inventory/record_inventory_adjustment both require an
 * existing row) that made a brand-new product's opening stock
 * impossible to set from the app.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... node supabase/tests/catalogue-management.test.mjs
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
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
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
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

console.log(`Running against ${URL}`);

const inventoryManager = await otpLogin('+919000000302');
const customer = await otpLogin('+919000000201');
const deliveryManagerLogin = await otpLogin('+919000000205'); // reused id, promoted below to delivery_manager for this suite only

// Set up the two scoped-role accounts fresh, same idiom every other suite uses.
await fetch(`${REST}/profiles?id=eq.${inventoryManager.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', admin_role: 'inventory_manager' }) });
const originalDeliveryProfile = await fetch(`${REST}/profiles?id=eq.${deliveryManagerLogin.user.id}&select=role,admin_role`, { headers: svcHeaders }).then((r) => r.json());
await fetch(`${REST}/profiles?id=eq.${deliveryManagerLogin.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', admin_role: 'delivery_manager' }) });

const invManagerHeaders = authed(inventoryManager.access_token);
const customerHeaders = authed(customer.access_token);
const deliveryManagerHeaders = authed(deliveryManagerLogin.access_token);

const DRY_FRUITS_CATEGORY = '00000000-0000-0000-0000-000000000201';
const STORE_A = '00000000-0000-0000-0000-000000000101';
const STORE_B = '00000000-0000-0000-0000-000000000102';
const rand = Math.random().toString(36).slice(2, 8);
// A product photo is mandatory (migration 20260827000011), so every payload below carries one;
// that way each rejection test still fails for the reason it names, not for a missing photo.
const TEST_IMAGE = 'https://example.com/test-photo.jpg';

let createdProductId = null;
let createdVariantIds = [];
let createdCategoryId = null;

await check('1. Customer cannot call admin_create_product_full', async () => {
  const r = await rpc(customerHeaders, 'admin_create_product_full', {
    p_product: { name: 'Hack Attempt', slug: `hack-${rand}`, image: TEST_IMAGE },
    p_variants: [{ sku: `HACK-${rand}`, weight_value: 500, weight_unit: 'g', price: 1, mrp: 1 }],
  });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('2. A scoped admin WITHOUT products.create (delivery_manager) cannot create a product', async () => {
  const r = await rpc(deliveryManagerHeaders, 'admin_create_product_full', {
    p_product: { name: 'Should Fail', slug: `should-fail-${rand}`, image: TEST_IMAGE },
    p_variants: [{ sku: `SF-${rand}`, weight_value: 500, weight_unit: 'g', price: 1, mrp: 1 }],
  });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('3. inventory_manager (has products.create) can create a product with 2 variants + inventory in one call', async () => {
  const r = await rpc(invManagerHeaders, 'admin_create_product_full', {
    p_product: {
      name: 'Test California Almonds', slug: `test-california-almonds-${rand}`, image: TEST_IMAGE,
      category_id: DRY_FRUITS_CATEGORY, short_description: 'Test product', tags: ['premium'], is_featured: true,
    },
    p_variants: [
      { sku: `TCA-250G-${rand}`, weight_value: 250, weight_unit: 'g', price: 250, mrp: 300 },
      { sku: `TCA-500G-${rand}`, weight_value: 500, weight_unit: 'g', price: 450, mrp: 550 },
    ],
    p_inventory: [
      { variant_index: 0, store_id: STORE_A, quantity: 20, reorder_level: 5, is_available: true },
      { variant_index: 1, store_id: STORE_A, quantity: 50, reorder_level: 5, is_available: true },
      { variant_index: 1, store_id: STORE_B, quantity: 30, reorder_level: 5, is_available: true },
    ],
  });
  assert(r.status === 200 && r.body?.success, `create failed: ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.variantIds.length === 2, 'expected 2 variant ids back');
  createdProductId = r.body.productId;
  createdVariantIds = r.body.variantIds;
});

await check('4. The created product + variants + inventory are real rows, readable via REST', async () => {
  const prod = await fetch(`${REST}/products?id=eq.${createdProductId}&select=*,product_variants(*)`, { headers: svcHeaders }).then((r) => r.json());
  assert(prod.length === 1, 'product not found');
  assert(prod[0].product_variants.length === 2, 'expected 2 variants on the product row');
  const inv = await fetch(`${REST}/inventory?product_variant_id=in.(${createdVariantIds.join(',')})&select=store_id,quantity`, { headers: svcHeaders }).then((r) => r.json());
  assert(inv.length === 3, `expected 3 inventory rows, got ${inv.length}`);
  const storeAVariant0 = inv.find((i) => i.store_id === STORE_A && i.quantity === 20);
  assert(storeAVariant0, 'Store A / 250g row with quantity 20 not found');
});

await check('5. Duplicate SKU within the same creation payload rolls back the WHOLE product (no half-created row)', async () => {
  const dupeSku = `DUPE-${rand}`;
  const r = await rpc(invManagerHeaders, 'admin_create_product_full', {
    p_product: { name: 'Rollback Test', slug: `rollback-test-${rand}`, image: TEST_IMAGE },
    p_variants: [
      { sku: dupeSku, weight_value: 100, weight_unit: 'g', price: 10, mrp: 12 },
      { sku: dupeSku, weight_value: 200, weight_unit: 'g', price: 20, mrp: 24 }, // same SKU twice
    ],
  });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
  const found = await fetch(`${REST}/products?slug=eq.rollback-test-${rand}&select=id`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(found.length === 0, 'product from a failed creation should not exist (transaction did not roll back)');
});

await check('6. Creating a product with a SKU that already exists elsewhere is rejected', async () => {
  const r = await rpc(invManagerHeaders, 'admin_create_product_full', {
    p_product: { name: 'Existing SKU Test', slug: `existing-sku-test-${rand}`, image: TEST_IMAGE },
    p_variants: [{ sku: `TCA-250G-${rand}`, weight_value: 250, weight_unit: 'g', price: 1, mrp: 2 }], // reuses variant 0's SKU from check 3
  });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('7. Invalid MRP (< price) is rejected', async () => {
  const r = await rpc(invManagerHeaders, 'admin_create_product_full', {
    p_product: { name: 'Bad MRP', slug: `bad-mrp-${rand}`, image: TEST_IMAGE },
    p_variants: [{ sku: `BADMRP-${rand}`, weight_value: 100, weight_unit: 'g', price: 100, mrp: 50 }],
  });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('8. admin_update_product updates fields and writes an audit_logs row', async () => {
  const r = await rpc(invManagerHeaders, 'admin_update_product', {
    p_product_id: createdProductId,
    p_product: { name: 'Test California Almonds (Updated)', category_id: DRY_FRUITS_CATEGORY, is_featured: false, is_bestseller: true, image: TEST_IMAGE },
  });
  assert(r.status === 200 && r.body?.success, `update failed: ${r.status} ${JSON.stringify(r.body)}`);
  const prod = await fetch(`${REST}/products?id=eq.${createdProductId}&select=name,is_bestseller`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(prod[0].name === 'Test California Almonds (Updated)' && prod[0].is_bestseller === true, 'update did not apply');
  const logs = await fetch(`${REST}/audit_logs?resource_id=eq.${createdProductId}&action=eq.product_updated&select=id`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(logs.length >= 1, 'no audit_logs row for product_updated');
});

await check('9. admin_upsert_variant creates a 3rd variant on the existing product', async () => {
  const r = await rpc(invManagerHeaders, 'admin_upsert_variant', {
    p_variant_id: null, p_product_id: createdProductId, p_sku: `TCA-1KG-${rand}`,
    p_weight_value: 1, p_weight_unit: 'kg', p_price: 800, p_mrp: 950,
  });
  assert(r.status === 200 && r.body?.success, `create variant failed: ${r.status} ${JSON.stringify(r.body)}`);
  createdVariantIds.push(r.body.variantId);
});

await check('10. admin_upsert_variant edits an existing variant', async () => {
  const r = await rpc(invManagerHeaders, 'admin_upsert_variant', {
    p_variant_id: createdVariantIds[0], p_product_id: createdProductId, p_sku: `TCA-250G-${rand}`,
    p_weight_value: 250, p_weight_unit: 'g', p_price: 260, p_mrp: 310,
  });
  assert(r.status === 200 && r.body?.success, `edit variant failed: ${r.status} ${JSON.stringify(r.body)}`);
  const v = await fetch(`${REST}/product_variants?id=eq.${createdVariantIds[0]}&select=price`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(Number(v[0].price) === 260, `price did not update, got ${v[0].price}`);
});

await check('11. admin_set_variant_active archives a variant (no hard delete)', async () => {
  const r = await rpc(invManagerHeaders, 'admin_set_variant_active', { p_variant_id: createdVariantIds[2], p_is_active: false });
  assert(r.status === 204 || r.status === 200, `archive failed: ${r.status} ${JSON.stringify(r.body)}`);
  const v = await fetch(`${REST}/product_variants?id=eq.${createdVariantIds[2]}&select=is_active`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(v.length === 1 && v[0].is_active === false, 'variant was not archived (or was hard-deleted)');
});

await check('12. admin_initialize_inventory creates a NEW row for Store C (previously impossible via adjust_inventory)', async () => {
  const r = await rpc(invManagerHeaders, 'admin_initialize_inventory', {
    p_store_id: STORE_B, p_variant_id: createdVariantIds[0], p_quantity: 15, p_reorder_level: 3, p_is_available: true,
  });
  assert(r.status === 200 && r.body?.success, `init failed: ${r.status} ${JSON.stringify(r.body)}`);
  const inv = await fetch(`${REST}/inventory?store_id=eq.${STORE_B}&product_variant_id=eq.${createdVariantIds[0]}&select=quantity`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(inv.length === 1 && inv[0].quantity === 15, 'inventory row was not created with quantity 15');
});

await check('13. admin_initialize_inventory called again UPDATES the same row (upsert, not duplicate)', async () => {
  const r = await rpc(invManagerHeaders, 'admin_initialize_inventory', {
    p_store_id: STORE_B, p_variant_id: createdVariantIds[0], p_quantity: 25, p_reorder_level: 3, p_is_available: true,
  });
  assert(r.status === 200 && r.body?.success, `re-init failed: ${r.status} ${JSON.stringify(r.body)}`);
  const inv = await fetch(`${REST}/inventory?store_id=eq.${STORE_B}&product_variant_id=eq.${createdVariantIds[0]}&select=quantity`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(inv.length === 1 && inv[0].quantity === 25, `expected exactly one row updated to 25, got ${JSON.stringify(inv)}`);
});

await check('14. Customer cannot call admin_initialize_inventory', async () => {
  const r = await rpc(customerHeaders, 'admin_initialize_inventory', { p_store_id: STORE_A, p_variant_id: createdVariantIds[0], p_quantity: 999 });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('15. admin_create_category creates a subcategory with description/image/parent/sort', async () => {
  const r = await rpc(invManagerHeaders, 'admin_create_category', {
    p_name: `Test Almonds ${rand}`, p_slug: `test-almonds-${rand}`, p_description: 'A test subcategory',
    p_image_url: 'https://example.com/img.jpg', p_parent_id: DRY_FRUITS_CATEGORY, p_sort_order: 1,
  });
  assert(r.status === 200 && r.body?.success, `create category failed: ${r.status} ${JSON.stringify(r.body)}`);
  createdCategoryId = r.body.categoryId;
  const cat = await fetch(`${REST}/categories?id=eq.${r.body.categoryId}&select=parent_id,description`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(cat[0].parent_id === DRY_FRUITS_CATEGORY && cat[0].description === 'A test subcategory', 'category fields not set correctly');
});

await check('16. admin_update_category rejects a category being set as its own parent', async () => {
  const r = await rpc(invManagerHeaders, 'admin_update_category', { p_category_id: DRY_FRUITS_CATEGORY, p_name: 'Dry Fruits', p_parent_id: DRY_FRUITS_CATEGORY });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('17. Customer cannot call admin_create_category', async () => {
  const r = await rpc(customerHeaders, 'admin_create_category', { p_name: 'Hack Category', p_slug: `hack-cat-${rand}` });
  assert(r.status >= 400, `expected rejection, got ${r.status}`);
});

await check('A. Creating a product with no photo is rejected by the database', async () => {
  for (const image of [undefined, '', '   ']) {
    const r = await rpc(invManagerHeaders, 'admin_create_product_full', {
      p_product: { name: 'No Photo', slug: `no-photo-${rand}`, image },
      p_variants: [{ sku: `NOPHOTO-${rand}`, weight_value: 100, weight_unit: 'g', price: 10, mrp: 12 }],
    });
    assert(r.status >= 400 && /photo is required/i.test(JSON.stringify(r.body)), `expected "photo is required", got ${r.status} ${JSON.stringify(r.body)}`);
  }
  const found = await fetch(`${REST}/products?slug=eq.no-photo-${rand}&select=id`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(found.length === 0, 'a photo-less product row was created');
});

await check('B. An existing product cannot have its photo removed', async () => {
  const r = await rpc(invManagerHeaders, 'admin_update_product', {
    p_product_id: createdProductId,
    p_product: { name: 'Test California Almonds (Updated)', category_id: DRY_FRUITS_CATEGORY, image: null },
  });
  assert(r.status >= 400 && /photo is required/i.test(JSON.stringify(r.body)), `expected "photo is required", got ${r.status} ${JSON.stringify(r.body)}`);
  const prod = await fetch(`${REST}/products?id=eq.${createdProductId}&select=image`, { headers: svcHeaders }).then((r2) => r2.json());
  assert(prod[0].image === TEST_IMAGE, 'the stored photo changed');
});

// Cleanup: restore the delivery_manager test account, and fully delete
// (not just deactivate) everything this run created — a previous
// version of this cleanup only deactivated the product and never
// touched the category from test 15 at all, which is exactly how ~10
// "Test Almonds xxxxx" categories accumulated as real, customer-
// visible clutter in the live Categories screen over this project's
// testing history (reported live by the owner). inventory_movements
// has no ON DELETE CASCADE from product_variants, so it must be
// cleared explicitly before the product delete cascades through
// product_variants -> inventory.
await fetch(`${REST}/profiles?id=eq.${deliveryManagerLogin.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify(originalDeliveryProfile[0]) });
if (createdProductId) {
  const variantIds = await fetch(`${REST}/product_variants?product_id=eq.${createdProductId}&select=id`, { headers: svcHeaders }).then((r) => r.json()).then((rows) => rows.map((r) => r.id));
  if (variantIds.length > 0) {
    await fetch(`${REST}/inventory_movements?product_variant_id=in.(${variantIds.join(',')})`, { method: 'DELETE', headers: svcHeaders });
  }
  await fetch(`${REST}/products?id=eq.${createdProductId}`, { method: 'DELETE', headers: svcHeaders });
}
if (createdCategoryId) {
  await fetch(`${REST}/categories?id=eq.${createdCategoryId}`, { method: 'DELETE', headers: svcHeaders });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
