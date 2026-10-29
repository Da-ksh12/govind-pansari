#!/usr/bin/env node
/**
 * Migration 20260829000002 (admin alignment + order-cancel closes the delivery) against the live database. The migration text runs FIRST in the
 * same transaction and the whole transaction is rolled back at the end, so this proves it before it is applied and re-proves it after.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/admin-alignment.test.mjs
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
const MIGRATION = readFileSync(resolve(here, '../migrations/20260829000002_admin_alignment_and_order_cancel.sql'), 'utf8');

const actAs = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uid}, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (${uid})::text, true);
  execute 'set local role authenticated';`;
const owner = `execute 'reset role';`;
const attempt = (key, stmt) => `begin ${stmt}; r := r || jsonb_build_object('${key}', 'ALLOWED'); exception when others then r := r || jsonb_build_object('${key}', left(sqlerrm, 140)); end;`;
const asAdmin = (role) => `${owner} update profiles set admin_role = ${role === null ? 'null' : `'${role}'`} where id = v_adm; ${actAs('v_adm')}`;

const PROBE = `
create function pg_temp.mk_order(p_store uuid, p_status text) returns uuid language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  insert into orders
  select (jsonb_populate_record(null::orders, to_jsonb(o) || jsonb_build_object('id', v_id, 'order_number', 'PROBE-' || substr(v_id::text, 1, 8), 'status', p_status, 'idempotency_key', null, 'cancelled_at', null, 'cancelled_by', null, 'cancellation_reason', null))).*
  from orders o where o.store_id = p_store order by o.created_at desc limit 1;
  return v_id;
end $f$;

do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_adm uuid; v_mgr uuid; v_mgr_store uuid; v_store uuid; v_lat double precision; v_lng double precision;
  v_rider uuid; v_rp uuid; v_o1 uuid; v_o2 uuid; v_owner uuid; v_a uuid; v_round uuid; n int; v_pricing jsonb; v_fs record;
begin
  select id into v_adm from profiles where role = 'admin' and admin_role is not null order by created_at limit 1;
  select ss.user_id, ss.store_id into v_mgr, v_mgr_store from store_staff ss join stores s on s.id = ss.store_id where ss.role = 'store_manager' and ss.is_active and s.is_active order by s.code limit 1;
  select id, latitude, longitude into v_store, v_lat, v_lng from stores where is_active order by code limit 1;
  select r2.id, r2.profile_id into v_rider, v_rp from riders r2 where not exists (select 1 from delivery_assignments da where da.rider_id = r2.id and not is_terminal_delivery_status(da.status)) order by r2.id limit 1;
  if v_adm is null or v_mgr is null or v_store is null or v_rider is null then
    raise exception 'PROBE_SETUP_MISSING adm=% mgr=% store=% rider=%', v_adm, v_mgr, v_store, v_rider;
  end if;
  update riders set is_active = true, is_available = true, primary_store_id = v_store, max_active_deliveries = 1 where id = v_rider;

  -- 1. is_admin(): the 'admin' sub-role counts, a named manager role does not
  ${asAdmin(null)} r := r || jsonb_build_object('is_admin_owner', is_admin());
  ${asAdmin('super_admin')} r := r || jsonb_build_object('is_admin_super', is_admin());
  ${asAdmin('admin')} r := r || jsonb_build_object('is_admin_admin', is_admin());
  ${attempt('admin_coupon', `insert into coupons (code, discount_type, discount_value, expires_at) values ('PROBE1', 'flat', 1, now() + interval '1 day')`)}
  ${asAdmin('operations_manager')} r := r || jsonb_build_object('is_admin_ops', is_admin());
  ${attempt('ops_coupon', `insert into coupons (code, discount_type, discount_value, expires_at) values ('PROBE2', 'flat', 1, now() + interval '1 day')`)}
  ${owner}

  -- 2. a store manager can no longer write their own store's row, but the store app's function still works
  ${actAs('v_mgr')}
  begin update stores set phone = phone where id = v_mgr_store; get diagnostics n = row_count; r := r || jsonb_build_object('manager_direct_rows', n); exception when others then r := r || jsonb_build_object('manager_direct_rows', 'ERR ' || left(sqlerrm, 80)); end;
  ${attempt('manager_set_accepting', `perform set_store_accepting_orders(v_mgr_store, true)`)}
  ${asAdmin('admin')}
  begin update stores set phone = phone where id = v_store; get diagnostics n = row_count; r := r || jsonb_build_object('admin_direct_rows', n); exception when others then r := r || jsonb_build_object('admin_direct_rows', 'ERR ' || left(sqlerrm, 80)); end;
  ${owner}

  -- 3. cancelling an order closes its delivery, its open rider request and its open dispatch round
  v_o1 := pg_temp.mk_order(v_store, 'out_for_delivery');
  insert into delivery_assignments (order_id, rider_id, store_id, status, assigned_by, assignment_source, expires_at) values (v_o1, v_rider, v_store, 'in_transit', v_mgr, 'manual', null) returning id into v_a;
  insert into delivery_dispatch_rounds (order_id, store_id, round_number, status, started_by, expires_at, mode) values (v_o1, v_store, 1, 'open', v_mgr, now() + interval '5 minutes', 'broadcast') returning id into v_round;
  insert into delivery_offers (dispatch_round_id, order_id, store_id, rider_id, status, expires_at) values (v_round, v_o1, v_store, v_rider, 'open', now() + interval '5 minutes');
  r := r || jsonb_build_object('rider_before', get_rider_status(v_rider));
  ${asAdmin(null)}
  perform update_order_status(v_o1, 'cancelled', 'probe cancel');
  ${owner}
  r := r || jsonb_build_object(
    'order_after', (select status::text from orders where id = v_o1),
    'assignment_after', (select status::text from delivery_assignments where id = v_a),
    'assignment_cancelled_at_set', (select cancelled_at is not null from delivery_assignments where id = v_a),
    'cancel_events', (select count(*) from delivery_events where delivery_id = v_a and event_type::text = 'delivery_cancelled'),
    'cancel_event_reason', (select metadata->>'reason' from delivery_events where delivery_id = v_a and event_type::text = 'delivery_cancelled' limit 1),
    'offer_after', (select status::text from delivery_offers where order_id = v_o1),
    'round_after', (select status::text from delivery_dispatch_rounds where id = v_round),
    'rider_after', get_rider_status(v_rider),
    'rider_notes_wrongly_blamed', (select count(*) from notifications where event_type::text = 'dispatch_round_expired' and data->>'orderId' = v_o1::text));
  ${asAdmin(null)}
  ${attempt('cancel_twice', `perform update_order_status(v_o1, 'cancelled', 'again')`)}
  ${owner}

  -- 4. the customer's own early cancel still works (no delivery to close) and a finished delivery is left alone
  v_o2 := pg_temp.mk_order(v_store, 'placed');
  select user_id into v_owner from orders where id = v_o2;
  ${actAs('v_owner')}
  ${attempt('owner_cancel_placed', `perform update_order_status(v_o2, 'cancelled', 'changed my mind')`)}
  ${owner}
  r := r || jsonb_build_object('owner_cancel_status', (select status::text from orders where id = v_o2));

  -- 5. the do-nothing grants are gone, the real ones are not
  r := r || jsonb_build_object(
    'ops_has_manage', exists (select 1 from role_permissions where admin_role = 'operations_manager' and permission::text = 'orders.manage'),
    'support_has_send', exists (select 1 from role_permissions where admin_role = 'support_agent' and permission::text = 'notifications.send'),
    'ops_has_cancel', exists (select 1 from role_permissions where admin_role = 'operations_manager' and permission::text = 'orders.cancel'),
    'support_has_view', exists (select 1 from role_permissions where admin_role = 'support_agent' and permission::text = 'orders.view'),
    'permissions_total', (select count(*) from role_permissions));

  -- 6. get_delivery_pricing returns what the zone charges
  ${actAs('v_adm')}
  v_pricing := get_delivery_pricing(v_lat, v_lng);
  select fs.delivery_fee, fs.minimum_order_value, fs.estimated_delivery_minutes, z.free_delivery_threshold into v_fs
    from find_serviceable_stores(v_lat, v_lng) fs join delivery_zones z on z.id = fs.delivery_zone_id order by fs.distance_meters limit 1;
  r := r || jsonb_build_object('pricing', v_pricing, 'pricing_matches_zone',
    v_pricing->>'deliveryFee' = v_fs.delivery_fee::text and v_pricing->>'minimumOrderValue' = v_fs.minimum_order_value::text
    and coalesce(v_pricing->>'freeDeliveryThreshold', '') = coalesce(v_fs.free_delivery_threshold::text, '')
    and v_pricing->>'estimatedMinutes' = v_fs.estimated_delivery_minutes::text);
  r := r || jsonb_build_object('pricing_far_away', get_delivery_pricing(0, 0));
  ${owner}
  r := r || jsonb_build_object('anon_can_run_pricing', has_function_privilege('anon', 'get_delivery_pricing(double precision,double precision)', 'execute'),
    'auth_can_run_pricing', has_function_privilege('authenticated', 'get_delivery_pricing(double precision,double precision)', 'execute'));

  raise exception 'PROBE_RESULT %', r::text;
end
$probe$;`;

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};

const probe = await sql(`${MIGRATION}\n${PROBE}`);
const message = String(probe.body?.message ?? '');
const match = message.match(/PROBE_RESULT (\{.*\})/s);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 1500));
  process.exit(1);
}
const r = JSON.parse(match[1]);
console.log('probe result:', JSON.stringify(r, null, 1), '\n');

check('is_admin() is true for the owner account, super_admin AND admin — and false for a manager role', r.is_admin_owner === true && r.is_admin_super === true && r.is_admin_admin === true && r.is_admin_ops === false, JSON.stringify([r.is_admin_owner, r.is_admin_super, r.is_admin_admin, r.is_admin_ops]));
check('so an admin can now write coupons, and an operations manager still cannot', r.admin_coupon === 'ALLOWED' && /row-level security/i.test(r.ops_coupon), `${r.admin_coupon} | ${r.ops_coupon}`);
check('a store manager can no longer rewrite their own store row…', Number(r.manager_direct_rows) === 0, String(r.manager_direct_rows));
check('…but the store app\'s open/pause function still works for them', r.manager_set_accepting === 'ALLOWED', r.manager_set_accepting);
check('and the admin panel still edits stores directly', Number(r.admin_direct_rows) === 1, String(r.admin_direct_rows));

check('before the cancel the rider is busy delivering', r.rider_before === 'delivering', r.rider_before);
check('cancelling the order cancels it', r.order_after === 'cancelled', r.order_after);
check('…and closes the rider\'s delivery with a cancel time', r.assignment_after === 'cancelled' && r.assignment_cancelled_at_set === true, `${r.assignment_after}/${r.assignment_cancelled_at_set}`);
check('…records exactly one "delivery cancelled" event saying why', Number(r.cancel_events) === 1 && r.cancel_event_reason === 'order_cancelled', `${r.cancel_events}/${r.cancel_event_reason}`);
check('…closes the open rider request and the open dispatch round', r.offer_after === 'cancelled' && r.round_after === 'cancelled', `${r.offer_after}/${r.round_after}`);
check('…so the rider is free again straight away', r.rider_after === 'available', r.rider_after);
check('…and the store is not told "the rider did not accept"', Number(r.rider_notes_wrongly_blamed) === 0, String(r.rider_notes_wrongly_blamed));
check('cancelling twice is still refused', /already cancelled/i.test(r.cancel_twice), r.cancel_twice);
check('a customer cancelling their own new order still works', r.owner_cancel_placed === 'ALLOWED' && r.owner_cancel_status === 'cancelled', `${r.owner_cancel_placed}/${r.owner_cancel_status}`);

check('the two do-nothing grants are removed', r.ops_has_manage === false && r.support_has_send === false, `${r.ops_has_manage}/${r.support_has_send}`);
check('the real grants are untouched', r.ops_has_cancel === true && r.support_has_view === true, `${r.ops_has_cancel}/${r.support_has_view}`);

check('delivery pricing is exactly what the zone charges', r.pricing_matches_zone === true, JSON.stringify(r.pricing));
check('nothing serves a point in the ocean: empty answer', JSON.stringify(r.pricing_far_away) === '{}', JSON.stringify(r.pricing_far_away));
check('only signed-in users may ask for it', r.anon_can_run_pricing === false && r.auth_can_run_pricing === true, `${r.anon_can_run_pricing}/${r.auth_can_run_pricing}`);

const left = (await sql(`select count(*) as n from orders where order_number like 'PROBE-%'`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
