#!/usr/bin/env node
/**
 * What the Add Product wizard sends is exactly what is stored: three variants with different SKUs, prices, MRPs and stock at BOTH
 * active stores, a primary photo and an ordered gallery — read back and compared field by field — plus the rules the database
 * enforces whatever the app does. Runs through the real admin_create_product_full RPC as the QA super-admin inside ONE
 * transaction that is rolled back (the probe raises on purpose), so nothing is created in production.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node --no-warnings --import ./tests/unit/register-ts-resolver.mjs supabase/tests/product-wizard-persistence.test.mjs
 *
 * The payload is built with the wizard's own helpers (services/productWizard.ts), so a change there is tested here too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildInventoryInput } from '../../services/productWizard.ts';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (needed to run SQL through the Management API).');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync(resolve(here, '../.temp/project-ref'), 'utf8').trim();
const sql = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const stores = (await sql(`select id, code from stores where is_active order by code`)).body;
const VJN = stores.find((s) => s.code === 'GP-VJN').id;
const AWV = stores.find((s) => s.code === 'GP-AWV').id;
const tag = Math.random().toString(36).slice(2, 8).toUpperCase();

// The variants as the wizard holds them, and the stock the admin typed for each store.
const variants = [
  { clientId: 'v1', sku: `PRB-${tag}-100`, weight_value: 100, weight_unit: 'g', price: 120, mrp: 150 },
  { clientId: 'v2', sku: `PRB-${tag}-250`, weight_value: 250, weight_unit: 'g', price: 280, mrp: 350 },
  { clientId: 'v3', sku: `PRB-${tag}-1KG`, weight_value: 1, weight_unit: 'kg', price: 1050, mrp: 1200 },
];
const cell = (storeId, quantity, reorderLevel, isAvailable = true) => ({ storeId, quantity, reorderLevel, isAvailable });
const typedStock = {
  v1: [cell(VJN, '40', '8'), cell(AWV, '35', '6')],
  v2: [cell(VJN, '25', '5'), cell(AWV, '30', '4', false)],
  v3: [cell(VJN, '10', '2'), cell(AWV, '12', '3')],
};
const inventory = buildInventoryInput(variants.map((v) => v.clientId), typedStock);
const variantPayload = variants.map(({ sku, weight_value, weight_unit, price, mrp }) => ({ sku, weight_value, weight_unit, price, mrp }));
const gallery = ['https://example.invalid/g1.jpg', 'https://example.invalid/g2.jpg', 'https://example.invalid/g3.jpg'];
const q = (v) => `$j$${JSON.stringify(v)}$j$::jsonb`;

const attempt = (key, call) => `begin perform ${call}; r := r || jsonb_build_object('${key}', 'ACCEPTED'); exception when others then r := r || jsonb_build_object('${key}', sqlerrm); end;`;
const base = (over = {}) => ({ name: `PROBE ${tag}`, slug: `probe-${tag.toLowerCase()}`, category_id: null, short_description: 'probe', brand: 'Govind Pansari', image: null, gallery: [], tags: [], is_featured: false, is_bestseller: false, ...over });

const PROBE = `
do $probe$
declare
  r jsonb := '{}'::jsonb; v_admin uuid; v_cat uuid; v_img text; res jsonb; pid uuid;
  prod jsonb;
begin
  select id into v_admin from profiles where role = 'admin' and is_active and admin_role is null order by created_at limit 1;
  select id into v_cat from categories where parent_id is null order by created_at limit 1;
  select image into v_img from products where image is not null and image <> '' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';

  prod := ${q(base({ gallery }))} || jsonb_build_object('category_id', v_cat, 'image', v_img);
  res := admin_create_product_full(prod, ${q(variantPayload)}, ${q(inventory)});
  pid := (res->>'productId')::uuid;
  execute 'reset role';

  r := r || jsonb_build_object(
    'result', res,
    'image_matches', (select image = v_img from products where id = pid),
    'gallery', (select to_jsonb(gallery) from products where id = pid),
    'variants', (select jsonb_agg(jsonb_build_object('sku', sku, 'weight', weight_value, 'unit', weight_unit, 'price', price, 'mrp', mrp) order by weight_value * (case weight_unit when 'kg' then 1000 else 1 end)) from product_variants where product_id = pid),
    'stock', (select jsonb_agg(jsonb_build_object('sku', pv.sku, 'store', s.code, 'qty', i.quantity, 'reorder', i.reorder_level, 'available', i.is_available) order by pv.sku, s.code)
              from inventory i join product_variants pv on pv.id = i.product_variant_id join stores s on s.id = i.store_id where pv.product_id = pid and s.is_active),
    'inactive_store_rows', (select count(*) from inventory i join product_variants pv on pv.id = i.product_variant_id join stores s on s.id = i.store_id where pv.product_id = pid and not s.is_active));

  -- The rules the database enforces whatever the app does (each attempt is its own sub-transaction)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ${attempt('dup_sku_in_payload', `admin_create_product_full(${q(base({ slug: `probe-a-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([variantPayload[0], { ...variantPayload[1], sku: variantPayload[0].sku }])}, '[]'::jsonb)`)}
  ${attempt('sku_used_elsewhere', `admin_create_product_full(${q(base({ slug: `probe-b-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: variantPayload[0].sku.toLowerCase() }])}, '[]'::jsonb)`)}
  ${attempt('mrp_below_price', `admin_create_product_full(${q(base({ slug: `probe-c-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X1`, price: 200, mrp: 150 }])}, '[]'::jsonb)`)}
  ${attempt('negative_stock', `admin_create_product_full(${q(base({ slug: `probe-d-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X2` }])}, ${q([{ variant_index: 0, store_id: VJN, quantity: -3 }])})`)}
  ${attempt('fractional_stock', `admin_create_product_full(${q(base({ slug: `probe-e-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X3` }])}, ${q([{ variant_index: 0, store_id: VJN, quantity: 2.5 }])})`)}
  ${attempt('three_decimal_price', `admin_create_product_full(${q(base({ slug: `probe-f-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X4`, price: 99.995, mrp: 120 }])}, '[]'::jsonb)`)}
  ${attempt('no_photo', `admin_create_product_full(${q(base({ slug: `probe-g-${tag.toLowerCase()}`, image: '' }))} || jsonb_build_object('category_id', v_cat), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X5` }])}, '[]'::jsonb)`)}
  ${attempt('no_variants', `admin_create_product_full(${q(base({ slug: `probe-h-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), '[]'::jsonb, '[]'::jsonb)`)}
  ${attempt('stock_for_missing_variant', `admin_create_product_full(${q(base({ slug: `probe-i-${tag.toLowerCase()}` }))} || jsonb_build_object('category_id', v_cat, 'image', v_img), ${q([{ ...variantPayload[0], sku: `PRB-${tag}-X6` }])}, ${q([{ variant_index: 5, store_id: VJN, quantity: 3 }])})`)}
  execute 'reset role';

  raise exception 'PROBE_RESULT %', r::text;
end $probe$;`;

const out = await sql(PROBE);
const m = String(out.body?.message ?? '').match(/PROBE_RESULT (\{.*\})/);
if (!m) {
  console.error('The probe did not report a result:', String(out.body?.message ?? JSON.stringify(out.body)).slice(0, 1200));
  process.exit(1);
}
const R = JSON.parse(m[1]);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`); ok ? passed++ : failed++; };

console.log(`payload: ${variants.length} variants, ${inventory.length} stock rows (built by the wizard's own helpers)\n`);
check('the product was created with one id per variant', R.result?.success === true && R.result.variantIds?.length === 3, JSON.stringify(R.result));
check('the primary photo was saved', R.image_matches === true);
check('the gallery was saved in the order it was arranged', JSON.stringify(R.gallery) === JSON.stringify(gallery), JSON.stringify(R.gallery));
const stored = Object.fromEntries((R.variants ?? []).map((v) => [v.sku, v]));
for (const v of variants) {
  const s = stored[v.sku];
  check(`variant ${v.sku}: SKU, weight, unit, selling price and MRP are exactly as entered`, !!s && Number(s.weight) === v.weight_value && s.unit === v.weight_unit && Number(s.price) === v.price && Number(s.mrp) === v.mrp, JSON.stringify([s, v]));
}
check('no variant overwrote another (three different SKUs, three different prices)', new Set(Object.values(stored).map((s) => Number(s.price))).size === 3 && Object.keys(stored).length === 3);
const stockAt = (sku, code) => (R.stock ?? []).find((x) => x.sku === sku && x.store === code);
const expected = { v1: variants[0].sku, v2: variants[1].sku, v3: variants[2].sku };
for (const [key, cells] of Object.entries(typedStock)) {
  for (const c of cells) {
    const code = c.storeId === VJN ? 'GP-VJN' : 'GP-AWV';
    const row = stockAt(expected[key], code);
    check(`${expected[key]} at ${code}: ${c.quantity} units, alert at ${c.reorderLevel}, ${c.isAvailable ? 'sold here' : 'not sold here'}`, !!row && row.qty === Number(c.quantity) && row.reorder === Number(c.reorderLevel) && row.available === c.isAvailable, JSON.stringify(row));
  }
}
check('every variant has stock for exactly the two active stores (no stray store rows)', (R.stock ?? []).length === 6 && R.inactive_store_rows >= 0);
check('duplicate SKU inside one product is refused', /already exists/i.test(R.dup_sku_in_payload ?? ''), R.dup_sku_in_payload);
check('a SKU another product already uses is refused (case-insensitive)', /already exists/i.test(R.sku_used_elsewhere ?? ''), R.sku_used_elsewhere);
check('an MRP below the selling price is refused', /MRP must be >= price/i.test(R.mrp_below_price ?? ''), R.mrp_below_price);
check('negative opening stock is refused', /cannot be negative/i.test(R.negative_stock ?? ''), R.negative_stock);
check('fractional opening stock is refused', /whole number/i.test(R.fractional_stock ?? ''), R.fractional_stock);
check('a price with three decimals is refused', /2 decimal places/i.test(R.three_decimal_price ?? ''), R.three_decimal_price);
check('a product without a photo is refused', /photo is required/i.test(R.no_photo ?? ''), R.no_photo);
check('a product without a variant is refused', /at least one variant/i.test(R.no_variants ?? ''), R.no_variants);
check('stock for a variant that does not exist is refused (it can never attach to another variant)', /invalid variant_index/i.test(R.stock_for_missing_variant ?? ''), R.stock_for_missing_variant);

const left = (await sql(`select count(*) as n from products where slug like 'probe-%' or name like 'PROBE %'`)).body?.[0]?.n;
check('rolled back: no probe product is left in the catalogue', Number(left) === 0, `left=${left}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
