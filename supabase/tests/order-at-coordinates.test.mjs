#!/usr/bin/env node
/**
 * Does an ORDER actually work at given coordinates? For each point this acts as a signed-in customer and runs what the
 * app runs: get_checkout_summary (the checkout screen) and create_order_from_cart (Place Order, cash on delivery), then
 * reads back the order, the stock reservation and the cart. Everything is inside ONE transaction that is rolled back, so no
 * real order, notification or reservation is created in production.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/order-at-coordinates.test.mjs
 *
 * It uses the real minimum order (the cart is sized above it), the live opening hours and the live qa_test_mode flag for
 * the first pass, then repeats with qa_test_mode forced off to show what customers get outside store hours.
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
const sql = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const addrCols = (await sql(`select column_name from information_schema.columns where table_schema='public' and table_name='addresses' and is_generated='NEVER' order by ordinal_position`)).body.map((r) => r.column_name);

const POINTS = [
  { name: '1 North Vijay Nagar Colony', lat: 27.203721, lng: 78.021908 },
  { name: '2 Wazirpura Rd', lat: 27.200357, lng: 78.008876 },
  { name: '3 Sanjay Palace', lat: 27.19748, lng: 78.004878 },
  { name: '4 Raja Balwant Singh crossing', lat: 27.197469, lng: 77.995645 },
  { name: 'control: Sikandra (near Awas Vikas)', lat: 27.2203, lng: 77.9514 },
  { name: 'control: Mathura (outside area)', lat: 27.4924, lng: 77.6737 },
];

const insertAddress = (lat, lng) => {
  const select = addrCols.map((c) => (c === 'id' ? 'gen_random_uuid()' : c === 'latitude' ? String(lat) : c === 'longitude' ? String(lng) : c === 'is_default' ? 'false' : `a.${c}`)).join(', ');
  return `insert into addresses (${addrCols.join(', ')}) select ${select} from addresses a where a.id = v_src_addr returning id into v_addr;`;
};
const asCustomer = `perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_cust::text, true);
    execute 'set local role authenticated';`;

const onePass = (key, i, p) => `
    -- ${p.name}
    delete from cart_items where cart_id = v_cart;
    insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var, v_qty);
    ${insertAddress(p.lat, p.lng)}
    v_vjn_res := (select reserved_quantity from inventory where store_id = v_vjn and product_variant_id = v_var);
    v_awv_res := (select reserved_quantity from inventory where store_id = v_awv and product_variant_id = v_var);
    ${asCustomer}
    v_sum := get_checkout_summary(v_addr);
    v_ord := create_order_from_cart(v_addr, 'probe-${key}-${i}-' || gen_random_uuid(), 'cod');
    execute 'reset role';
    rows := rows || jsonb_build_array(jsonb_build_object(
      'name', '${p.name}', 'pass', '${key}',
      'summary', jsonb_build_object('success', v_sum->'success', 'code', v_sum->>'code', 'message', v_sum->>'message', 'store', v_sum->>'storeName', 'subtotal', v_sum->'subtotal', 'fee', v_sum->'deliveryFee', 'total', v_sum->'total', 'meetsMinimum', v_sum->'meetsMinimumOrder'),
      'order', jsonb_build_object('success', v_ord->'success', 'code', v_ord->>'code', 'message', left(coalesce(v_ord->>'message',''), 140), 'number', v_ord->>'orderNumber', 'status', v_ord->>'status', 'total', v_ord->'total'),
      'saved', (select jsonb_build_object('store', s.code, 'status', o.status, 'payment', o.payment_status, 'method', pay.method, 'items', (select count(*) from order_items oi where oi.order_id = o.id), 'lat', o.delivery_address->>'latitude', 'lng', o.delivery_address->>'longitude', 'eta', o.estimated_delivery_minutes)
                from orders o join stores s on s.id = o.store_id left join payments pay on pay.order_id = o.id where o.id = (v_ord->>'orderId')::uuid),
      'reserved_delta_vjn', (select reserved_quantity from inventory where store_id = v_vjn and product_variant_id = v_var) - v_vjn_res,
      'reserved_delta_awv', (select reserved_quantity from inventory where store_id = v_awv and product_variant_id = v_var) - v_awv_res,
      'cart_items_after', (select count(*) from cart_items where cart_id = v_cart),
      'qty', v_qty));`;

const PROBE = `
do $probe$
declare
  rows jsonb := '[]'::jsonb; r jsonb := '{}'::jsonb;
  v_cust uuid; v_src_addr uuid; v_cart uuid; v_addr uuid; v_var uuid; v_price numeric; v_qty int;
  v_vjn uuid; v_awv uuid; v_vjn_res int; v_awv_res int; v_sum jsonb; v_ord jsonb;
begin
  select id into v_vjn from stores where code = 'GP-VJN';
  select id into v_awv from stores where code = 'GP-AWV';
  -- Two of the test pins (Raja Balwant Singh crossing, 2.75 km from Vijay Nagar; the Sikandra control, 2.23 km from Awas Vikas) lie beyond a 2 km
  -- delivery radius, so a tightened live radius would refuse them correctly — and make this test fail for a reason unrelated to what it checks
  -- (that an order is stored against the right store at the chosen coordinates). The radius is raised for this rolled-back run only.
  update app_settings set max_delivery_radius_km = greatest(max_delivery_radius_km, 3.5);
  select a.user_id, a.id into v_cust, v_src_addr from addresses a join profiles pr on pr.id = a.user_id where pr.role = 'customer' and pr.is_active order by a.created_at limit 1;
  insert into carts (user_id) values (v_cust) on conflict (user_id) do nothing;
  select id into v_cart from carts where user_id = v_cust;
  -- a real product that both stores hold plenty of; quantity sized above the REAL minimum order (zones are not touched)
  select pv.id, pv.price into v_var, v_price from product_variants pv join products pr on pr.id = pv.product_id
    where pv.is_active and pr.is_active and pv.price > 0
      and exists (select 1 from inventory i where i.store_id = v_vjn and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 100)
      and exists (select 1 from inventory i where i.store_id = v_awv and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 100)
    order by pv.price asc limit 1;
  v_qty := greatest(1, ceil(350 / v_price)::int);
  r := r || jsonb_build_object('setup', jsonb_build_object('variant_price', v_price, 'qty', v_qty, 'min_order', (select min(minimum_order_value) from delivery_zones where is_active),
    'ist_now', to_char(now() at time zone 'Asia/Kolkata', 'HH24:MI'), 'qa_test_mode', (select enabled from feature_flags where key = 'qa_test_mode')));

  -- PASS 1: the live configuration, untouched
  ${POINTS.map((p, i) => onePass('live', i, p)).join('\n')}

  -- PASS 2: as if qa_test_mode were off (what customers get outside store hours)
  update feature_flags set enabled = false where key = 'qa_test_mode';
  update stores set opening_time = ((now() at time zone 'Asia/Kolkata')::time + interval '2 hours')::time, closing_time = ((now() at time zone 'Asia/Kolkata')::time + interval '3 hours')::time where code in ('GP-VJN', 'GP-AWV');
  ${POINTS.slice(0, 1).map((p, i) => onePass('closed', i, p)).join('\n')}

  r := r || jsonb_build_object('rows', rows);
  raise exception 'PROBE_RESULT %', r::text;
end $probe$;`;

const out = await sql(PROBE);
const m = String(out.body?.message ?? '').match(/PROBE_RESULT (\{.*\})/);
if (!m) {
  console.error('The probe did not report a result:', String(out.body?.message ?? JSON.stringify(out.body)).slice(0, 1200));
  process.exit(1);
}
const R = JSON.parse(m[1]);
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`); ok ? passed++ : failed++; };

console.log(`time ${R.setup.ist_now} IST, qa_test_mode=${R.setup.qa_test_mode} (live); test cart: ${R.setup.qty} x a real ₹${R.setup.variant_price} item (above the real ₹${R.setup.min_order} minimum)\n`);
console.log('PASS 1 — live configuration');
console.log('  point                                  | checkout summary | order placed | stored on | status/payment      | total  | stock reserved at VJN / AWV | cart emptied');
const live = R.rows.filter((r) => r.pass === 'live');
const expectStore = { 0: 'GP-VJN', 1: 'GP-VJN', 2: 'GP-VJN', 3: 'GP-VJN', 4: 'GP-AWV' };
live.forEach((row, i) => {
  const ok = row.order.success === true;
  console.log(`  ${row.name.padEnd(39)}| ${String(row.summary.success ? 'OK → ' + row.summary.store.replace('Govind Pansari — ', '') : row.summary.code).padEnd(17)}| ${String(ok ? '#' + row.order.number : row.order.code).padEnd(13)}| ${String(row.saved?.store ?? '-').padEnd(10)}| ${String(row.saved ? row.saved.status + '/' + row.saved.payment + '/' + row.saved.method : '-').padEnd(20)}| ${String(row.order.total ?? '-').padEnd(7)}| +${row.reserved_delta_vjn} / +${row.reserved_delta_awv}`.padEnd(120) + `| ${row.cart_items_after === 0 ? 'yes' : 'no'}`);
});
console.log('');
live.forEach((row, i) => {
  if (i < 5) {
    const exp = expectStore[i];
    check(`${row.name}: order placed and stored against ${exp}`, row.order.success === true && row.saved?.store === exp, JSON.stringify(row.order));
    check(`${row.name}: status placed, COD payment pending, ${row.qty} units reserved ONLY at ${exp}`, row.saved?.status === 'placed' && row.saved?.method === 'cod' && (exp === 'GP-VJN' ? row.reserved_delta_vjn === row.qty && row.reserved_delta_awv === 0 : row.reserved_delta_awv === row.qty && row.reserved_delta_vjn === 0), JSON.stringify({ s: row.saved, v: row.reserved_delta_vjn, a: row.reserved_delta_awv }));
    check(`${row.name}: the delivery coordinates saved on the order are the ones chosen`, Math.abs(Number(row.saved?.lat) - [27.203721, 27.200357, 27.19748, 27.197469, 27.2203][i]) < 1e-6, JSON.stringify(row.saved));
    check(`${row.name}: cart emptied only after the order succeeded; total = items + delivery fee`, row.cart_items_after === 0 && Number(row.order.total) === Number(row.summary.total), JSON.stringify(row.summary));
  } else {
    check(`${row.name}: refused as outside the delivery area, no order, cart kept, nothing reserved`, row.order.success === false && row.order.code === 'OUTSIDE_SERVICE_AREA' && row.cart_items_after === 1 && row.reserved_delta_vjn === 0 && row.reserved_delta_awv === 0, JSON.stringify(row.order));
  }
});
console.log('\nPASS 2 — outside store hours (qa_test_mode off), point 1');
const closed = R.rows.find((r) => r.pass === 'closed');
console.log(`  ${closed.name}: summary=${closed.summary.code}; order=${closed.order.code}: ${closed.order.message}`);
check('outside hours: the order is refused with STORE_CLOSED and the opening hours — and the cart is kept', closed.order.success === false && closed.order.code === 'STORE_CLOSED' && closed.cart_items_after === 1 && /closed right now/.test(closed.order.message), JSON.stringify(closed.order));

const leftover = (await sql(`select count(*) as n from orders where idempotency_key like 'probe-%'`)).body?.[0]?.n;
check('rolled back: no probe orders left in the database', Number(leftover) === 0, `left=${leftover}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
