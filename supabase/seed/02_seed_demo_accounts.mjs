#!/usr/bin/env node
/**
 * Creates DEVELOPMENT demo accounts (one customer, one rider, one store
 * manager) and links them into the schema seeded by
 * 01_catalogue_and_stores.sql.
 *
 * Deliberately a script, not raw SQL: auth.users is owned by GoTrue
 * (Supabase Auth), and the supported way to create a user server-side
 * is the Admin API (supabase.auth.admin.createUser), not a hand-rolled
 * INSERT into auth.users.
 *
 * Requires the SERVICE ROLE key — run this locally only, never ship it,
 * never run it from the mobile app.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/02_seed_demo_accounts.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000101'; // Sanjay Place
const OTHER_STORE_ID = '00000000-0000-0000-0000-000000000102'; // Vijay Nagar — for cross-store access tests

async function upsertDemoUser({ email, password, fullName, phone }) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error && !error.message?.includes('already been registered')) throw error;
  if (created?.user) return created.user;

  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw new Error(`Could not find or create ${email}`);
  return existing;
}

async function main() {
  const customer = await upsertDemoUser({
    email: 'demo.customer@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Customer',
    phone: '+919000000201',
  });

  const rider = await upsertDemoUser({
    email: 'demo.rider@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Rider',
    phone: '+919000000202',
  });

  const manager = await upsertDemoUser({
    email: 'demo.manager@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Store Manager',
    phone: '+919000000203',
  });

  // Phase 07: a plain staff member (not a manager) at the same store,
  // and a manager of a *different* store — needed to actually test the
  // "Store Manager A cannot access Store B" / "staff vs manager
  // privilege" boundaries (section 42/57), which a single demo
  // manager account can't exercise on its own.
  const staff = await upsertDemoUser({
    email: 'demo.staff@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Store Staff',
    phone: '+919000000204',
  });

  const otherManager = await upsertDemoUser({
    email: 'demo.manager2@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Store Manager (Vijay Nagar)',
    phone: '+919000000205',
  });

  // Phase 08: a second rider at the same store — needed for real
  // assignment-race tests (two riders competing for one order,
  // section 61), which a single demo rider account can't exercise.
  const rider2 = await upsertDemoUser({
    email: 'demo.rider2@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Rider Two',
    phone: '+919000000206',
  });

  // handle_new_auth_user() already created a `profiles` row for each —
  // update roles and link the rider/store_staff rows.
  await admin.from('profiles').update({ role: 'rider' }).eq('id', rider.id);
  await admin.from('profiles').update({ role: 'store_manager' }).eq('id', manager.id);
  await admin.from('profiles').update({ role: 'staff' }).eq('id', staff.id);
  await admin.from('profiles').update({ role: 'store_manager' }).eq('id', otherManager.id);
  await admin.from('profiles').update({ role: 'rider' }).eq('id', rider2.id);

  await admin.from('riders').upsert(
    [
      { profile_id: rider.id, vehicle_type: 'scooter', vehicle_number: 'UP80 XX 1234', is_active: true, is_available: true, primary_store_id: DEMO_STORE_ID },
      { profile_id: rider2.id, vehicle_type: 'bike', vehicle_number: 'UP80 XX 5678', is_active: true, is_available: true, primary_store_id: DEMO_STORE_ID },
    ],
    { onConflict: 'profile_id' }
  );

  await admin.from('store_staff').upsert(
    [
      { user_id: manager.id, store_id: DEMO_STORE_ID, role: 'store_manager', is_active: true },
      { user_id: staff.id, store_id: DEMO_STORE_ID, role: 'staff', is_active: true },
      { user_id: otherManager.id, store_id: OTHER_STORE_ID, role: 'store_manager', is_active: true },
    ],
    { onConflict: 'user_id,store_id' }
  );

  console.log('Seeded demo accounts:');
  console.log('  customer:      ', customer.email, customer.id);
  console.log('  rider:         ', rider.email, rider.id, '-> store', DEMO_STORE_ID);
  console.log('  rider2:        ', rider2.email, rider2.id, '-> store', DEMO_STORE_ID);
  console.log('  manager:       ', manager.email, manager.id, '-> store', DEMO_STORE_ID);
  console.log('  staff:         ', staff.email, staff.id, '-> store', DEMO_STORE_ID);
  console.log('  manager2:      ', otherManager.email, otherManager.id, '-> store', OTHER_STORE_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
