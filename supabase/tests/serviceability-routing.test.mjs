#!/usr/bin/env node
/**
 * Location serviceability and nearest-store routing, against the live database, acting as a signed-in customer.
 * Everything runs inside ONE transaction that is rolled back (the probe raises on purpose), so nothing is written.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/serviceability-routing.test.mjs
 *
 * If migration 20260827000018 is not live yet, the suite applies it INSIDE the same rolled-back transaction, so the
 * fix can be proven without deploying it. Expected distances are computed here with an independent haversine
 * formula, not taken from the database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (needed to run SQL through the Management API).');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync(resolve(here, '../.temp/project-ref'), 'utf8').trim();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---- facts read from the live database (store records), then everything else is computed here ----
const stores = (await sql(`select code, id, name, latitude as lat, longitude as lng, is_active, is_accepting_orders, opening_time, closing_time from stores order by code`)).body;
const VJN = stores.find((s) => s.code === 'GP-VJN');
const AWV = stores.find((s) => s.code === 'GP-AWV');
const SNP = stores.find((s) => s.code === 'GP-SNP');
const migrationLive = (await sql(`select to_regproc('public.store_service_candidates') is not null as live`)).body?.[0]?.live === true;
const PRELUDE = migrationLive ? '' : readFileSync(resolve(here, '../migrations/20260827000018_single_serviceability_authority.sql'), 'utf8');
const addrCols = (await sql(`select column_name from information_schema.columns where table_schema='public' and table_name='addresses' and is_generated='NEVER' order by ordinal_position`)).body.map((r) => r.column_name);

const rad = (d) => (d * Math.PI) / 180;
const haversine = (a, b) => {
  const R = 6371008.8;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// The four coordinates from the tester's screenshots, and extra fixtures.
const SCREENSHOTS = [
  { name: 'North Vijay Nagar Colony (screenshot 1)', lat: 27.203721, lng: 78.021908 },
  { name: 'Wazirpura Rd, Sanjay Place (screenshot 2)', lat: 27.200357, lng: 78.008876 },
  { name: 'Sanjay Palace building (screenshot 3)', lat: 27.19748, lng: 78.004878 },
  { name: 'Raja Balwant Singh crossing (screenshot 4)', lat: 27.197469, lng: 77.995645 },
];
const NEAR_AWV = { name: 'Sikandra (near Awas Vikas)', lat: 27.2203, lng: 77.9514 };
const FAR = [
  { name: 'Mathura', lat: 27.4924, lng: 77.6737 },
  { name: 'Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Fatehpur Sikri', lat: 27.094, lng: 77.6679 },
];
const pointRows = (pts) => pts.map((p) => `('${p.name.replace(/'/g, "''")}', ${p.lat}, ${p.lng})`).join(',');

// -- SQL building blocks ------------------------------------------------------------------------
const asCustomer = `perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_cust::text, true);
  execute 'set local role authenticated';`;
const asOwner = `execute 'reset role';`;
const record = (key, expr) => `r := r || jsonb_build_object('${key}', ${expr});`;
const tryRecord = (key, stmt) => `begin ${stmt} exception when others then r := r || jsonb_build_object('${key}', jsonb_build_object('error', left(sqlerrm, 160))); end;`;
// Create an address for the test customer at a point (a copy of one of their own addresses; generated columns excluded).
const insertAddress = (varName, lat, lng) => {
  const select = addrCols.map((c) => (c === 'id' ? 'gen_random_uuid()' : c === 'latitude' ? String(lat) : c === 'longitude' ? String(lng) : c === 'is_default' ? 'false' : `a.${c}`)).join(', ');
  return `insert into addresses (${addrCols.join(', ')}) select ${select} from addresses a where a.id = v_src_addr returning id into ${varName};`;
};
// Call resolve_checkout as the customer for a new address at a point and keep a compact result.
const resolveAt = (key, lat, lng) => `${insertAddress('v_addr', lat, lng)}
  ${asCustomer}
  v_res := resolve_checkout(v_addr);
  ${asOwner}
  ${record(key, `jsonb_build_object('success', v_res->'success', 'code', v_res->>'code', 'storeId', v_res->>'storeName', 'message', v_res->>'message', 'unavailable', v_res->'unavailableItems')`)}`;
const checkAt = (key, lat, lng) => `${asCustomer}
  v_res := check_serviceability(${lat}, ${lng});
  ${asOwner}
  ${record(key, 'v_res')}`;
const setStock = (storeCode, variantVar, qty) => `update inventory set quantity = ${qty}, reserved_quantity = 0, is_available = true where store_id = (select id from stores where code = '${storeCode}') and product_variant_id = ${variantVar};`;

const PROBE = `
${PRELUDE}
do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_res jsonb;
  v_cust uuid; v_src_addr uuid; v_cart uuid; v_addr uuid; v_var1 uuid; v_var2 uuid;
  v_vjn stores%rowtype; v_awv stores%rowtype; v_radius float8;
  v_lat float8; v_lng float8; v_d float8; v_i int;
  p record; rows jsonb;
  v_order jsonb; v_order2 jsonb; v_upd int; v_key text := 'probe-' || gen_random_uuid();
begin
  select * into v_vjn from stores where code = 'GP-VJN';
  select * into v_awv from stores where code = 'GP-AWV';
  -- This test is written around the original 10 km radius (Sikandra 2.2 km and the 7 km / 11 km points must be served). The live setting is an
  -- admin's to change — it is 2 km today — so the radius is pinned here, inside this rolled-back run only, and production is not touched.
  update app_settings set max_delivery_radius_km = 10 where id;
  v_radius := coalesce((select max_delivery_radius_km from app_settings where id), 10) * 1000;
  select a.user_id, a.id into v_cust, v_src_addr from addresses a join profiles pr on pr.id = a.user_id where pr.role = 'customer' and pr.is_active order by a.created_at limit 1;
  insert into carts (user_id) values (v_cust) on conflict (user_id) do nothing;
  select id into v_cart from carts where user_id = v_cust;
  delete from cart_items where cart_id = v_cart;
  -- two variants that both stores can fulfil in quantity
  select pv.id into v_var1 from product_variants pv join products pr on pr.id = pv.product_id
    where pv.is_active and pr.is_active
      and exists (select 1 from inventory i where i.store_id = v_vjn.id and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 5)
      and exists (select 1 from inventory i where i.store_id = v_awv.id and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 5)
    order by pv.id limit 1;
  select pv.id into v_var2 from product_variants pv join products pr on pr.id = pv.product_id
    where pv.is_active and pr.is_active and pv.id <> v_var1
      and exists (select 1 from inventory i where i.store_id = v_vjn.id and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 5)
      and exists (select 1 from inventory i where i.store_id = v_awv.id and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 5)
    order by pv.id limit 1;
  rows := '[]'::jsonb;
  r := r || jsonb_build_object('setup', jsonb_build_object('customer', v_cust is not null, 'variants', v_var1 is not null and v_var2 is not null, 'radius_m', v_radius, 'migration_live_before', ${migrationLive}));

  -- ===== A. What the customer is told TODAY (live flag as configured) =====
  update feature_flags set enabled = enabled where key = 'qa_test_mode';
  r := r || jsonb_build_object('live_qa_flag', (select enabled from feature_flags where key = 'qa_test_mode'));

  -- Distance tests do not depend on the clock: hours are switched off for sections B-E.
  update feature_flags set enabled = true where key = 'qa_test_mode';

  -- ===== B. The screenshot coordinates, store locations and extra fixtures, as the customer =====
  ${asCustomer}
  for p in select * from (values ${pointRows([...SCREENSHOTS, { name: 'AT Vijay Nagar store', lat: VJN.lat, lng: VJN.lng }, { name: 'AT Awas Vikas store', lat: AWV.lat, lng: AWV.lng }, NEAR_AWV, { name: 'AT Sanjay Place (inactive store)', lat: SNP.lat, lng: SNP.lng }, ...FAR])}) t(name, la, lo) loop
    rows := rows || jsonb_build_array(jsonb_build_object('name', p.name, 'lat', p.la, 'lng', p.lo, 'result', check_serviceability(p.la, p.lo),
      'eligible_via_find', (select coalesce(jsonb_agg(f.store_name order by f.distance_meters), '[]'::jsonb) from find_serviceable_stores(p.la, p.lo) f)));
  end loop;
  ${asOwner}
  r := r || jsonb_build_object('points', rows);

  -- ===== C. Radius boundary around the Vijay Nagar store, due east (Awas Vikas is west of it, so it never interferes) =====
  rows := '[]'::jsonb;
  for v_i in 0..4 loop
    v_d := case v_i when 0 then v_radius - 50 when 1 then v_radius - 1 when 2 then v_radius when 3 then v_radius + 1 else v_radius + 50 end;
    v_lat := ST_Y(ST_Project(v_vjn.geog, v_d, radians(90))::geometry);
    v_lng := ST_X(ST_Project(v_vjn.geog, v_d, radians(90))::geometry);
    -- the distance as the database itself measures it for exactly these coordinates
    select ST_Distance(v_vjn.geog, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography) into v_d;
    ${asCustomer}
    v_res := check_serviceability(v_lat, v_lng);
    ${asOwner}
    rows := rows || jsonb_build_array(jsonb_build_object('label', case v_i when 0 then 'radius - 50 m' when 1 then 'radius - 1 m' when 2 then 'exactly at the radius' when 3 then 'radius + 1 m' else 'radius + 50 m' end,
      'lat', v_lat, 'lng', v_lng, 'measured_m', v_d, 'serviceable', v_res->'serviceable', 'reason', v_res->>'reason', 'nearest_m', v_res->'nearestStore'->'distanceMeters'));
  end loop;
  r := r || jsonb_build_object('boundary', rows);

  -- configurable radius: the same point 7 km east of Vijay Nagar
  v_lat := ST_Y(ST_Project(v_vjn.geog, 7000, radians(90))::geometry); v_lng := ST_X(ST_Project(v_vjn.geog, 7000, radians(90))::geometry);
  ${checkAt('radius10_at7km', 'v_lat', 'v_lng')}
  update app_settings set max_delivery_radius_km = 5 where id;
  ${checkAt('radius5_at7km', 'v_lat', 'v_lng')}
  update app_settings set max_delivery_radius_km = 12 where id;
  v_lat := ST_Y(ST_Project(v_vjn.geog, 11000, radians(90))::geometry); v_lng := ST_X(ST_Project(v_vjn.geog, 11000, radians(90))::geometry);
  ${checkAt('radius12_at11km', 'v_lat', 'v_lng')}
  update app_settings set max_delivery_radius_km = 10 where id;

  -- ===== D. Bad coordinates =====
  ${asCustomer}
  r := r || jsonb_build_object('invalid', jsonb_build_object(
    'null_lat', check_serviceability(null, 78.0)->>'reason', 'null_lng', check_serviceability(27.2, null)->>'reason',
    'nan', check_serviceability('NaN'::float8, 78.0)->>'reason', 'infinity', check_serviceability('Infinity'::float8, 78.0)->>'reason',
    'lat_91', check_serviceability(91, 78)->>'reason', 'lng_181', check_serviceability(27.2, 181)->>'reason',
    'swapped_lat_lng', check_serviceability(78.021908, 27.203721)->>'reason'));
  ${asOwner}

  -- ===== E. Stores unavailable =====
  update stores set is_accepting_orders = false where code = 'GP-VJN';
  ${checkAt('vjn_paused_near_vjn', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update stores set is_accepting_orders = false where code = 'GP-AWV';
  ${checkAt('both_paused', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update stores set is_accepting_orders = true;
  update stores set is_active = false where code in ('GP-VJN', 'GP-AWV');
  ${checkAt('both_inactive', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update stores set is_active = true where code in ('GP-VJN', 'GP-AWV');
  -- Sanjay Place: only the store is inactive (its zone is left alone). Customers there go to the nearest ACTIVE store.
  r := r || jsonb_build_object('snp_store_active', (select is_active from stores where code = 'GP-SNP'), 'snp_zone_active', (select is_active from delivery_zones where name ilike '%Sanjay Place%' limit 1));
  ${checkAt('snp_area_customer', SNP.lat, SNP.lng)}
  update stores set is_accepting_orders = false where code = 'GP-VJN';
  ${checkAt('snp_area_customer_vjn_paused', SNP.lat, SNP.lng)}
  update stores set is_accepting_orders = true where code = 'GP-VJN';

  -- ===== F. Opening hours: the exact situation behind the bug =====
  update feature_flags set enabled = false where key = 'qa_test_mode';
  update stores set opening_time = ((now() at time zone 'Asia/Kolkata')::time + interval '2 hours')::time,
                    closing_time = ((now() at time zone 'Asia/Kolkata')::time + interval '3 hours')::time where code in ('GP-VJN', 'GP-AWV');
  ${checkAt('closed_hours_flag_off', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update feature_flags set enabled = true where key = 'qa_test_mode';
  ${checkAt('closed_hours_flag_on', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update feature_flags set enabled = false where key = 'qa_test_mode';
  update stores set opening_time = ((now() at time zone 'Asia/Kolkata')::time - interval '2 hours')::time,
                    closing_time = ((now() at time zone 'Asia/Kolkata')::time + interval '2 hours')::time where code in ('GP-VJN', 'GP-AWV');
  ${checkAt('open_hours_flag_off', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update feature_flags set enabled = true where key = 'qa_test_mode';
  update stores set opening_time = '09:00', closing_time = '21:00' where code in ('GP-VJN', 'GP-AWV');

  -- ===== G. Stock-aware routing through resolve_checkout (nearest store that can fulfil the WHOLE cart) =====
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var1, 1);
  ${setStock('GP-VJN', 'v_var1', 50)} ${setStock('GP-AWV', 'v_var1', 50)}
  ${resolveAt('g1_near_vjn_both_stocked', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  ${resolveAt('g1b_screenshot4_both_stocked', SCREENSHOTS[3].lat, SCREENSHOTS[3].lng)}
  ${resolveAt('g1c_near_awv_both_stocked', NEAR_AWV.lat, NEAR_AWV.lng)}
  ${setStock('GP-VJN', 'v_var1', 0)}
  ${resolveAt('g2_near_vjn_vjn_out_of_stock', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  ${setStock('GP-AWV', 'v_var1', 0)}
  ${resolveAt('g3_both_out_of_stock', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  ${setStock('GP-VJN', 'v_var1', 50)}
  ${resolveAt('g4_near_awv_awv_out_of_stock', NEAR_AWV.lat, NEAR_AWV.lng)}
  ${setStock('GP-AWV', 'v_var1', 50)}
  -- two items: Awas Vikas lacks the first, Vijay Nagar has both -> only Vijay Nagar can fulfil, though it is farther
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var2, 1);
  ${setStock('GP-AWV', 'v_var1', 0)} ${setStock('GP-VJN', 'v_var2', 50)} ${setStock('GP-AWV', 'v_var2', 50)} ${setStock('GP-VJN', 'v_var1', 50)}
  ${resolveAt('g5_near_awv_only_vjn_has_all', NEAR_AWV.lat, NEAR_AWV.lng)}
  -- split stock: each store lacks a different item -> nobody can fulfil, nothing is split
  ${setStock('GP-VJN', 'v_var2', 0)}
  ${resolveAt('g6_split_stock_nobody_has_all', NEAR_AWV.lat, NEAR_AWV.lng)}
  ${setStock('GP-VJN', 'v_var2', 50)} ${setStock('GP-AWV', 'v_var1', 50)}
  delete from cart_items where cart_id = v_cart and product_variant_id = v_var2;
  ${resolveAt('g7_outside_area_mathura', FAR[0].lat, FAR[0].lng)}
  update feature_flags set enabled = false where key = 'qa_test_mode';
  update stores set opening_time = ((now() at time zone 'Asia/Kolkata')::time + interval '2 hours')::time, closing_time = ((now() at time zone 'Asia/Kolkata')::time + interval '3 hours')::time where code in ('GP-VJN', 'GP-AWV');
  ${resolveAt('g8_closed_checkout', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  update feature_flags set enabled = true where key = 'qa_test_mode';
  update stores set opening_time = '09:00', closing_time = '21:00' where code in ('GP-VJN', 'GP-AWV');

  -- ===== H. The store is fixed on the order; a retry or a later address change cannot reroute it =====
  update delivery_zones set minimum_order_value = 0;   -- the scratch cart is below the real minimum order
  ${insertAddress('v_addr', SCREENSHOTS[0].lat, SCREENSHOTS[0].lng)}
  ${asCustomer}
  ${tryRecord('h_order', "v_order := create_order_from_cart(v_addr, v_key, 'cod'); r := r || jsonb_build_object('h_order', jsonb_build_object('success', v_order->'success', 'code', v_order->>'code', 'message', left(coalesce(v_order->>'message', ''), 120), 'store', (select s.code from orders o join stores s on s.id = o.store_id where o.id = (v_order->>'orderId')::uuid)));")}
  ${asOwner}
  if (v_order->>'orderId') is not null then
    ${asCustomer}
    update orders set store_id = v_awv.id where id = (v_order->>'orderId')::uuid;
    get diagnostics v_upd = row_count;
    ${asOwner}
    r := r || jsonb_build_object('h_customer_update_rows', v_upd);
    -- the customer's pin now moves next to Awas Vikas, and the same checkout is retried
    update addresses set latitude = ${NEAR_AWV.lat}, longitude = ${NEAR_AWV.lng} where id = v_addr;
    ${asCustomer}
    v_order2 := create_order_from_cart(v_addr, v_key, 'cod');
    ${asOwner}
    r := r || jsonb_build_object('h_retry', jsonb_build_object('same_order', v_order2->>'orderId' = v_order->>'orderId', 'idempotent', v_order2->'idempotent',
      'store', (select s.code from orders o join stores s on s.id = o.store_id where o.id = (v_order->>'orderId')::uuid)));
  end if;

  -- ===== I. A customer cannot call the internal function =====
  ${asCustomer}
  ${tryRecord('i_internal_fn', "perform store_service_candidates(27.2, 78.0); r := r || jsonb_build_object('i_internal_fn', 'ALLOWED');")}
  ${asOwner}

  raise exception 'PROBE_RESULT %', r::text;
end $probe$;
`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};

const out = await sql(PROBE);
const message = String(out.body?.message ?? '');
const match = message.match(/PROBE_RESULT (\{.*\})/);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 1200));
  process.exit(1);
}
const R = JSON.parse(match[1]);
const radiusM = R.setup.radius_m;
console.log(`stores: Vijay Nagar ${VJN.lat},${VJN.lng} (${VJN.id}) | Awas Vikas ${AWV.lat},${AWV.lng} (${AWV.id}) | Sanjay Place active=${SNP.is_active}`);
console.log(`delivery radius ${radiusM / 1000} km; migration was ${R.setup.migration_live_before ? 'already live' : 'applied inside the rolled-back test transaction only'}; live qa_test_mode flag = ${R.live_qa_flag}\n`);

// ---- B. the four screenshot coordinates -------------------------------------------------------
console.log('Screenshot coordinates (customer view, hours off for this section):');
console.log('  point                                         | dist VJN  | dist AWV  | in radius V/A | expected nearest | backend nearest (m)         | stock-aware checkout   | match');
const byName = Object.fromEntries(R.points.map((p) => [p.name, p]));
const resolveKeys = ['g1_near_vjn_both_stocked', null, null, 'g1b_screenshot4_both_stocked'];
for (let i = 0; i < SCREENSHOTS.length; i++) {
  const s = SCREENSHOTS[i];
  const dv = haversine(s, VJN), da = haversine(s, AWV);
  const inV = dv <= radiusM, inA = da <= radiusM;
  const expected = [inV && { code: 'VJN', d: dv }, inA && { code: 'AWV', d: da }].filter(Boolean).sort((a, b) => a.d - b.d)[0]?.code ?? 'none';
  const got = byName[s.name];
  const actualStore = got.result.serviceable ? got.result.nearestStore.storeName.replace('Govind Pansari — ', '') : 'none';
  const actual = { 'Vijay Nagar': 'VJN', 'Awas Vikas': 'AWV', none: 'none' }[actualStore];
  const dbDist = got.result.serviceable ? got.result.nearestStore.distanceMeters : null;
  const stock = R[resolveKeys[i] ?? '']?.storeId?.replace('Govind Pansari — ', '') ?? (i === 1 || i === 2 ? '(see g-tests)' : '-');
  const ok = actual === expected && (dbDist == null || Math.abs(dbDist - (expected === 'VJN' ? dv : da)) <= Math.max(25, 0.005 * (expected === 'VJN' ? dv : da)));
  console.log(`  ${s.name.padEnd(46)}| ${(Math.round(dv) + ' m').padEnd(10)}| ${(Math.round(da) + ' m').padEnd(10)}| ${String(inV).padEnd(5)}/ ${String(inA).padEnd(6)}| ${expected.padEnd(17)}| ${(actual + ' (' + dbDist + ')').padEnd(28)}| ${String(stock).padEnd(22)} | ${ok ? 'yes' : 'NO'}`);
  check(`${s.name}: backend nearest eligible store = ${expected}, distance agrees with an independent haversine`, ok, `${actual} ${dbDist} vs ${expected} ${Math.round(expected === 'VJN' ? dv : da)}`);
  check(`${s.name}: is serviceable (inside ${radiusM / 1000} km of a store)`, got.result.serviceable === (inV || inA), JSON.stringify(got.result));
  check(`${s.name}: eligible list from find_serviceable_stores matches check_serviceability`, JSON.stringify(got.eligible_via_find) === JSON.stringify((got.result.eligibleStores ?? []).map((e) => e.storeName)));
}
console.log('');

// ---- stores themselves, Sanjay Place, far places -----------------------------------------------
for (const [label, store, code] of [['AT Vijay Nagar store', VJN, 'Vijay Nagar'], ['AT Awas Vikas store', AWV, 'Awas Vikas']]) {
  const g = byName[label].result;
  check(`${label}: routed to that store at ~0 m`, g.serviceable && g.nearestStore.storeName.includes(code) && g.nearestStore.distanceMeters < 5, JSON.stringify(g.nearestStore));
}
const sikandra = byName[NEAR_AWV.name].result;
check('Sikandra (2.2 km from Awas Vikas, 7.3 km from Vijay Nagar): nearest is Awas Vikas, Vijay Nagar also listed second', sikandra.eligibleStores?.[0]?.storeName.includes('Awas Vikas') && sikandra.eligibleStores?.[1]?.storeName.includes('Vijay Nagar'), JSON.stringify(sikandra.eligibleStores));
const snp = byName['AT Sanjay Place (inactive store)'].result;
check('standing at the (inactive) Sanjay Place store: served by Vijay Nagar, never Sanjay Place', snp.serviceable && snp.nearestStore.storeName.includes('Vijay Nagar') && !JSON.stringify(snp).includes('Sanjay Place'), JSON.stringify(snp.nearestStore));
for (const f of FAR) {
  const g = byName[f.name].result;
  check(`${f.name}: rejected as outside the delivery area, with the nearest store's distance`, g.serviceable === false && g.reason === 'OUTSIDE_SERVICE_AREA' && g.nearestStore?.distanceMeters > radiusM, JSON.stringify(g));
}

// ---- C. boundary + configurable radius ---------------------------------------------------------
console.log('\nBoundary (due east of Vijay Nagar):');
for (const b of R.boundary) console.log(`  ${b.label.padEnd(24)} measured ${String(b.measured_m).padEnd(20)} m -> serviceable=${b.serviceable}${b.reason ? ' (' + b.reason + ')' : ''}`);
const [b50in, b1in, bAt, b1out, b50out] = R.boundary;
check('50 m and 1 m inside the radius: serviceable', b50in.serviceable === true && b1in.serviceable === true);
check('exactly at the radius: serviceable exactly when the measured distance is <= the radius (inclusive)', bAt.serviceable === (bAt.measured_m <= radiusM), `measured ${bAt.measured_m} vs ${radiusM} -> ${bAt.serviceable}`);
check('1 m and 50 m outside the radius: rejected as outside the delivery area', b1out.serviceable === false && b1out.reason === 'OUTSIDE_SERVICE_AREA' && b50out.serviceable === false);
check('the radius is configurable: 7 km east is served at 10 km, refused at 5 km, and 11 km is served at 12 km', R.radius10_at7km.serviceable === true && R.radius5_at7km.serviceable === false && R.radius5_at7km.maxRadiusKm === 5 && R.radius12_at11km.serviceable === true, JSON.stringify({ at7km_r10: R.radius10_at7km, at7km_r5: R.radius5_at7km, at11km_r12: R.radius12_at11km }));

// ---- D. invalid input --------------------------------------------------------------------------
const { swapped_lat_lng: swapped, ...invalidInputs } = R.invalid;
check('missing / NaN / infinite / out-of-range coordinates are INVALID_COORDINATES, not "outside the area"',
  Object.values(invalidInputs).every((v) => v === 'INVALID_COORDINATES'), JSON.stringify(invalidInputs));
// lat/lng swapped is still a valid point on Earth (the Arctic), so the server rejects it as outside the area; the order of the two
// values is guarded where they are produced (the map picker / GPS / address screens) and by tests/unit/serviceability.test.mjs.
check('latitude and longitude swapped (a valid point near the Arctic) is never serviceable', swapped === 'OUTSIDE_SERVICE_AREA', String(swapped));

// ---- E. stores unavailable ---------------------------------------------------------------------
check('a closer store that is paused is skipped: the Vijay Nagar pin is served by Awas Vikas', R.vjn_paused_near_vjn.serviceable === true && R.vjn_paused_near_vjn.nearestStore.storeName.includes('Awas Vikas'), JSON.stringify(R.vjn_paused_near_vjn.nearestStore));
check('both stores paused: "not accepting orders", not "outside the area"', R.both_paused.serviceable === false && R.both_paused.reason === 'STORES_NOT_ACCEPTING_ORDERS', JSON.stringify(R.both_paused));
check('both stores inactive: NO_ACTIVE_STORES', R.both_inactive.serviceable === false && R.both_inactive.reason === 'NO_ACTIVE_STORES', JSON.stringify(R.both_inactive));
check('Sanjay Place: only the store is inactive (its zone is left active)', R.snp_store_active === false && R.snp_zone_active === true, JSON.stringify([R.snp_store_active, R.snp_zone_active]));
check('a customer in the Sanjay Place area is served by the nearest ACTIVE store (Vijay Nagar), never Sanjay Place', R.snp_area_customer.serviceable === true && R.snp_area_customer.nearestStore.storeName.includes('Vijay Nagar') && !JSON.stringify(R.snp_area_customer).includes('Sanjay Place'), JSON.stringify(R.snp_area_customer.nearestStore));
check('...and by Awas Vikas when Vijay Nagar is paused', R.snp_area_customer_vjn_paused.serviceable === true && R.snp_area_customer_vjn_paused.nearestStore.storeName.includes('Awas Vikas'), JSON.stringify(R.snp_area_customer_vjn_paused.nearestStore));

// ---- F. opening hours --------------------------------------------------------------------------
check('outside opening hours (flag off): STORE_CLOSED with opening hours — NOT "outside the delivery area"', R.closed_hours_flag_off.serviceable === false && R.closed_hours_flag_off.reason === 'STORE_CLOSED' && !!R.closed_hours_flag_off.opensAt, JSON.stringify(R.closed_hours_flag_off));
check('qa_test_mode on: hours ignored, same coordinates serviceable (the customer sees the same as checkout)', R.closed_hours_flag_on.serviceable === true);
check('inside opening hours (flag off): serviceable', R.open_hours_flag_off.serviceable === true);

// ---- G. stock-aware routing --------------------------------------------------------------------
const vname = 'Govind Pansari — ';
check('both stocked, customer near Vijay Nagar: routed to Vijay Nagar', R.g1_near_vjn_both_stocked.success === true && R.g1_near_vjn_both_stocked.storeId === `${vname}Vijay Nagar`, JSON.stringify(R.g1_near_vjn_both_stocked));
check('both stocked, screenshot 4 crossing: routed to the nearer store (Vijay Nagar, ~2.7 km vs ~3.1 km)', R.g1b_screenshot4_both_stocked.storeId === `${vname}${haversine(SCREENSHOTS[3], VJN) <= haversine(SCREENSHOTS[3], AWV) ? 'Vijay Nagar' : 'Awas Vikas'}`, JSON.stringify(R.g1b_screenshot4_both_stocked));
check('both stocked, customer near Awas Vikas: routed to Awas Vikas', R.g1c_near_awv_both_stocked.storeId === `${vname}Awas Vikas`, JSON.stringify(R.g1c_near_awv_both_stocked));
check('nearest store (Vijay Nagar) out of stock, farther store in range has it: Awas Vikas is chosen', R.g2_near_vjn_vjn_out_of_stock.storeId === `${vname}Awas Vikas`, JSON.stringify(R.g2_near_vjn_vjn_out_of_stock));
check('both stores out of stock: genuine CART_NOT_FULFILLABLE naming the item', R.g3_both_out_of_stock.code === 'CART_NOT_FULFILLABLE' && (R.g3_both_out_of_stock.unavailable ?? []).length === 1, JSON.stringify(R.g3_both_out_of_stock));
check('customer near Awas Vikas, Awas Vikas out of stock: Vijay Nagar (7.3 km, in range) is chosen', R.g4_near_awv_awv_out_of_stock.storeId === `${vname}Vijay Nagar`, JSON.stringify(R.g4_near_awv_awv_out_of_stock));
check('both in range but only Vijay Nagar holds the whole cart: Vijay Nagar, even though Awas Vikas is nearer', R.g5_near_awv_only_vjn_has_all.storeId === `${vname}Vijay Nagar`, JSON.stringify(R.g5_near_awv_only_vjn_has_all));
check('each store lacks a different item: no store, and the order is not split', R.g6_split_stock_nobody_has_all.code === 'CART_NOT_FULFILLABLE', JSON.stringify(R.g6_split_stock_nobody_has_all));
check('checkout outside the area (Mathura): OUTSIDE_SERVICE_AREA with a message naming the radius', R.g7_outside_area_mathura.code === 'OUTSIDE_SERVICE_AREA' && /10 km/.test(R.g7_outside_area_mathura.message ?? ''), JSON.stringify(R.g7_outside_area_mathura));
check('checkout while closed: STORE_CLOSED with the opening hours — same reason the address screen gives', R.g8_closed_checkout.code === 'STORE_CLOSED' && /closed right now/.test(R.g8_closed_checkout.message ?? ''), JSON.stringify(R.g8_closed_checkout));

// ---- H. order fixed to its store ---------------------------------------------------------------
check('an order is created and stored against the routed store (Vijay Nagar)', R.h_order?.success === true && R.h_order?.store === 'GP-VJN', JSON.stringify(R.h_order));
check('a customer cannot change an order\'s store (update affects 0 rows)', R.h_customer_update_rows === 0, String(R.h_customer_update_rows));
check('retrying the same checkout after the address moved next to Awas Vikas returns the SAME order, still on Vijay Nagar', R.h_retry?.same_order === true && R.h_retry?.store === 'GP-VJN', JSON.stringify(R.h_retry));

// ---- I. permissions + configuration ------------------------------------------------------------
check('the internal candidates function is not callable by app users', /permission denied/i.test(R.i_internal_fn?.error ?? ''), JSON.stringify(R.i_internal_fn));

const orders = (await sql(`select count(*) as n from orders where idempotency_key like 'probe-%'`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind (no probe orders)', Number(orders) === 0, `probe orders=${orders}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
