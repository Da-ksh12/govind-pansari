#!/usr/bin/env node
/**
 * Final pre-launch QA hardening: 20 real demo customer accounts + 5
 * real demo rider accounts, created through the actual Supabase Auth
 * architecture — same admin.createUser() pattern as
 * 02_seed_demo_accounts.mjs, not fake/local/frontend-only users.
 *
 * These log in through the app's REAL phone-OTP screen exactly like a
 * genuine customer/rider would. Their phone numbers were added to the
 * project's Auth > sms_test_otp config (via the Supabase Management
 * API, additively — the 9 pre-existing numbers every test suite in
 * supabase/tests/ depends on were left untouched) so OTP verification
 * actually succeeds without a real SMS provider. This is Supabase's
 * own official test-OTP mechanism, not a bypass of auth.
 *
 * Phone ranges (clearly out of the way of every existing fixture, and
 * self-describing):
 *   Customers: +919000001001 .. +919000001020
 *   Riders:    +919000001101 .. +919000001105
 *
 * Marked as demo/QA via full_name ("Demo Customer NN" / "Demo Rider N")
 * — the same marker convention 02_seed_demo_accounts.mjs already
 * established, so they're trivially findable/removable later:
 *   delete from profiles where full_name like 'Demo Customer %' or full_name like 'Demo Rider %';
 * (auth.users rows need admin.auth.admin.deleteUser() per user — see
 * the commented cleanup snippet at the bottom of this file.)
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/04_seed_qa_demo_users.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Real stores — split riders/customers roughly evenly across both so
// realtime stress-testing (section 15/33) actually exercises both
// stores, not just one.
const VIJAY_NAGAR = '00000000-0000-0000-0000-000000000102';
const AWAS_VIKAS = '00000000-0000-0000-0000-000000000103';

async function upsertDemoUser({ email, password, fullName, phone }) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { full_name: fullName },
  });
  // email_exists: this script re-run. phone_exists: e.g. the phone was
  // already used for a real OTP verify (auto-signs up on first verify,
  // same as any genuine customer's first login) before this script ran
  // — happened live for 919000001001 during test-OTP setup. Either way,
  // find and reuse the existing account rather than fail.
  if (error && error.code !== 'email_exists' && error.code !== 'phone_exists') throw error;
  if (created?.user) return created.user;

  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 500 });
  if (listError) throw listError;
  const normalizedPhone = phone.replace(/^\+/, '');
  const existing = list.users.find((u) => u.email === email || u.phone === normalizedPhone);
  if (!existing) throw new Error(`Could not find or create ${email} / ${phone}`);
  // Reused account may predate this seed (e.g. auto-signed-up via a
  // bare OTP verify, which creates auth.users with no metadata at all)
  // — bring it in line: full_name + email if missing. Note
  // handle_new_auth_user() only copies user_metadata.full_name into
  // profiles.full_name on INSERT, never on a later UPDATE, so the
  // profiles row needs its own direct patch too, not just auth.users.
  const patch = {};
  if (existing.user_metadata?.full_name !== fullName) patch.user_metadata = { ...existing.user_metadata, full_name: fullName };
  if (!existing.email) patch.email = email;
  if (Object.keys(patch).length > 0) {
    await admin.auth.admin.updateUserById(existing.id, patch);
  }
  await admin.from('profiles').update({ full_name: fullName }).eq('id', existing.id);
  return existing;
}

async function main() {
  const customers = [];
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(2, '0');
    const user = await upsertDemoUser({
      email: `demo.customer${n}@govindpansari.dev`,
      password: 'GovindDemo123!',
      fullName: `Demo Customer ${n}`,
      phone: `+919000001${String(i).padStart(3, '0')}`,
    });
    customers.push(user);
  }

  const riders = [];
  for (let i = 1; i <= 5; i++) {
    const n = String(i).padStart(2, '0');
    const user = await upsertDemoUser({
      email: `demo.rider${n}.qa@govindpansari.dev`,
      password: 'GovindDemo123!',
      fullName: `Demo Rider ${n}`,
      phone: `+91900000110${i}`,
    });
    riders.push(user);
  }

  // handle_new_auth_user() already created a `profiles` row for each —
  // customers keep the default 'customer' role (no change needed);
  // riders need role='rider' + a riders table row, same as the
  // existing demo riders in 02_seed_demo_accounts.mjs.
  for (const r of riders) {
    await admin.from('profiles').update({ role: 'rider' }).eq('id', r.id);
  }

  const riderRows = riders.map((r, i) => ({
    profile_id: r.id,
    vehicle_type: i % 2 === 0 ? 'scooter' : 'bike',
    vehicle_number: `UP80 QA ${1000 + i}`,
    is_active: true,
    is_available: true,
    primary_store_id: i % 2 === 0 ? VIJAY_NAGAR : AWAS_VIKAS,
  }));
  await admin.from('riders').upsert(riderRows, { onConflict: 'profile_id' });

  console.log(`Seeded ${customers.length} demo customers (+919000001001..020) and ${riders.length} demo riders (+919000001101..105).`);
  console.log('All use password GovindDemo123! for staff-login fallback, but the real login path for these is phone OTP (code 123456) via the app\'s normal Login screen — same as every existing demo account.');
  console.log('\nRider -> store assignment:');
  riderRows.forEach((r, i) => console.log(`  ${riders[i].user_metadata?.full_name ?? riders[i].email} -> ${r.primary_store_id === VIJAY_NAGAR ? 'Vijay Nagar' : 'Awas Vikas'}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------------
// Cleanup before production (see report) — not run automatically:
//
//   const { data } = await admin.from('profiles').select('id').or("full_name.like.Demo Customer %,full_name.like.Demo Rider %");
//   for (const row of data) await admin.auth.admin.deleteUser(row.id);
//
// Also revert supabase/seed's sms_test_otp addition via the Management
// API (PATCH /v1/projects/{ref}/config/auth) back to the 9 original
// entries, or simply leave it — unused test-OTP numbers with no SMS
// provider configured cannot be exploited to receive real messages.
// ---------------------------------------------------------------------
