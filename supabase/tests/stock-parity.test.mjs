#!/usr/bin/env node
/**
 * Stock parity suite — guards against "no store near you can fulfil your whole cart".
 * READ-ONLY (signs in as the QA super admin, +919000000301 / OTP 123456).
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     node supabase/tests/stock-parity.test.mjs
 *
 * Checkout needs one store holding every item, so for the stores that actually serve customers:
 *   - every active store has a stock record for every active product variant (migration 20260827000012),
 *   - an item is not sellable at one active store and unsellable at another,
 *   - the fixture store "Not a real branch" is not left active.
 * Products named like test data (jjllk, ghgh, Test*, ZZ*) are ignored.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
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
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const base = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
await fetch(`${URL}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone: '+919000000301' }) });
const session = await (await fetch(`${URL}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone: '+919000000301', token: '123456' }) })).json();
if (!session.access_token) {
  console.error('QA admin login failed — is +919000000301 in the sms_test_otp allowlist?');
  process.exit(1);
}
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` };
const get = async (path) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> ${res.status}`);
  return res.json();
};

const isTestName = (n) => /^(jjllk|ghgh|test|zz)/i.test(n);
const stores = (await get('stores?select=id,name,is_active,status_reason')).filter((s) => s.is_active);
const variants = (await get('product_variants?select=id,weight_value,weight_unit,is_active,products(name,is_active)&limit=3000'))
  .filter((v) => v.is_active && v.products?.is_active && !isTestName(v.products.name));
const inventory = await get('inventory?select=store_id,product_variant_id,quantity,reserved_quantity,is_available&limit=10000');
const stock = new Map(inventory.map((i) => [`${i.store_id}:${i.product_variant_id}`, i]));
const label = (v) => `${v.products.name} ${v.weight_value}${v.weight_unit}`;
const sellable = (i) => Boolean(i) && i.is_available && i.quantity - i.reserved_quantity > 0;

console.log(`Active stores: ${stores.map((s) => s.name).join(' | ')} — ${variants.length} real variants\n`);

await check('no store marked "Not a real branch" is active', () => {
  const fixtures = stores.filter((s) => /^not a real branch/i.test(s.status_reason ?? ''));
  assert(fixtures.length === 0, `still active: ${fixtures.map((s) => s.name).join(', ')}`);
});

await check('every active store has a stock record for every active variant (no silent gaps)', () => {
  const gaps = [];
  for (const s of stores) for (const v of variants) if (!stock.has(`${s.id}:${v.id}`)) gaps.push(`${s.name.split('— ')[1]}: ${label(v)}`);
  assert(gaps.length === 0, `${gaps.length} missing record(s):\n        ${gaps.slice(0, 15).join('\n        ')}`);
});

await check('an item is never sellable at one active store and unsellable at another', () => {
  if (stores.length < 2) return;
  const lopsided = [];
  for (const v of variants) {
    const flags = stores.map((s) => sellable(stock.get(`${s.id}:${v.id}`)));
    if (flags.some(Boolean) && !flags.every(Boolean)) {
      lopsided.push(`${label(v)} (${stores.map((s, i) => `${s.name.split('— ')[1]}: ${flags[i] ? 'yes' : 'NO'}`).join(', ')})`);
    }
  }
  assert(lopsided.length === 0, `${lopsided.length} lopsided item(s):\n        ${lopsided.join('\n        ')}`);
});

await check('every real variant can be sold somewhere (nothing listed that no store can supply)', () => {
  const nowhere = variants.filter((v) => !stores.some((s) => sellable(stock.get(`${s.id}:${v.id}`)))).map(label);
  assert(nowhere.length === 0, `sold out everywhere: ${nowhere.join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
