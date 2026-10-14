#!/usr/bin/env node
/**
 * Phase 02 (Product & Catalogue Backend) verification suite.
 *
 * Deliberately a live integration test against the real REST API with
 * the anon key, not a mocked unit test — most of what section 31 asks
 * to verify (RLS enforcement, search, store-specific availability) is
 * database behavior that a mocked test would never actually exercise.
 * A green run here means Postgres itself enforced it, not just that
 * the TypeScript happened to call the right method.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... node supabase/tests/phase02-catalogue.test.mjs
 *
 * SUPABASE_SERVICE_ROLE_KEY is used for exactly one thing (test 6's
 * hermetic setup/restore) — every other check here is a pure anon-key
 * read, deliberately, per the comment above.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see .env).');
  process.exit(1);
}
const BASE = `${URL}/rest/v1`;
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' };
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

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

console.log(`Running against ${URL}\n`);

await check('1. Active products are returned', async () => {
  const { status, body } = await get('/products?select=id,is_active&limit=5');
  assert(status === 200, `status ${status}`);
  assert(Array.isArray(body) && body.length > 0, 'expected at least one product');
});

await check('2. Inactive products are excluded (RLS, not just app-code filtering)', async () => {
  // No is_active filter in the query at all — if this still only
  // returns active rows, RLS itself is the boundary, not the query.
  const { body } = await get('/products?select=is_active');
  assert(body.every((p) => p.is_active === true), 'a row with is_active=false leaked through RLS');
});

await check('3. Top-level categories load', async () => {
  const { status, body } = await get('/categories?select=id,parent_id&parent_id=is.null');
  assert(status === 200, `status ${status}`);
  assert(body.length >= 5, `expected >=5 top-level categories, got ${body.length}`);
});

await check('4. Subcategories resolve to the correct parent', async () => {
  const { body: parents } = await get('/categories?select=id&slug=eq.dry-fruits');
  assert(parents.length === 1, 'dry-fruits category not found');
  const { body: children } = await get(`/categories?select=slug&parent_id=eq.${parents[0].id}`);
  const slugs = children.map((c) => c.slug);
  assert(slugs.includes('almonds') && slugs.includes('cashews'), `missing expected children, got ${slugs}`);
});

await check('5. Product variants load with a product', async () => {
  const { body } = await get('/products?select=name,product_variants(id,price,mrp)&slug=eq.premium-california-almonds');
  assert(body.length === 1, 'product not found by slug');
  assert(body[0].product_variants.length === 3, `expected 3 variants, got ${body[0].product_variants.length}`);
});

await check('6. Store-specific availability differs by store (not global)', async () => {
  // Deliberately hermetic (save + restore via service role), not
  // dependent on a fixed seed fixture: the final pre-launch QA
  // hardening pass (see project notes) intentionally resets every
  // active variant to a large, uniform quantity at every real store so
  // the whole catalogue stays genuinely orderable everywhere — which
  // legitimately erases whatever store-specific low-stock fixture this
  // test used to rely on. The feature this test protects
  // (product_availability computing stock_status PER STORE, not
  // globally) is still real and still needs coverage, so we create the
  // variance ourselves instead of assuming it's already there.
  const VARIANT = '00000000-0000-0000-0000-000000000402';
  const STORE = '00000000-0000-0000-0000-000000000102'; // Vijay Nagar
  const beforeRes = await fetch(`${BASE}/inventory?product_variant_id=eq.${VARIANT}&store_id=eq.${STORE}&select=quantity,reserved_quantity,is_available`, { headers: svcHeaders });
  const before = (await beforeRes.json())[0];
  assert(before, `no inventory row for variant ${VARIANT} at store ${STORE} to test against`);
  try {
    const patchRes = await fetch(`${BASE}/inventory?product_variant_id=eq.${VARIANT}&store_id=eq.${STORE}`, {
      method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ quantity: 0 }),
    });
    assert(patchRes.status === 204, `setup: failed to zero out test fixture, status ${patchRes.status}`);
    const { body } = await get(`/product_availability?select=store_id,stock_status&product_variant_id=eq.${VARIANT}`);
    const statuses = new Set(body.map((r) => r.stock_status));
    assert(statuses.size > 1, `expected availability to differ across stores, got uniform ${[...statuses]}`);
    const zeroedRow = body.find((r) => r.store_id === STORE);
    assert(zeroedRow?.stock_status === 'out_of_stock', `expected store ${STORE} to read out_of_stock after zeroing its quantity, got ${zeroedRow?.stock_status}`);
  } finally {
    await fetch(`${BASE}/inventory?product_variant_id=eq.${VARIANT}&store_id=eq.${STORE}`, {
      method: 'PATCH', headers: svcHeaders, body: JSON.stringify(before),
    });
  }
});

await check('7. Search is case-insensitive and server-side', async () => {
  const { body: lower } = await get('/products?select=name&or=(name.ilike.%25almond%25,short_description.ilike.%25almond%25)');
  const { body: upper } = await get('/products?select=name&or=(name.ilike.%25ALMOND%25,short_description.ilike.%25ALMOND%25)');
  assert(lower.length > 0, 'expected results for lowercase search');
  assert(lower.length === upper.length, 'case sensitivity leaked into search');
});

await check('8. Pagination (range) works and total count is available', async () => {
  const res = await fetch(`${BASE}/products?select=id`, { headers: { ...headers, Range: '0-1', Prefer: 'count=exact' } });
  assert(res.status === 206, `expected 206 Partial Content for a range request, got ${res.status}`);
  const body = await res.json();
  assert(body.length === 2, `expected 2 rows for range 0-1, got ${body.length}`);
  const contentRange = res.headers.get('content-range');
  assert(contentRange && /\/\d+$/.test(contentRange), `expected a total count in content-range, got "${contentRange}"`);
});

await check('9. Sorting (newest first) returns descending created_at', async () => {
  const { body } = await get('/products?select=created_at&order=created_at.desc&limit=5');
  const dates = body.map((r) => new Date(r.created_at).getTime());
  const sorted = [...dates].sort((a, b) => b - a);
  assert(JSON.stringify(dates) === JSON.stringify(sorted), 'results were not sorted newest-first');
});

await check('10. Nonexistent product returns empty, not an error', async () => {
  const { status, body } = await get('/products?select=id&id=eq.00000000-0000-0000-0000-000000000000');
  assert(status === 200, `expected 200 with empty body, got ${status}`);
  assert(Array.isArray(body) && body.length === 0, 'expected empty array for nonexistent id');
});

await check('11. Customers cannot modify catalogue data (insert rejected)', async () => {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Hacked Product', slug: `hacked-${Date.now()}` }),
  });
  assert(res.status === 401 || res.status === 403, `expected the insert to be rejected, got ${res.status}`);
});

await check('12. Customers cannot modify inventory', async () => {
  const { body: before } = await get(
    '/inventory?select=quantity&store_id=eq.00000000-0000-0000-0000-000000000101&product_variant_id=eq.00000000-0000-0000-0000-000000000401',
  );
  // anon can't even SELECT the base inventory table (empty, not an
  // error) — confirm that first, then confirm a write is rejected too.
  assert(before.length === 0, 'anon should not be able to read raw inventory rows at all');
  const res = await fetch(
    `${BASE}/inventory?store_id=eq.00000000-0000-0000-0000-000000000101&product_variant_id=eq.00000000-0000-0000-0000-000000000401`,
    { method: 'PATCH', headers, body: JSON.stringify({ quantity: 999999 }) },
  );
  const body = await res.json().catch(() => null);
  assert(!body || body.length === 0 || res.status >= 400, 'inventory update should not have visibly succeeded');
});

await check('13. Prices come from the database as numbers', async () => {
  const { body } = await get('/product_variants?select=price,mrp&limit=5');
  assert(body.length > 0, 'no variants found');
  assert(body.every((v) => typeof v.price === 'number' && typeof v.mrp === 'number'), 'price/mrp were not numeric');
});

await check('14. Product detail returns the right variant count and weights', async () => {
  const { body } = await get('/products?select=name,product_variants(weight_value,weight_unit)&slug=eq.premium-whole-cashews');
  assert(body.length === 1, 'cashews product not found');
  const labels = body[0].product_variants.map((v) => `${v.weight_value}${v.weight_unit}`).sort();
  assert(JSON.stringify(labels) === JSON.stringify(['250g', '500g']), `unexpected variants: ${labels}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
