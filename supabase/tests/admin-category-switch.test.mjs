#!/usr/bin/env node
/**
 * Migration 20260829000005 (the category on/off switch is audited) against the live database. The migration runs first in the same transaction and
 * everything is rolled back, so this works before and after it is applied.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/admin-category-switch.test.mjs
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
const MIGRATION = readFileSync(resolve(here, '../migrations/20260829000005_admin_set_category_active.sql'), 'utf8');

const actAs = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uid}, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (${uid})::text, true);
  execute 'set local role authenticated';`;
const owner = `execute 'reset role';`;
const attempt = (key, stmt) => `begin ${stmt}; r := r || jsonb_build_object('${key}', 'ALLOWED'); exception when others then r := r || jsonb_build_object('${key}', left(sqlerrm, 140)); end;`;
const asAdmin = (role) => `${owner} update profiles set admin_role = ${role === null ? 'null' : `'${role}'`} where id = v_adm; ${actAs('v_adm')}`;

const PROBE = `
do $probe$
declare
  r jsonb := '{}'::jsonb; v_adm uuid; v_cust uuid; v_cat uuid; v_was boolean; n int;
begin
  select id into v_adm from profiles where role = 'admin' and admin_role is not null order by created_at limit 1;
  select id into v_cust from profiles where role = 'customer' and is_active order by created_at limit 1;
  select id, is_active into v_cat, v_was from categories order by created_at limit 1;
  if v_adm is null or v_cust is null or v_cat is null then raise exception 'PROBE_SETUP_MISSING'; end if;
  update categories set is_active = true where id = v_cat;

  ${asAdmin('inventory_manager')}   -- holds categories.manage
  perform admin_set_category_active(v_cat, false);
  ${owner}
  r := r || jsonb_build_object('off', (select not is_active from categories where id = v_cat),
    'audit_hidden', (select count(*) from audit_logs where action = 'category_hidden' and resource_id = v_cat and created_at > now() - interval '1 minute'),
    'audit_actor_is_admin', (select count(*) from audit_logs where action = 'category_hidden' and resource_id = v_cat and actor_id = v_adm and created_at > now() - interval '1 minute'));
  select count(*) into n from audit_logs where resource_id = v_cat and created_at > now() - interval '1 minute';

  ${asAdmin('inventory_manager')}
  perform admin_set_category_active(v_cat, false);   -- already off: nothing to log
  ${owner}
  r := r || jsonb_build_object('repeat_logged', (select count(*) from audit_logs where resource_id = v_cat and created_at > now() - interval '1 minute') - n);

  ${asAdmin('super_admin')}
  perform admin_set_category_active(v_cat, true);
  ${owner}
  r := r || jsonb_build_object('on', (select is_active from categories where id = v_cat),
    'audit_shown', (select count(*) from audit_logs where action = 'category_shown' and resource_id = v_cat and created_at > now() - interval '1 minute'));

  ${asAdmin('operations_manager')} ${attempt('ops_refused', `perform admin_set_category_active(v_cat, false)`)}
  ${asAdmin('support_agent')} ${attempt('support_refused', `perform admin_set_category_active(v_cat, false)`)}
  ${actAs('v_cust')} ${attempt('customer_refused', `perform admin_set_category_active(v_cat, false)`)}
  ${asAdmin('super_admin')}
  ${attempt('missing', `perform admin_set_category_active(gen_random_uuid(), false)`)}
  ${attempt('null_flag', `perform admin_set_category_active(v_cat, null)`)}
  ${owner}
  r := r || jsonb_build_object('still_on_after_refusals', (select is_active from categories where id = v_cat));

  raise exception 'PROBE_RESULT %', r::text;
end
$probe$;`;

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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

check('a role with categories.manage can switch a category off, and it is off', r.off === true, String(r.off));
check('the switch-off is in the audit log, once, naming the person who did it', Number(r.audit_hidden) === 1 && Number(r.audit_actor_is_admin) === 1, `${r.audit_hidden}/${r.audit_actor_is_admin}`);
check('switching it off again, when it is already off, writes nothing', Number(r.repeat_logged) === 0, String(r.repeat_logged));
check('switching it back on works and is logged', r.on === true && Number(r.audit_shown) === 1, `${r.on}/${r.audit_shown}`);
check('an operations manager, a support agent and a customer are refused', [r.ops_refused, r.support_refused, r.customer_refused].every((m) => /not authorized/i.test(m)), JSON.stringify([r.ops_refused, r.support_refused, r.customer_refused]));
check('a missing category, or no yes/no, is refused — and nothing changed', /category not found/.test(r.missing) && /shown or hidden/.test(r.null_flag) && r.still_on_after_refusals === true, JSON.stringify([r.missing, r.null_flag, r.still_on_after_refusals]));

const left = (await sql(`select count(*) as n from audit_logs where action in ('category_hidden', 'category_shown')`)).body?.[0]?.n;
console.log(`(audit entries of this kind in production: ${left} — a re-run must not add any)`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
