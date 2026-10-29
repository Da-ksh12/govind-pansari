#!/usr/bin/env node
/**
 * What a self-registered customer can and cannot do. Public sign-up means anyone can create a customer
 * account, so a brand-new account must be unable to promote itself, edit anyone else, or read other
 * customers' data. Everything runs inside ONE transaction that is rolled back at the end (the probe raises
 * on purpose), so it leaves no data behind even against the live project.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/new-customer-rights.test.mjs
 *
 * The probe registers customer A the way Supabase Auth does (row at "code requested", phone confirmed at
 * "code verified"), then acts as A with the same database role and JWT claims a signed-in app user has.
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

const PROBE = `
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  phone_a text := '9199' || lpad((floor(random() * 1000000))::int::text, 6, '0');
  phone_b text := '9198' || lpad((floor(random() * 1000000))::int::text, 6, '0');
  inst uuid := '00000000-0000-0000-0000-000000000000';
  r jsonb := '{}'::jsonb;
  n int;
  t text;
  denied text;
begin
  -- A registers: a code is requested (unconfirmed row), then verified. B is another existing customer.
  insert into auth.users (id, instance_id, aud, role, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, inst, 'authenticated', 'authenticated', phone_a, '{"provider":"phone","providers":["phone"]}', '{}', now(), now());
  update auth.users set phone_confirmed_at = now() where id = a;
  insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (b, inst, 'authenticated', 'authenticated', phone_b, now(), '{}', '{"full_name":"Other Customer"}', now(), now());

  r := r || jsonb_build_object(
    'new_role', (select role::text from public.profiles where id = a),
    'new_is_active', (select is_active from public.profiles where id = a),
    'new_admin_role', (select admin_role::text from public.profiles where id = a),
    'new_has_name', (select coalesce(trim(full_name), '') <> '' from public.profiles where id = a));

  -- From here on we are A: the 'authenticated' database role with A's JWT claims.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.profiles where id = a;
  r := r || jsonb_build_object('own_profile_visible', n);
  select count(*) into n from public.profiles where id = b;
  r := r || jsonb_build_object('other_profile_visible', n);
  select count(*) into n from public.profiles;
  r := r || jsonb_build_object('profiles_visible_total', n);

  -- The welcome screen's save: A sets their own name.
  update public.profiles set full_name = 'New Customer' where id = a;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('own_name_update_rows', n);
  update public.profiles set full_name = 'Hacked' where id = b;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('other_name_update_rows', n);

  -- Self-promotion attempts: each must raise or change nothing.
  foreach t in array array['role', 'admin_role', 'is_active', 'phone'] loop
    begin
      if t = 'role' then update public.profiles set role = 'admin' where id = a;
      elsif t = 'admin_role' then update public.profiles set admin_role = 'super_admin' where id = a;
      elsif t = 'is_active' then update public.profiles set is_active = false where id = a;
      else update public.profiles set phone = '9100000000' where id = a;
      end if;
      get diagnostics n = row_count;
      r := r || jsonb_build_object('update_' || t, case when n = 0 then 'no_rows' else 'ALLOWED' end);
    exception when insufficient_privilege then
      r := r || jsonb_build_object('update_' || t, 'blocked');
    end;
  end loop;

  -- A cannot create a profile for someone else / a second profile.
  begin
    insert into public.profiles (id, phone, role) values (gen_random_uuid(), '9100000001', 'admin');
    r := r || jsonb_build_object('insert_profile', 'ALLOWED');
  exception when others then
    r := r || jsonb_build_object('insert_profile', 'blocked');
  end;

  -- Staff / admin surfaces refuse a customer. 'missing' would mean the probe is wrong, not the app.
  -- current_admin_context() answers "null" (no admin context) rather than raising.
  r := r || jsonb_build_object('admin_context_is_null', (select current_admin_context() is null));
  foreach t in array array['get_admin_dashboard()', 'get_rider_dashboard()'] loop
    begin
      execute 'select ' || t;
      denied := 'ALLOWED';
    exception when undefined_function then denied := 'missing';
              when others then denied := 'denied';
    end;
    r := r || jsonb_build_object('rpc_' || split_part(t, '(', 1), denied);
  end loop;

  -- Other customers' private data is invisible: A has no orders/addresses/notifications of their own,
  -- so any row that shows up belongs to somebody else.
  foreach t in array array['orders', 'addresses', 'notifications', 'carts', 'wishlist_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      r := r || jsonb_build_object('visible_' || t, n);
    end if;
  end loop;

  -- Read back as the table owner what A could not change.
  execute 'reset role';
  r := r || jsonb_build_object(
    'final_role', (select role::text from public.profiles where id = a),
    'final_is_active', (select is_active from public.profiles where id = a),
    'final_admin_role', (select admin_role::text from public.profiles where id = a),
    'final_phone_unchanged', (select phone = phone_a from public.profiles where id = a),
    'final_name', (select full_name from public.profiles where id = a),
    'b_name', (select full_name from public.profiles where id = b));

  raise exception 'PROBE_RESULT %', r::text;
end $$;
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
const match = message.match(/PROBE_RESULT (\{.*?\})(?:\\n|\n|$)/);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 600));
  process.exit(1);
}
const r = JSON.parse(match[1]);
console.log('probe result:', JSON.stringify(r), '\n');

check('a self-registered account is an ordinary active customer with no admin role', r.new_role === 'customer' && r.new_is_active === true && r.new_admin_role === null, JSON.stringify(r));
check('a self-registered account starts without a name (the app then shows the welcome screen)', r.new_has_name === false);
check('they can read their own profile, and only their own', r.own_profile_visible === 1 && r.other_profile_visible === 0 && r.profiles_visible_total === 1, `own=${r.own_profile_visible} other=${r.other_profile_visible} total=${r.profiles_visible_total}`);
check('they can save their own name (welcome screen)', r.own_name_update_rows === 1 && r.final_name === 'New Customer');
check("they cannot edit another customer's profile", r.other_name_update_rows === 0 && r.b_name === 'Other Customer');
for (const col of ['role', 'admin_role', 'is_active', 'phone']) {
  check(`they cannot change their own ${col}`, ['blocked', 'no_rows'].includes(r[`update_${col}`]), String(r[`update_${col}`]));
}
check('role, admin role, status and phone are unchanged afterwards', r.final_role === 'customer' && r.final_admin_role === null && r.final_is_active === true && r.final_phone_unchanged === true);
check('they cannot create profiles', r.insert_profile === 'blocked');
check('current_admin_context() gives a customer no admin context', r.admin_context_is_null === true, String(r.admin_context_is_null));
for (const fn of ['get_admin_dashboard', 'get_rider_dashboard']) {
  check(`${fn}() refuses a customer`, r[`rpc_${fn}`] === 'denied', String(r[`rpc_${fn}`]));
}
for (const table of ['orders', 'addresses', 'notifications', 'carts', 'wishlist_items']) {
  if (`visible_${table}` in r) check(`no other customer's ${table} are visible`, r[`visible_${table}`] === 0, `visible=${r[`visible_${table}`]}`);
}

const left = (await sql(`select count(*) as n from auth.users where phone like '9199%' and created_at > now() - interval '5 minutes' and phone_confirmed_at is not null`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
