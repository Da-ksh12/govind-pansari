#!/usr/bin/env node
/**
 * What each admin role can actually do, checked against the live database — not read from the code. Every write below is a no-op (a column
 * set to its own value, or a row that is rolled back), tried as each admin role with the same database role and JWT claims the apps use,
 * inside ONE transaction that is rolled back at the end (the probe raises on purpose). Nothing is changed.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/admin-role-matrix.test.mjs
 *
 * The expected table is the documented behaviour (docs/roles-and-permissions.md). If a permission, policy or grant is changed on purpose,
 * this fails and names the cell; update EXPECTED and the document together.
 *
 * Needs: one admin account with an admin_role of NULL (the super admin; its role is switched inside the transaction only), a customer with
 * a phone number, and at least one store, rider, category, product, variant, inventory row and feature flag.
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

// Order matters in the expected strings below: owner account (admin_role NULL), super_admin, admin, then the four named roles.
const ROLES = [null, 'super_admin', 'admin', 'operations_manager', 'inventory_manager', 'delivery_manager', 'support_agent'];

// [what, kind, sql]   kind: upd = a write, counted by rows (0 rows = blocked by row-level security);  fn = call a function;  cnt = how many rows are visible
const OPS = [
  ['read: orders', 'cnt', `select count(*) into n from orders`],
  ['read: riders', 'cnt', `select count(*) into n from riders`],
  ['read: customers', 'cnt', `select count(*) into n from profiles where role = 'customer'`],
  ['read: inventory', 'cnt', `select count(*) into n from inventory`],
  ['read: deliveries', 'cnt', `select count(*) into n from delivery_assignments`],
  ['read: audit log rows', 'cnt', `select jsonb_array_length(get_audit_logs(null, 5, null)) into n`],
  ['staff list', 'fn', `perform get_admin_staff_list()`],
  ['product: edit', 'upd', `update products set name = name where id = v_prod`],
  ['variant: edit', 'upd', `update product_variants set sku = sku where id = v_variant`],
  ['category: edit', 'upd', `update categories set name = name where id = v_cat`],
  ['inventory: availability flag', 'upd', `update inventory set is_available = is_available where id = v_inv`],
  ['store: edit phone / address / hours', 'upd', `update stores set phone = phone, opening_time = opening_time, address_line = address_line where id = v_store`],
  ['rider: edit name (profiles)', 'upd', `update profiles set full_name = full_name where id = v_rider_profile`],
  ['rider: direct UPDATE on riders (locked on purpose)', 'upd', `update riders set is_active = is_active where id = v_rider`],
  ['customer: edit name / email (profiles)', 'upd', `update profiles set full_name = full_name where id = v_customer`],
  ['customer: activate / deactivate', 'fn', `perform set_customer_active(v_customer, (select is_active from profiles where id = v_customer))`],
  ['coupon: create', 'upd', `insert into coupons (code, discount_type, discount_value, expires_at) values ('PROBE' || substr(gen_random_uuid()::text, 1, 6), 'flat', 1, now() + interval '1 day')`],
  ['settings: update business info', 'fn', `perform update_app_settings(jsonb_build_object('businessName', (select business_name from app_settings limit 1)))`],
  ['feature flag: toggle', 'fn', `perform set_feature_flag(v_flag_key, v_flag_val)`],
  ['staff: grant an admin role', 'fn', `perform assign_admin_role((select phone from profiles where id = v_customer), 'support_agent')`], // last: it changes the test customer
];

// Y = allowed / sees rows, n = refused / blocked / sees nothing.  Columns: owner(NULL) super_admin admin operations inventory delivery support
const EXPECTED = {
  'read: orders': 'YYYYnYY', // inventory_manager has no orders.view: it sees only its own account's order
  'read: riders': 'YYYYnYY',
  'read: customers': 'YYYYnnY',
  'read: inventory': 'YYYYYnn',
  'read: deliveries': 'YYYYnYY',
  'read: audit log rows': 'YYYnnnn',
  'staff list': 'YYYnnnn',
  'product: edit': 'YYYnYnn',
  'variant: edit': 'YYYnYnn',
  'category: edit': 'YYYnYnn',
  'inventory: availability flag': 'YYYnYnn',
  'store: edit phone / address / hours': 'YYYnnnn',
  'rider: edit name (profiles)': 'YYYnnnn', // profiles are writable by is_admin(), which since 20260829000002 includes the 'admin' role
  'rider: direct UPDATE on riders (locked on purpose)': 'nnnnnnn',
  'customer: edit name / email (profiles)': 'YYYnnnn',
  'customer: activate / deactivate': 'YYYnnnn',
  'coupon: create': 'YYYnnnn', // is_admin() only (so: owner, super_admin, admin) — there is no coupons screen because coupons are not applied at checkout
  'settings: update business info': 'YYYnnnn',
  'feature flag: toggle': 'YYYnnnn',
  'staff: grant an admin role': 'YYYnnnn',
};

const esc = (s) => s.replace(/'/g, "''");
const block = ([key, kind, sql]) => {
  const k = esc(key);
  const fail = `exception when others then res := res || jsonb_build_object('${k}', 'DENIED: ' || left(sqlerrm, 60)); end;`;
  if (kind === 'upd') return `begin ${sql}; get diagnostics n = row_count; res := res || jsonb_build_object('${k}', case when n = 0 then 'BLOCKED' else 'OK' end); ${fail}`;
  if (kind === 'fn') return `begin ${sql}; res := res || jsonb_build_object('${k}', 'OK'); ${fail}`;
  return `begin ${sql}; res := res || jsonb_build_object('${k}', 'sees ' || n); ${fail}`;
};

const perRole = ROLES.map((role) => `
  execute 'reset role';
  update profiles set role = 'customer', admin_role = null where id = v_customer;   -- an earlier role's "grant admin role" must not leak into this one
  update profiles set admin_role = ${role === null ? 'null' : `'${role}'`} where id = v_adm;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  execute 'set local role authenticated';
  res := '{}'::jsonb;
  ${OPS.map(block).join('\n  ')}
  execute 'reset role';
  all_ := all_ || jsonb_build_object('${role ?? 'owner'}', res);`).join('\n');

const PROBE = `do $probe$
declare
  all_ jsonb := '{}'::jsonb; res jsonb; n int;
  v_adm uuid; v_store uuid; v_rider uuid; v_rider_profile uuid; v_customer uuid; v_cat uuid; v_prod uuid; v_variant uuid; v_inv uuid;
  v_flag_key text; v_flag_val boolean;
begin
  select id into v_adm from profiles where role = 'admin' and admin_role is null order by created_at limit 1;
  select id into v_store from stores order by code limit 1;
  select id, profile_id into v_rider, v_rider_profile from riders order by created_at limit 1;
  select p.id into v_customer from profiles p where p.role = 'customer' and p.phone is not null and not exists (select 1 from riders r where r.profile_id = p.id) order by p.created_at limit 1;
  select id into v_cat from categories limit 1;
  select id into v_prod from products limit 1;
  select id into v_variant from product_variants limit 1;
  select id into v_inv from inventory limit 1;
  select key, enabled into v_flag_key, v_flag_val from feature_flags limit 1;
  if v_adm is null or v_store is null or v_rider is null or v_customer is null or v_cat is null or v_prod is null or v_variant is null or v_inv is null or v_flag_key is null then
    raise exception 'PROBE_SETUP_MISSING adm=% store=% rider=% customer=% cat=% prod=% variant=% inv=% flag=%', v_adm, v_store, v_rider, v_customer, v_cat, v_prod, v_variant, v_inv, v_flag_key;
  end if;
  ${perRole}
  raise exception 'PROBE_RESULT %', all_::text;
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

const probe = await sql(PROBE);
const message = String(probe.body?.message ?? '');
const match = message.match(/PROBE_RESULT (\{.*\})/s);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 1200));
  process.exit(1);
}
const result = JSON.parse(match[1]);

// "sees 0", "sees 1" (the admin account's own order) and every refusal count as n.
const yes = (v) => v === 'OK' || (/^sees (\d+)$/.test(v) && Number(v.slice(5)) > 1);
const order = ['owner', 'super_admin', 'admin', 'operations_manager', 'inventory_manager', 'delivery_manager', 'support_agent'];

let passed = 0;
let failed = 0;
for (const [what, expected] of Object.entries(EXPECTED)) {
  const actual = order.map((r) => (yes(result[r]?.[what] ?? '') ? 'Y' : 'n')).join('');
  const ok = actual === expected;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what.padEnd(52)} ${actual}${ok ? '' : `   expected ${expected}`}`);
  ok ? passed++ : failed++;
}
console.log('\ncolumns: owner(NULL) super_admin admin operations inventory delivery support');

const left = (await sql(`select count(*) as n from coupons where code like 'PROBE%'`)).body?.[0]?.n;
const rolled = Number(left) === 0;
console.log(`${rolled ? '  ok ' : 'FAIL '} the probe rolled back and left nothing behind`);
rolled ? passed++ : failed++;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
