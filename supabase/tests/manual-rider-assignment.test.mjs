#!/usr/bin/env node
/**
 * Manual rider assignment (migration 20260827000017), end to end against the live database. Everything runs
 * inside ONE transaction that is rolled back at the end (the probe raises on purpose), so it leaves no data
 * behind: the riders, the order and the assignments below are scratch rows that never get committed.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/manual-rider-assignment.test.mjs
 *
 * It acts with the same database role and JWT claims the apps use: a store manager choosing riders, a rider
 * declining, and a customer who must be refused.
 *
 * Needs at least five riders that are currently inactive (the demo riders); they are switched on inside the
 * transaction only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (needed to run SQL through the Management API).');
  process.exit(1);
}
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../.temp/project-ref'), 'utf8').trim();

// Switch the database role and JWT claims to a given user id (a plpgsql expression).
const actAs = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uid}, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (${uid})::text, true);
  execute 'set local role authenticated';`;
const backToOwner = `execute 'reset role';`;
// Run a statement that is expected to fail and record the message (or ALLOWED if it did not fail).
const expectError = (key, stmt) => `begin ${stmt}; r := r || jsonb_build_object('${key}', 'ALLOWED'); exception when others then r := r || jsonb_build_object('${key}', left(sqlerrm, 140)); end;`;
const riderField = (idx, field) => `(select x->>'${field}' from jsonb_array_elements(v_list) x where x->>'riderId' = v_riders[${idx}]::text)`;
const notes = (order) => `(select count(*) from notifications where user_id = v_mgr and event_type::text = 'dispatch_round_expired' and data->>'orderId' = ${order}::text)`;

const PROBE = `
create function pg_temp.mk_order(p_store uuid, p_status text) returns uuid language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  insert into orders
  select (jsonb_populate_record(null::orders, to_jsonb(o) || jsonb_build_object('id', v_id, 'order_number', 'PROBE-' || substr(v_id::text, 1, 8), 'status', p_status, 'idempotency_key', null))).*
  from orders o where o.store_id = p_store order by o.created_at desc limit 1;
  return v_id;
end $f$;

do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_store uuid; v_mgr uuid; v_cust uuid; v_lat double precision; v_lng double precision;
  v_riders uuid[]; v_rp uuid[];
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid;
  v_list jsonb; v_att jsonb; n int; m int;
begin
  select s.id, ss.user_id, s.latitude, s.longitude into v_store, v_mgr, v_lat, v_lng
    from store_staff ss join stores s on s.id = ss.store_id
    where ss.role = 'store_manager' and ss.is_active and s.is_active order by s.code limit 1;
  select id into v_cust from profiles where role = 'customer' and is_active limit 1;
  select array_agg(id order by id), array_agg(profile_id order by id) into v_riders, v_rp
    from (select id, profile_id from riders where not is_active order by id limit 5) q;
  if v_store is null or v_mgr is null or v_cust is null or coalesce(array_length(v_riders, 1), 0) < 5 then
    raise exception 'PROBE_SETUP_MISSING store=% manager=% customer=% riders=%', v_store, v_mgr, v_cust, coalesce(array_length(v_riders, 1), 0);
  end if;

  -- Five scratch riders: 1 free, 2 at the delivery limit and on the road, 3 free-ish (heading to store, 1 of 3),
  -- 4 offline, 5 with an unanswered request.
  update riders set is_active = true, is_available = true, primary_store_id = v_store, max_active_deliveries = 1,
    current_latitude = v_lat + 0.009, current_longitude = v_lng, last_location_at = now() where id = any (v_riders);
  update riders set max_active_deliveries = 3 where id = v_riders[3];
  update riders set is_available = false where id = v_riders[4];

  v_o1 := pg_temp.mk_order(v_store, 'packed');           -- the order we assign
  v_o2 := pg_temp.mk_order(v_store, 'out_for_delivery');
  v_o3 := pg_temp.mk_order(v_store, 'rider_assigned');
  v_o4 := pg_temp.mk_order(v_store, 'rider_assigned');
  insert into delivery_assignments (order_id, rider_id, store_id, status, assigned_by, assignment_source, expires_at)
    values (v_o2, v_riders[2], v_store, 'in_transit', v_mgr, 'manual', null),
           (v_o3, v_riders[3], v_store, 'accepted', v_mgr, 'manual', null),
           (v_o4, v_riders[5], v_store, 'assigned', v_mgr, 'manual', now() + interval '5 minutes');

  -- 1. The picker lists every rider with a readable status.
  ${actAs('v_mgr')}
  v_list := get_riders_for_assignment(v_o1);
  r := r || jsonb_build_object(
    'st1', ${riderField(1, 'status')}, 'st2', ${riderField(2, 'status')}, 'st3', ${riderField(3, 'status')},
    'st4', ${riderField(4, 'status')}, 'st5', ${riderField(5, 'status')},
    'can1', ${riderField(1, 'canAssign')}, 'can2', ${riderField(2, 'canAssign')}, 'can3', ${riderField(3, 'canAssign')},
    'can4', ${riderField(4, 'canAssign')}, 'can5', ${riderField(5, 'canAssign')},
    'load3', ${riderField(3, 'activeDeliveries')} || '/' || ${riderField(3, 'capacity')},
    'dist1', ${riderField(1, 'distanceMeters')});
  select coalesce(max(o), 0) into n from jsonb_array_elements(v_list) with ordinality t(x, o) where (x->>'canAssign')::boolean;
  select coalesce(min(o), 999) into m from jsonb_array_elements(v_list) with ordinality t(x, o) where not (x->>'canAssign')::boolean;
  r := r || jsonb_build_object('assignable_listed_before_blocked', n < m);
  select coalesce(max(o), 0) into n from jsonb_array_elements(v_list) with ordinality t(x, o) where (x->>'canAssign')::boolean and x->>'status' = 'free';
  select coalesce(min(o), 999) into m from jsonb_array_elements(v_list) with ordinality t(x, o) where (x->>'canAssign')::boolean and x->>'status' <> 'free';
  r := r || jsonb_build_object('free_listed_before_busy', n < m,
    'inactive_riders_hidden', not exists (select 1 from jsonb_array_elements(v_list) x join riders rr on rr.id = (x->>'riderId')::uuid where not rr.is_active));

  -- 2. Only a rider who can take the order can be assigned.
  ${expectError('assign_offline', `perform assign_rider(v_o1, v_riders[4])`)}
  ${expectError('assign_at_limit', `perform assign_rider(v_o1, v_riders[2])`)}
  ${expectError('assign_pending', `perform assign_rider(v_o1, v_riders[5])`)}
  v_a1 := assign_rider(v_o1, v_riders[1]);
  r := r || jsonb_build_object('order_after_assign', (select status::text from orders where id = v_o1),
    'st1_after_assign', (select x->>'status' from jsonb_array_elements(get_riders_for_assignment(v_o1)) x where x->>'riderId' = v_riders[1]::text));

  -- 3. The rider declines -> the order is open again, the store is told, and a new rider can be chosen at once.
  ${backToOwner}
  ${actAs('v_rp[1]')}
  perform decline_delivery(v_a1, 'busy right now');
  ${backToOwner}
  ${actAs('v_mgr')}
  v_att := get_order_rider_attempts(v_o1);
  r := r || jsonb_build_object('order_after_decline', (select status::text from orders where id = v_o1),
    'attempt1_status', v_att->0->>'status', 'attempt1_reason', v_att->0->>'reason', 'attempt1_rider', (v_att->0->>'riderId') = v_riders[1]::text,
    'notes_after_decline', ${notes('v_o1')},
    'note_body', (select body from notifications where user_id = v_mgr and event_type::text = 'dispatch_round_expired' and data->>'orderId' = v_o1::text order by created_at desc limit 1),
    'note_audience', (select data->>'audience' from notifications where user_id = v_mgr and event_type::text = 'dispatch_round_expired' and data->>'orderId' = v_o1::text order by created_at desc limit 1));
  v_a2 := assign_rider(v_o1, v_riders[3]);
  r := r || jsonb_build_object('reassigned_after_decline', (select status::text from orders where id = v_o1));

  -- 4. The second rider never answers: the 5-minute request lapses and the store is told again.
  ${backToOwner}
  update delivery_assignments set expires_at = now() - interval '1 minute' where id = v_a2;
  perform expire_stale_assignments();
  r := r || jsonb_build_object('a2_after_expiry', (select status::text from delivery_assignments where id = v_a2),
    'order_after_expiry', (select status::text from orders where id = v_o1),
    'notes_after_expiry', ${notes('v_o1')},
    -- (both notes share the transaction's timestamp, so look the lapse note up by its wording, not "newest")
    'expiry_note_exists', exists (select 1 from notifications where user_id = v_mgr and event_type::text = 'dispatch_round_expired' and data->>'orderId' = v_o1::text and body like '%did not respond to Order #PROBE-%'));

  -- 5. Cancel an assignment in between and reassign instantly; cancelling is not a "did not accept" event.
  ${actAs('v_mgr')}
  v_a3 := assign_rider(v_o1, v_riders[1]);
  perform cancel_assignment(v_a3, 'reassigning');
  r := r || jsonb_build_object('a3_after_cancel', (select status::text from delivery_assignments where id = v_a3),
    'order_after_cancel', (select status::text from orders where id = v_o1),
    'notes_after_cancel', ${notes('v_o1')});
  ${expectError('cancel_twice', `perform cancel_assignment(v_a3, 'again')`)}
  v_a4 := assign_rider(v_o1, v_riders[3]);
  r := r || jsonb_build_object('order_after_instant_reassign', (select status::text from orders where id = v_o1),
    'a4_status', (select status::text from delivery_assignments where id = v_a4));
  ${expectError('assign_taken_order', `perform assign_rider(v_o1, v_riders[1])`)}

  -- 6. Automatic assignment is gone for app users.
  ${expectError('auto_start', `perform start_auto_assignment(v_o1)`)}
  ${expectError('auto_single', `perform auto_assign_rider(v_o1)`)}

  -- 7. A customer is refused every one of these.
  ${backToOwner}
  r := r || jsonb_build_object('auto_job_scheduled', (select count(*) from cron.job where jobname = 'retry-auto-assignment-rounds'),
    'open_auto_rounds', (select count(*) from delivery_dispatch_rounds where status = 'open' and mode = 'auto'));
  ${actAs('v_cust')}
  ${expectError('customer_list', `perform get_riders_for_assignment(v_o1)`)}
  ${expectError('customer_attempts', `perform get_order_rider_attempts(v_o1)`)}
  ${expectError('customer_cancel', `perform cancel_assignment(v_a4, 'x')`)}
  ${expectError('customer_assign', `perform assign_rider(v_o1, v_riders[1])`)}
  ${backToOwner}

  raise exception 'PROBE_RESULT %', r::text;
end $probe$;
`;

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

const probe = await sql(PROBE);
const message = String(probe.body?.message ?? '');
const match = message.match(/PROBE_RESULT (\{.*\})/);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 900));
  process.exit(1);
}
const r = JSON.parse(match[1]);
console.log('probe result:', JSON.stringify(r, null, 1), '\n');

check('each rider shows their real status: free / delivering / heading to store / offline / request pending',
  r.st1 === 'free' && r.st2 === 'delivering' && r.st3 === 'heading_to_store' && r.st4 === 'offline' && r.st5 === 'request_pending',
  `${r.st1}/${r.st2}/${r.st3}/${r.st4}/${r.st5}`);
check('only riders who can take the order are selectable (free, and the 1-of-3 rider; not the full, offline or pending ones)',
  r.can1 === 'true' && r.can3 === 'true' && r.can2 === 'false' && r.can4 === 'false' && r.can5 === 'false', `${r.can1}/${r.can2}/${r.can3}/${r.can4}/${r.can5}`);
check('the load is shown (1 of 3 for the rider with a bigger limit)', r.load3 === '1/3', r.load3);
check('distance from the store is shown', Number(r.dist1) > 500 && Number(r.dist1) < 1500, `distance ${r.dist1}`);
check('assignable riders are listed before blocked ones, and free ones before busy ones', r.assignable_listed_before_blocked === true && r.free_listed_before_busy === true);
check('inactive (suspended) riders are not listed', r.inactive_riders_hidden === true);
check('an offline rider cannot be assigned', /not available/i.test(r.assign_offline), r.assign_offline);
check('a rider at their delivery limit cannot be assigned', /capacity/i.test(r.assign_at_limit), r.assign_at_limit);
check('a rider with an unanswered request is at their limit too', /capacity/i.test(r.assign_pending), r.assign_pending);
check('assigning a free rider moves the order to rider_assigned and the rider shows "request pending"', r.order_after_assign === 'rider_assigned' && r.st1_after_assign === 'request_pending', `${r.order_after_assign}/${r.st1_after_assign}`);

check('a decline puts the order back to ready for pickup', r.order_after_decline === 'packed');
check('the attempt list records who declined and why', r.attempt1_status === 'declined' && r.attempt1_reason === 'busy right now' && r.attempt1_rider === true, `${r.attempt1_status}/${r.attempt1_reason}`);
check('the store is told a rider declined, once, with the order number and a store audience', Number(r.notes_after_decline) === 1 && /declined/.test(r.note_body ?? '') && /PROBE-/.test(r.note_body ?? '') && r.note_audience === 'store', `${r.notes_after_decline} ${r.note_body} ${r.note_audience}`);
check('another rider can be chosen straight after a decline', r.reassigned_after_decline === 'rider_assigned');

check('a request nobody answers expires and the order is open again', r.a2_after_expiry === 'expired' && r.order_after_expiry === 'packed', `${r.a2_after_expiry}/${r.order_after_expiry}`);
check('the store is told again when it lapses ("did not respond")', Number(r.notes_after_expiry) === 2 && r.expiry_note_exists === true, `${r.notes_after_expiry} ${r.expiry_note_exists}`);

check('cancelling a pending assignment frees the order', r.a3_after_cancel === 'cancelled' && r.order_after_cancel === 'packed', `${r.a3_after_cancel}/${r.order_after_cancel}`);
check('cancelling is not reported as "rider did not accept"', Number(r.notes_after_cancel) === 2, `${r.notes_after_cancel}`);
check('the same assignment cannot be cancelled twice', /terminal/i.test(r.cancel_twice), r.cancel_twice);
check('a new rider can be assigned immediately after the cancel', r.order_after_instant_reassign === 'rider_assigned' && r.a4_status === 'assigned', `${r.order_after_instant_reassign}/${r.a4_status}`);
check('an order that already has a rider cannot be given to a second one', /not ready for rider assignment/i.test(r.assign_taken_order), r.assign_taken_order);

check('automatic assignment cannot be started by an app user', /permission denied/i.test(r.auto_start) && /permission denied/i.test(r.auto_single), `${r.auto_start} | ${r.auto_single}`);
check('the automatic retry job is no longer scheduled and no automatic round is open', Number(r.auto_job_scheduled) === 0 && Number(r.open_auto_rounds) === 0);
check('a customer cannot see riders, attempts, cancel or assign', [r.customer_list, r.customer_attempts, r.customer_cancel, r.customer_assign].every((m) => /not authorized/i.test(m)), [r.customer_list, r.customer_attempts, r.customer_cancel, r.customer_assign].join(' | '));

const left = (await sql(`select count(*) as n from orders where order_number like 'PROBE-%'`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
