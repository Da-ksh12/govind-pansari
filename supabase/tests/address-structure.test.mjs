#!/usr/bin/env node
/**
 * Migration 20260828000001 (structured addresses + places_lookup rate limit), proven against the live database
 * INSIDE ONE TRANSACTION THAT IS ROLLED BACK — no real address, order, notification or stock reservation is kept.
 * If the migration is not live yet the suite applies it inside that same transaction first.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/address-structure.test.mjs
 *
 * What it proves:
 *   * the new address columns exist, are nullable, and their constraints refuse bad data
 *   * a signed-in customer can save every structured field and read it back exactly; another customer cannot read it
 *   * the order's address snapshot carries the new fields (house number, instructions, place id …) AND still carries the
 *     old ones; an old-style address with no structured fields still checks out
 *   * an admin reads the new fields through get_admin_order_detail
 *   * enforce_rate_limit('places_lookup'): 60 in a burst, the 61st refused; other actions and the "unknown action"
 *     guard are unchanged; an unauthenticated caller is refused
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

const live = (await sql(`select exists (select 1 from information_schema.columns where table_schema='public' and table_name='addresses' and column_name='house_no') as live`)).body?.[0]?.live === true;
const PRELUDE = live ? '' : readFileSync(resolve(here, '../migrations/20260828000001_address_structure_and_lookup_limits.sql'), 'utf8');

const asRole = (uuidVar) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uuidVar}, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', ${uuidVar}::text, true);
    execute 'set local role authenticated';`;
const backToOwner = `execute 'reset role';`;

const PROBE = `${PRELUDE}
do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_cust uuid; v_other uuid; v_admin uuid; v_cart uuid; v_src uuid;
  v_addr uuid; v_old_addr uuid; v_var uuid; v_price numeric; v_qty int;
  v_vjn uuid; v_awv uuid; v_ord jsonb; v_ord2 jsonb; v_snap jsonb; v_row addresses%rowtype; v_n int; v_detail jsonb;
  v_err text; v_blocked_source boolean := false; v_blocked_length boolean := false;
  v_burst_ok int := 0; v_61 text; v_unknown text; v_checkout_ok boolean := false; v_anon text;
begin
  select id into v_vjn from stores where code = 'GP-VJN';
  select id into v_awv from stores where code = 'GP-AWV';
  select a.user_id, a.id into v_cust, v_src from addresses a join profiles pr on pr.id = a.user_id where pr.role = 'customer' and pr.is_active order by a.created_at limit 1;
  select id into v_other from profiles where role = 'customer' and is_active and id <> v_cust order by created_at limit 1;
  select id into v_admin from profiles where role = 'admin' and is_active order by created_at limit 1;
  insert into carts (user_id) values (v_cust) on conflict (user_id) do nothing;
  select id into v_cart from carts where user_id = v_cust;

  r := r || jsonb_build_object('columns', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'addresses'
        and column_name in ('house_no','building','floor','street','locality','formatted_address','place_id','delivery_instructions','geocode_source') and is_nullable = 'YES'));

  -- constraints refuse bad data
  begin
    insert into addresses (user_id, recipient_name, phone, address_line_1, city, state, postal_code, latitude, longitude, geocode_source)
    values (v_cust, 'T', '9000000000', 'x', 'Agra', 'UP', '282002', 27.2, 78.0, 'bogus');
  exception when check_violation then v_blocked_source := true; end;
  begin
    insert into addresses (user_id, recipient_name, phone, address_line_1, city, state, postal_code, latitude, longitude, delivery_instructions)
    values (v_cust, 'T', '9000000000', 'x', 'Agra', 'UP', '282002', 27.2, 78.0, repeat('x', 501));
  exception when check_violation then v_blocked_length := true; end;
  r := r || jsonb_build_object('blocked_bad_source', v_blocked_source, 'blocked_long_instructions', v_blocked_length);

  -- a real product both stores hold (cart sized above the real minimum order)
  select pv.id, pv.price into v_var, v_price from product_variants pv join products pr on pr.id = pv.product_id
    where pv.is_active and pr.is_active and pv.price > 0
      and exists (select 1 from inventory i where i.store_id = v_vjn and i.product_variant_id = pv.id and i.is_available and i.quantity - i.reserved_quantity >= 100)
    order by pv.price asc limit 1;
  v_qty := greatest(1, ceil(350 / v_price)::int);
  delete from cart_items where cart_id = v_cart;
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var, v_qty);

  -- the customer saves a fully structured address through RLS (as the app does)
  ${asRole('v_cust')}
  insert into addresses (user_id, label, recipient_name, phone, address_line_1, address_line_2, landmark, city, state, postal_code, latitude, longitude,
                         house_no, building, floor, street, locality, formatted_address, place_id, delivery_instructions, geocode_source)
  values (v_cust, 'home', 'Asha Sharma', '9876543210', '12-B, Sharma Apartments, 2nd floor, Rajpur Road', 'Vijay Nagar', 'Opposite the temple', 'Agra', 'Uttar Pradesh', '282002', 27.203721, 78.021908,
          '12-B', 'Sharma Apartments', '2nd', 'Rajpur Road', 'Vijay Nagar', 'Rajpur Rd, Vijay Nagar, Agra, Uttar Pradesh 282002, India', 'ChIJ_probe_place_id_0001', 'Call when you reach the gate', 'google')
  returning id into v_addr;
  select * into v_row from addresses where id = v_addr;
  r := r || jsonb_build_object('readback', to_jsonb(v_row) - 'geog' - 'created_at' - 'updated_at' - 'user_id' - 'id');

  -- another customer cannot read it
  ${asRole('v_other')}
  select count(*) into v_n from addresses where id = v_addr;
  r := r || jsonb_build_object('other_customer_sees', v_n);

  -- the order snapshot carries the new fields and the old ones
  ${asRole('v_cust')}
  v_ord := create_order_from_cart(v_addr, 'probe-structured-' || gen_random_uuid(), 'cod');
  ${backToOwner}
  select delivery_address into v_snap from orders where id = (v_ord->>'orderId')::uuid;
  r := r || jsonb_build_object('order', jsonb_build_object('success', v_ord->'success', 'code', v_ord->>'code', 'message', left(coalesce(v_ord->>'message', ''), 160)), 'snapshot', v_snap);

  -- an admin reads them through the real admin RPC
  if v_admin is not null and (v_ord->>'orderId') is not null then
    ${asRole('v_admin')}
    v_detail := get_admin_order_detail((v_ord->>'orderId')::uuid);
    ${backToOwner}
    r := r || jsonb_build_object('admin_sees', v_detail->'deliveryAddress'->>'delivery_instructions', 'admin_house', v_detail->'deliveryAddress'->>'house_no');
  end if;

  -- an old-style address (no structured fields) still checks out; its snapshot just has nulls there
  delete from cart_items where cart_id = v_cart;
  insert into cart_items (cart_id, product_variant_id, quantity) values (v_cart, v_var, v_qty);
  insert into addresses (user_id, label, recipient_name, phone, address_line_1, city, state, postal_code, latitude, longitude)
  values (v_cust, 'other', 'Old Style', '9000000001', 'Old line 1', 'Agra', 'Uttar Pradesh', '282002', 27.203721, 78.021908) returning id into v_old_addr;
  ${asRole('v_cust')}
  v_ord2 := create_order_from_cart(v_old_addr, 'probe-old-' || gen_random_uuid(), 'cod');
  ${backToOwner}
  r := r || jsonb_build_object('old_style_order', jsonb_build_object('success', v_ord2->'success', 'code', v_ord2->>'code'),
        'old_snapshot', (select jsonb_build_object('line1', delivery_address->>'address_line_1', 'house_no', delivery_address->'house_no', 'has_house_key', delivery_address ? 'house_no') from orders where id = (v_ord2->>'orderId')::uuid));

  -- rate limit
  ${asRole('v_cust')}
  for i in 1..60 loop
    perform enforce_rate_limit('places_lookup');
    v_burst_ok := v_burst_ok + 1;
  end loop;
  begin perform enforce_rate_limit('places_lookup'); v_61 := 'allowed'; exception when others then v_61 := sqlerrm; end;
  begin perform enforce_rate_limit('no_such_action'); v_unknown := 'allowed'; exception when others then v_unknown := sqlerrm; end;
  begin perform enforce_rate_limit('checkout'); v_checkout_ok := true; exception when others then v_checkout_ok := false; end;
  ${backToOwner}
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  begin perform enforce_rate_limit('places_lookup'); v_anon := 'allowed'; exception when others then v_anon := sqlerrm; end;
  ${backToOwner}
  r := r || jsonb_build_object('rate', jsonb_build_object('burst_ok', v_burst_ok, 'sixty_first', v_61, 'unknown', v_unknown, 'checkout_still_allowed', v_checkout_ok, 'unauthenticated', v_anon));

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

check('all nine new address columns exist and are nullable (old rows stay valid)', R.columns === 9, `${R.columns}`);
check('an unknown geocode_source is refused', R.blocked_bad_source === true);
check('delivery instructions over 500 characters are refused', R.blocked_long_instructions === true);

const b = R.readback ?? {};
check('the customer saved every structured field through RLS and reads it back exactly',
  b.house_no === '12-B' && b.building === 'Sharma Apartments' && b.floor === '2nd' && b.street === 'Rajpur Road' && b.locality === 'Vijay Nagar' &&
  b.formatted_address === 'Rajpur Rd, Vijay Nagar, Agra, Uttar Pradesh 282002, India' && b.place_id === 'ChIJ_probe_place_id_0001' &&
  b.delivery_instructions === 'Call when you reach the gate' && b.geocode_source === 'google' && b.landmark === 'Opposite the temple',
  JSON.stringify(b));
check('the coordinates are stored exactly as confirmed', b.latitude === 27.203721 && b.longitude === 78.021908);
check('another customer cannot read that address (RLS)', R.other_customer_sees === 0, `${R.other_customer_sees}`);

check('the order is placed from the structured address', R.order?.success === true, JSON.stringify(R.order));
const s = R.snapshot ?? {};
check('the order snapshot carries the new fields', s.house_no === '12-B' && s.building === 'Sharma Apartments' && s.floor === '2nd' && s.street === 'Rajpur Road' && s.locality === 'Vijay Nagar' &&
  s.place_id === 'ChIJ_probe_place_id_0001' && s.delivery_instructions === 'Call when you reach the gate' && s.formatted_address === 'Rajpur Rd, Vijay Nagar, Agra, Uttar Pradesh 282002, India', JSON.stringify(s));
check('... and still carries every old field the other screens read',
  s.address_line_1 === '12-B, Sharma Apartments, 2nd floor, Rajpur Road' && s.address_line_2 === 'Vijay Nagar' && s.landmark === 'Opposite the temple' && s.city === 'Agra' && s.state === 'Uttar Pradesh' &&
  s.postal_code === '282002' && s.recipient_name === 'Asha Sharma' && s.phone === '9876543210' && s.latitude === 27.203721 && s.longitude === 78.021908, JSON.stringify(s));
check('an admin reads the delivery instructions and house number through get_admin_order_detail', R.admin_sees === 'Call when you reach the gate' && R.admin_house === '12-B', `${R.admin_sees} / ${R.admin_house}`);

check('an old-style address (no structured fields) still checks out', R.old_style_order?.success === true, JSON.stringify(R.old_style_order));
check('... with null (not invented) structured fields in its snapshot', R.old_snapshot?.line1 === 'Old line 1' && R.old_snapshot?.has_house_key === true && R.old_snapshot?.house_no === null, JSON.stringify(R.old_snapshot));

check('places_lookup allows a burst of 60', R.rate?.burst_ok === 60, JSON.stringify(R.rate));
check('the 61st is refused with rate_limit_exceeded', /rate_limit_exceeded/.test(R.rate?.sixty_first ?? ''), R.rate?.sixty_first);
check('an unknown action is still refused (guard unchanged)', /unknown rate limit action/.test(R.rate?.unknown ?? ''), R.rate?.unknown);
check('other actions keep their own bucket (checkout unaffected)', R.rate?.checkout_still_allowed === true);
check('an unauthenticated caller is refused', /not authenticated/.test(R.rate?.unauthenticated ?? ''), R.rate?.unauthenticated);

console.log(`\n${passed} passed, ${failed} failed (everything was rolled back)`);
process.exit(failed === 0 ? 0 : 1);
