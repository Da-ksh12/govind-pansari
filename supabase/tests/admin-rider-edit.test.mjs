#!/usr/bin/env node
/**
 * admin_update_rider (migration 20260829000001) against the live database. The migration text is run FIRST inside the same transaction,
 * and the whole transaction is rolled back at the end (the probe raises on purpose) — so this works before the migration is applied
 * (it proves the function) and after (it re-proves it), and either way leaves nothing behind.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/admin-rider-edit.test.mjs
 *
 * Acts with the database role and JWT claims the apps use: an admin account switched between admin roles, and a customer.
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
const MIGRATION = readFileSync(resolve(here, '../migrations/20260829000001_admin_update_rider.sql'), 'utf8');

const actAs = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uid}, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (${uid})::text, true);
  execute 'set local role authenticated';`;
const owner = `execute 'reset role';`;
// Run a statement that is expected to fail and record the message (or ALLOWED if it did not fail).
const attempt = (key, stmt) => `begin ${stmt}; r := r || jsonb_build_object('${key}', 'ALLOWED'); exception when others then r := r || jsonb_build_object('${key}', left(sqlerrm, 140)); end;`;
const asRole = (role) => `${owner} update profiles set admin_role = ${role === null ? 'null' : `'${role}'`} where id = v_adm; ${actAs('v_adm')}`;

const PROBE = `
do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_adm uuid; v_cust uuid; v_store uuid; v_store2 uuid; v_rider uuid; v_rp uuid; v_busy uuid; v_order uuid;
  v_before riders%rowtype; v_after riders%rowtype; v_name_after text; v_audits_before int; v_audits_after int;
begin
  -- the second admin account is the one we switch between roles; the first (super admin) must not be touched
  select id into v_adm from profiles where role = 'admin' and admin_role is not null order by created_at limit 1;
  select id into v_cust from profiles where role = 'customer' and is_active order by created_at limit 1;
  select id into v_store from stores where is_active order by code limit 1;
  select id into v_store2 from stores where is_active and id <> v_store order by code limit 1;
  select id, profile_id into v_rider, v_rp from riders where not is_active order by id limit 1;
  select id into v_busy from riders where not is_active and id <> v_rider order by id limit 1;
  if v_adm is null or v_cust is null or v_store is null or v_store2 is null or v_rider is null or v_busy is null then
    raise exception 'PROBE_SETUP_MISSING adm=% cust=% s1=% s2=% rider=% busy=%', v_adm, v_cust, v_store, v_store2, v_rider, v_busy;
  end if;
  update riders set primary_store_id = v_store where id in (v_rider, v_busy);
  update riders set is_active = true where id = v_busy;   -- the "busy" rider must be switched ON for "switch off" to mean anything
  select * into v_before from riders where id = v_rider;

  -- 1. direct UPDATE on riders stays locked for every app role (the reason this function exists)
  ${asRole(null)}
  ${attempt('direct_update_super', `update riders set is_active = true where id = v_rider`)}
  ${owner}

  -- 2. the roles that may edit riders
  ${asRole('delivery_manager')}
  select count(*) into v_audits_before from audit_logs where action = 'rider_updated';
  perform admin_update_rider(v_rider, 'Probe Rider Name', 'bike', 'UP80 PR 0001', v_store2, 2, true);
  ${owner}
  select * into v_after from riders where id = v_rider;
  select full_name into v_name_after from profiles where id = v_rp;
  select count(*) into v_audits_after from audit_logs where action = 'rider_updated';
  r := r || jsonb_build_object('dm_vehicle_type', v_after.vehicle_type, 'dm_vehicle_number', v_after.vehicle_number, 'dm_store_moved', v_after.primary_store_id = v_store2,
    'dm_max', v_after.max_active_deliveries, 'dm_active', v_after.is_active, 'dm_name', v_name_after, 'dm_audit_rows', v_audits_after - v_audits_before);

  -- 2b. an identical call changes nothing and writes no audit row
  ${asRole('delivery_manager')}
  perform admin_update_rider(v_rider, 'Probe Rider Name', 'bike', 'UP80 PR 0001', v_store2, 2, true);
  ${owner}
  select count(*) into v_audits_after from audit_logs where action = 'rider_updated';
  r := r || jsonb_build_object('noop_audit_rows', v_audits_after - v_audits_before);

  -- 2c. NULL means unchanged: only the vehicle number is sent
  ${asRole('delivery_manager')}
  perform admin_update_rider(v_rider, null, null, 'UP80 PR 0002', null, null, null);
  ${owner}
  select * into v_after from riders where id = v_rider;
  r := r || jsonb_build_object('partial_number', v_after.vehicle_number, 'partial_type_kept', v_after.vehicle_type = 'bike', 'partial_max_kept', v_after.max_active_deliveries = 2);

  -- 3. switching off: the rider also goes offline; switching back on does not put them online
  update riders set is_available = true where id = v_rider;
  ${asRole('delivery_manager')}
  perform admin_update_rider(v_rider, p_is_active => false);
  ${owner}
  select * into v_after from riders where id = v_rider;
  r := r || jsonb_build_object('off_active', v_after.is_active, 'off_available', v_after.is_available);
  ${asRole('delivery_manager')}
  perform admin_update_rider(v_rider, p_is_active => true);
  ${owner}
  select * into v_after from riders where id = v_rider;
  r := r || jsonb_build_object('on_active', v_after.is_active, 'on_available', v_after.is_available);

  -- 4. the super admin may too
  ${asRole(null)}
  ${attempt('super_edit', `perform admin_update_rider(v_rider, p_vehicle_type => 'scooter')`)}
  ${owner}

  -- 5. everyone else is refused
  ${['support_agent', 'inventory_manager', 'operations_manager'].map((role) => `${asRole(role)}
  ${attempt(`refused_${role}`, `perform admin_update_rider(v_rider, p_vehicle_type => 'cycle')`)}
  ${owner}`).join('\n  ')}
  ${actAs('v_cust')}
  ${attempt('refused_customer', `perform admin_update_rider(v_rider, p_vehicle_type => 'cycle')`)}
  ${owner}
  select vehicle_type into v_name_after from riders where id = v_rider;
  r := r || jsonb_build_object('type_after_refusals', v_name_after);

  -- 6. validation
  ${asRole('delivery_manager')}
  ${attempt('bad_name', `perform admin_update_rider(v_rider, p_full_name => 'A')`)}
  ${attempt('blank_name', `perform admin_update_rider(v_rider, p_full_name => '   ')`)}
  ${attempt('blank_type', `perform admin_update_rider(v_rider, p_vehicle_type => '  ')`)}
  ${attempt('blank_number', `perform admin_update_rider(v_rider, p_vehicle_number => '')`)}
  ${attempt('max_zero', `perform admin_update_rider(v_rider, p_max_active_deliveries => 0)`)}
  ${attempt('max_eleven', `perform admin_update_rider(v_rider, p_max_active_deliveries => 11)`)}
  ${attempt('unknown_store', `perform admin_update_rider(v_rider, p_primary_store_id => gen_random_uuid())`)}
  ${attempt('unknown_rider', `perform admin_update_rider(gen_random_uuid(), p_vehicle_type => 'bike')`)}
  ${owner}

  -- 7. a rider with a delivery in progress cannot be switched off or moved to another store
  select id into v_order from orders where status = 'delivered' order by created_at limit 1;
  insert into delivery_assignments (order_id, rider_id, store_id, status) values (v_order, v_busy, v_store, 'accepted');
  ${asRole('delivery_manager')}
  ${attempt('off_while_busy', `perform admin_update_rider(v_busy, p_is_active => false)`)}
  ${attempt('store_while_busy', `perform admin_update_rider(v_busy, p_primary_store_id => v_store2)`)}
  ${attempt('rename_while_busy', `perform admin_update_rider(v_busy, p_vehicle_number => 'UP80 BZ 0001')`)}
  ${owner}
  update delivery_assignments set status = 'cancelled' where rider_id = v_busy and status = 'accepted';
  ${asRole('delivery_manager')}
  ${attempt('off_after_cancel', `perform admin_update_rider(v_busy, p_is_active => false)`)}
  ${owner}

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
  console.error('The probe did not report a result:', message.slice(0, 1200));
  process.exit(1);
}
const r = JSON.parse(match[1]);
console.log('probe result:', JSON.stringify(r, null, 1), '\n');

check('direct UPDATE on riders is still locked, even for the super admin', /permission denied for table riders/i.test(r.direct_update_super), r.direct_update_super);
check('a delivery manager can change name, vehicle, number, home store, capacity',
  r.dm_name === 'Probe Rider Name' && r.dm_vehicle_type === 'bike' && r.dm_vehicle_number === 'UP80 PR 0001' && r.dm_store_moved === true && r.dm_max === 2 && r.dm_active === true,
  JSON.stringify([r.dm_name, r.dm_vehicle_type, r.dm_vehicle_number, r.dm_store_moved, r.dm_max, r.dm_active]));
check('the change is audited, once', Number(r.dm_audit_rows) === 1, `${r.dm_audit_rows}`);
check('sending the same values again changes nothing and writes no second audit row', Number(r.noop_audit_rows) === 1, `${r.noop_audit_rows}`);
check('NULL means "leave as it is": only the number changed', r.partial_number === 'UP80 PR 0002' && r.partial_type_kept === true && r.partial_max_kept === true, JSON.stringify([r.partial_number, r.partial_type_kept, r.partial_max_kept]));
check('switching a rider off also takes them offline', r.off_active === false && r.off_available === false, `${r.off_active}/${r.off_available}`);
check('switching a rider back on does not put them online', r.on_active === true && r.on_available === false, `${r.on_active}/${r.on_available}`);
check('the super admin can edit riders too', r.super_edit === 'ALLOWED', r.super_edit);
check('support agent, inventory manager, operations manager and a customer are refused',
  [r.refused_support_agent, r.refused_inventory_manager, r.refused_operations_manager, r.refused_customer].every((m) => /not authorized/i.test(m)),
  [r.refused_support_agent, r.refused_inventory_manager, r.refused_operations_manager, r.refused_customer].join(' | '));
check('and their refused attempts changed nothing', r.type_after_refusals === 'scooter', r.type_after_refusals);
check('a name under 2 characters or blank is rejected', /name must be/i.test(r.bad_name) && /name must be/i.test(r.blank_name), `${r.bad_name} | ${r.blank_name}`);
check('a blank vehicle type or number is rejected', /vehicle type/i.test(r.blank_type) && /vehicle number/i.test(r.blank_number), `${r.blank_type} | ${r.blank_number}`);
check('capacity must be 1 to 10', /between 1 and 10/i.test(r.max_zero) && /between 1 and 10/i.test(r.max_eleven), `${r.max_zero} | ${r.max_eleven}`);
check('an unknown store or rider is rejected', /store not found/i.test(r.unknown_store) && /rider not found/i.test(r.unknown_rider), `${r.unknown_store} | ${r.unknown_rider}`);
check('a rider with a delivery in progress cannot be switched off or moved to another store', /in progress/i.test(r.off_while_busy) && /in progress/i.test(r.store_while_busy), `${r.off_while_busy} | ${r.store_while_busy}`);
check('...but their vehicle number can still be corrected', r.rename_while_busy === 'ALLOWED', r.rename_while_busy);
check('once the delivery is cancelled they can be switched off', r.off_after_cancel === 'ALLOWED', r.off_after_cancel);

const left = (await sql(`select count(*) as n from profiles where full_name = 'Probe Rider Name'`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
