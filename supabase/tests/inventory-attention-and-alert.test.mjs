#!/usr/bin/env node
/**
 * Migration 20260828000002, proven against the live database INSIDE ONE TRANSACTION THAT IS ROLLED BACK (no real order, stock
 * change, notification or staff change is kept). If the migration is not live yet it is applied inside that transaction first.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/inventory-attention-and-alert.test.mjs
 *
 *   TC-29  get_admin_inventory_attention(): low-stock rows first (fewest left first), then out-of-stock; a row set to 1 unit is in
 *          the top 5; limit respected; matches the dashboard's Low Stock card; refused for a customer
 *   TC-24  an order placed at a store WITH active staff notifies that store's staff and nobody else; an order at a store with NO
 *          active staff alerts every active admin (admin_system_alert, opens the order) and the customer still gets the receipt
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

const live = (await sql(`select to_regproc('public.get_admin_inventory_attention') is not null as live`)).body?.[0]?.live === true;
const PRELUDE = live ? '' : readFileSync(resolve(here, '../migrations/20260828000002_inventory_attention_and_unstaffed_store_alert.sql'), 'utf8');

const asUser = (v) => `perform set_config('request.jwt.claims', json_build_object('sub', ${v}, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', ${v}::text, true);
    execute 'set local role authenticated';`;
const owner = `execute 'reset role';`;

const PROBE = `${PRELUDE}
do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_cust uuid; v_admin uuid; v_cart uuid; v_addr uuid; v_var uuid; v_price numeric; v_qty int;
  v_vjn uuid; v_ord1 jsonb; v_ord2 jsonb; v_o1 uuid; v_o2 uuid;
  v_attn jsonb; v_attn3 jsonb; v_row inventory%rowtype; v_dash jsonb; v_low_in_fn int; v_err text;
  v_n_admins int; v_staff_n1 int; v_adm_n1 int; v_staff_n2 int; v_adm_n2 int; v_receipt2 int; v_adm_orderid text;
begin
  select id into v_vjn from stores where code = 'GP-VJN';
  select a.user_id into v_cust from addresses a join profiles pr on pr.id = a.user_id where pr.role = 'customer' and pr.is_active order by a.created_at limit 1;
  select id into v_admin from profiles where role = 'admin' and is_active and right(phone, 10) = '9000000301' limit 1;
  if v_admin is null then select id into v_admin from profiles where role = 'admin' and is_active order by created_at limit 1; end if;

  -- ------------------------------------------------------------------ TC-29
  select * into v_row from inventory i
   where i.store_id = v_vjn and i.is_available and i.quantity - i.reserved_quantity >= 20
   order by i.id limit 1;
  update inventory set quantity = 1, reserved_quantity = 0, reorder_level = 5, is_available = true where id = v_row.id;

  ${asUser('v_admin')}
  v_attn := get_admin_inventory_attention(null, 5);
  v_attn3 := get_admin_inventory_attention(null, 3);
  v_dash := get_admin_dashboard();
  select count(*) into v_low_in_fn from jsonb_array_elements(get_admin_inventory_attention(null, 50)) e where e->>'stock_status' = 'low_stock' and (e->>'is_available')::boolean;
  ${owner}

  r := r || jsonb_build_object(
    'attention_ids', (select jsonb_agg(e->>'id') from jsonb_array_elements(v_attn) e),
    'attention_rows', (select jsonb_agg(jsonb_build_object('avail', (e->>'available_quantity')::int, 'status', e->>'stock_status')) from jsonb_array_elements(v_attn) e),
    'probe_row', v_row.id, 'attention_count3', jsonb_array_length(v_attn3),
    'dash_low', (v_dash->'inventory'->>'lowStock')::int, 'fn_low', v_low_in_fn);

  begin
    ${asUser('v_cust')}
    perform get_admin_inventory_attention(null, 5);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm; end;
  ${owner}
  r := r || jsonb_build_object('customer_attempt', v_err);

  -- ------------------------------------------------------------------ TC-24
  select pv.id, pv.price into v_var, v_price from product_variants pv join products pr on pr.id = pv.product_id
    where pv.is_active and pr.is_active and pv.price > 0
      and exists (select 1 from inventory i where i.store_id = v_vjn and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 100)
    order by pv.price asc limit 1;
  v_qty := greatest(1, ceil(350 / v_price)::int);
  insert into carts (user_id) values (v_cust) on conflict (user_id) do nothing;
  select id into v_cart from carts where user_id = v_cust;
  insert into addresses (user_id, label, recipient_name, phone, address_line_1, city, state, postal_code, latitude, longitude)
  values (v_cust, 'other', 'Alert Probe', '9000000000', 'Probe line', 'Agra', 'Uttar Pradesh', '282002', 27.203721, 78.021908) returning id into v_addr;
  select count(*) into v_n_admins from profiles where role = 'admin' and is_active;

  -- control: the store HAS active staff
  delete from cart_items where cart_id = v_cart;
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var, v_qty);
  ${asUser('v_cust')}
  v_ord1 := create_order_from_cart(v_addr, 'probe-alert-1-' || gen_random_uuid(), 'cod');
  ${owner}
  v_o1 := (v_ord1->>'orderId')::uuid;
  select count(*) into v_staff_n1 from notifications where source_id = v_o1 and event_type = 'store_new_order';
  select count(*) into v_adm_n1 from notifications where source_id = v_o1 and event_type = 'admin_system_alert';

  -- the store has NO active staff
  update store_staff set is_active = false where store_id = v_vjn;
  delete from cart_items where cart_id = v_cart;
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var, v_qty);
  ${asUser('v_cust')}
  v_ord2 := create_order_from_cart(v_addr, 'probe-alert-2-' || gen_random_uuid(), 'cod');
  ${owner}
  v_o2 := (v_ord2->>'orderId')::uuid;
  select count(*) into v_staff_n2 from notifications where source_id = v_o2 and event_type = 'store_new_order';
  select count(*) into v_adm_n2 from notifications where source_id = v_o2 and event_type = 'admin_system_alert';
  select count(*) into v_receipt2 from notifications where source_id = v_o2 and event_type = 'order_placed' and user_id = v_cust;
  select (data->>'orderId') into v_adm_orderid from notifications where source_id = v_o2 and event_type = 'admin_system_alert' limit 1;

  r := r || jsonb_build_object('orders', jsonb_build_object('o1_ok', v_ord1->'success', 'o2_ok', v_ord2->'success', 'o1_msg', left(coalesce(v_ord1->>'message', ''), 120), 'o2_msg', left(coalesce(v_ord2->>'message', ''), 120)),
    'with_staff', jsonb_build_object('store_notified', v_staff_n1, 'admins_alerted', v_adm_n1),
    'without_staff', jsonb_build_object('store_notified', v_staff_n2, 'admins_alerted', v_adm_n2, 'active_admins', v_n_admins, 'customer_receipt', v_receipt2, 'alert_opens_order', v_adm_orderid = v_o2::text));

  raise exception 'PROBE_RESULT %', r::text;
end $probe$;`;

const out = await sql(PROBE);
const m = String(out.body?.message ?? '').match(/PROBE_RESULT (\{.*\})/s);
if (!m) {
  console.error('The probe did not report a result:', String(out.body?.message ?? JSON.stringify(out.body)).slice(0, 1500));
  process.exit(1);
}
const R = JSON.parse(m[1]);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};
console.log(`migration was ${live ? 'already live' : 'applied inside the rolled-back test transaction only'}\n`);

const rows = R.attention_rows ?? [];
const firstOut = rows.findIndex((x) => x.status === 'out_of_stock');
const lowBeforeOut = firstOut === -1 || rows.slice(firstOut).every((x) => x.status === 'out_of_stock');
check('TC-29: low-stock rows come before out-of-stock rows', lowBeforeOut, JSON.stringify(rows));
const lows = rows.filter((x) => x.status === 'low_stock').map((x) => x.avail);
check('TC-29: within low stock, the fewest units left come first', lows.every((v, i) => i === 0 || lows[i - 1] <= v), JSON.stringify(lows));
check('TC-29: a product set to 1 unit is in the top 5 (the dashboard list)', (R.attention_ids ?? []).includes(R.probe_row), JSON.stringify(R.attention_ids));
check('TC-29: the first row is the one with the fewest units left (1)', rows[0]?.avail === 1 && rows[0]?.status === 'low_stock', JSON.stringify(rows[0]));
check('TC-29: the limit is respected', R.attention_count3 === 3 && rows.length === 5, `${R.attention_count3} / ${rows.length}`);
check('TC-29: the list agrees with the dashboard Low Stock card', R.fn_low === R.dash_low, `list ${R.fn_low} vs card ${R.dash_low}`);
check('TC-29: a customer cannot call it', /not authorized/.test(R.customer_attempt ?? ''), R.customer_attempt);

check('TC-24: both test orders were placed', R.orders?.o1_ok === true && R.orders?.o2_ok === true, JSON.stringify(R.orders));
check('TC-24 control: with active store staff, the store is notified and the admins are NOT alerted', R.with_staff?.store_notified >= 1 && R.with_staff?.admins_alerted === 0, JSON.stringify(R.with_staff));
const w = R.without_staff ?? {};
check('TC-24: with no active store staff, no store notification is created', w.store_notified === 0, JSON.stringify(w));
check('TC-24: ... every active admin is alerted instead', w.admins_alerted === w.active_admins && w.admins_alerted > 0, JSON.stringify(w));
check('TC-24: ... the alert opens that order', w.alert_opens_order === true);
check('TC-24: ... and the customer still gets their order receipt', w.customer_receipt === 1, JSON.stringify(w));

console.log(`\n${passed} passed, ${failed} failed (everything was rolled back)`);
process.exit(failed === 0 ? 0 : 1);
