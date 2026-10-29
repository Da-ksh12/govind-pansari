#!/usr/bin/env node
/**
 * Profile creation vs phone verification (migration 20260827000015). Runs the
 * database-level behaviour of Supabase's sign-up flow inside ONE transaction that
 * is rolled back at the end (the probe raises on purpose), so it leaves no data
 * behind even against the live project.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/profile-after-verification.test.mjs
 *
 * What it mimics: GoTrue inserts the auth.users row when a code is REQUESTED (phone
 * still unconfirmed) and sets phone_confirmed_at when the code is verified.
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
  v_phone text := '9199' || lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_phone2 text := '9198' || lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_unverified uuid := gen_random_uuid();
  v_admin_made uuid := gen_random_uuid();
  v_email_user uuid := gen_random_uuid();
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  r jsonb := '{}'::jsonb;
  n int;
begin
  -- 1. A code is requested for a new number: the unconfirmed auth user appears, with NO profile.
  insert into auth.users (id, instance_id, aud, role, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_unverified, v_instance, 'authenticated', 'authenticated', v_phone, '{"provider":"phone","providers":["phone"]}', '{}', now(), now());
  select count(*) into n from profiles where id = v_unverified;
  r := r || jsonb_build_object('profiles_before_verification', n);

  -- 2. The same number cannot become a second auth user (duplicate sign-up).
  begin
    insert into auth.users (id, instance_id, aud, role, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), v_instance, 'authenticated', 'authenticated', v_phone, '{}', '{}', now(), now());
    r := r || jsonb_build_object('duplicate_phone_allowed', true);
  exception when unique_violation then
    r := r || jsonb_build_object('duplicate_phone_allowed', false);
  end;

  -- 3. The correct code is entered: phone_confirmed_at is set -> exactly one profile, with the phone.
  update auth.users set phone_confirmed_at = now() where id = v_unverified;
  select count(*) into n from profiles where id = v_unverified and phone = v_phone;
  r := r || jsonb_build_object('profiles_after_verification', n);

  -- 4. Verifying again / a second sign-in never creates a second profile.
  update auth.users set phone_confirmed_at = now() + interval '1 minute' where id = v_unverified;
  update auth.users set phone_confirmed_at = null where id = v_unverified;
  update auth.users set phone_confirmed_at = now() where id = v_unverified;
  select count(*) into n from profiles where id = v_unverified;
  r := r || jsonb_build_object('profiles_after_repeated_verification', n);

  -- 5. A user created already-confirmed (admin API, seed scripts) still gets its profile at once.
  insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_admin_made, v_instance, 'authenticated', 'authenticated', v_phone2, now(), '{}', '{"full_name":"Probe"}', now(), now());
  select count(*) into n from profiles where id = v_admin_made and full_name = 'Probe';
  r := r || jsonb_build_object('admin_created_confirmed_profiles', n);

  -- 6. Email sign-ups (and the staff-invite flow built on them) are unchanged: profile at insert.
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_email_user, v_instance, 'authenticated', 'authenticated', 'probe-' || substr(md5(random()::text), 1, 8) || '@example.invalid', '{}', '{}', now(), now());
  select count(*) into n from profiles where id = v_email_user;
  r := r || jsonb_build_object('email_user_profiles', n);

  raise exception 'PROBE_RESULT %', r::text;
end $$;
`;

const LIVE_STATE = `
select
  (select count(*) from auth.users u join public.profiles p on p.id = u.id
     where u.phone is not null and u.phone <> '' and u.phone_confirmed_at is null and u.email is null) as unverified_phone_users_with_profile,
  (select count(*) from (select phone from public.profiles where phone is not null group by phone having count(*) > 1) d) as duplicate_profile_phones,
  (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)) as orphan_profiles,
  (select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_phone_confirmed' and not tgisinternal) as confirm_trigger_installed
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
  console.error('The probe did not report a result:', message.slice(0, 400));
  process.exit(1);
}
const r = JSON.parse(match[1]);
console.log('probe result:', JSON.stringify(r), '\n');

check('requesting a code for a new number creates NO profile', r.profiles_before_verification === 0, JSON.stringify(r));
check('the same number cannot be signed up twice', r.duplicate_phone_allowed === false);
check('entering the correct code creates exactly one profile carrying the phone', r.profiles_after_verification === 1);
check('verifying again / signing in again never creates a second profile', r.profiles_after_repeated_verification === 1);
check('users created already confirmed (admin API, seeds) still get their profile immediately', r.admin_created_confirmed_profiles === 1);
check('email sign-ups / staff invites are unchanged (profile at insert)', r.email_user_profiles === 1);

const live = (await sql(LIVE_STATE)).body?.[0] ?? {};
check('the confirmation trigger is installed', Number(live.confirm_trigger_installed) === 1);
check('no unverified phone sign-up has a profile', Number(live.unverified_phone_users_with_profile) === 0, JSON.stringify(live));
check('no two profiles share a phone number', Number(live.duplicate_profile_phones) === 0);
check('every profile has an auth user', Number(live.orphan_profiles) === 0);

const left = (await sql(`select count(*) as n from auth.users where phone like '9199%' and created_at > now() - interval '5 minutes' and phone_confirmed_at is null`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
