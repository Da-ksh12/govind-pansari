#!/usr/bin/env node
/**
 * Final client-handover roster: 5 riders + 2 store managers at EACH
 * real operational store (Vijay Nagar, Awas Vikas), on explicit client
 * request. Same admin.createUser() pattern as
 * 02_seed_demo_accounts.mjs / 04_seed_qa_demo_users.mjs — reuses the
 * existing 7-rider / 3-manager pool where possible and only creates
 * the accounts genuinely missing to reach 5+5 riders and 2+2 managers,
 * rather than duplicating what already exists.
 *
 * Phone ranges (new numbers only — everything else already existed
 * and was already registered in sms_test_otp):
 *   New riders:   +919000001106 .. +919000001108
 *   New managers: +919000000207 (Vijay Nagar), +919000000208 (Awas Vikas)
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/05_seed_final_rider_manager_roster.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const VIJAY_NAGAR = '00000000-0000-0000-0000-000000000102';
const AWAS_VIKAS = '00000000-0000-0000-0000-000000000103';

async function upsertDemoUser({ email, password, fullName, phone }) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, phone, email_confirm: true, phone_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error && error.code !== 'email_exists' && error.code !== 'phone_exists') throw error;
  if (created?.user) return created.user;

  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 500 });
  if (listError) throw listError;
  const normalizedPhone = phone.replace(/^\+/, '');
  const existing = list.users.find((u) => u.email === email || u.phone === normalizedPhone);
  if (!existing) throw new Error(`Could not find or create ${email} / ${phone}`);
  const patch = {};
  if (existing.user_metadata?.full_name !== fullName) patch.user_metadata = { ...existing.user_metadata, full_name: fullName };
  if (!existing.email) patch.email = email;
  if (Object.keys(patch).length > 0) await admin.auth.admin.updateUserById(existing.id, patch);
  await admin.from('profiles').update({ full_name: fullName }).eq('id', existing.id);
  return existing;
}

async function main() {
  // --- New riders (3 needed: existing pool was 4 at Vijay Nagar / 3 at Awas Vikas = 7 total) ---
  const newRiders = [];
  for (const n of [6, 7, 8]) {
    const user = await upsertDemoUser({
      email: `demo.rider${String(n).padStart(2, '0')}.qa@govindpansari.dev`,
      password: 'GovindDemo123!',
      fullName: `Demo Rider ${String(n).padStart(2, '0')}`,
      phone: `+91900000110${n}`,
    });
    await admin.from('profiles').update({ role: 'rider' }).eq('id', user.id);
    newRiders.push(user);
  }

  // --- New store managers (1 per store — existing pool had exactly 1 manager per store) ---
  const vnManager2 = await upsertDemoUser({
    email: 'demo.manager3.vijaynagar@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Store Manager 2 (Vijay Nagar)',
    phone: '+919000000207',
  });
  await admin.from('profiles').update({ role: 'store_manager' }).eq('id', vnManager2.id);

  const avManager2 = await upsertDemoUser({
    email: 'demo.manager3.awasvikas@govindpansari.dev',
    password: 'GovindDemo123!',
    fullName: 'Demo Store Manager 2 (Awas Vikas)',
    phone: '+919000000208',
  });
  await admin.from('profiles').update({ role: 'store_manager' }).eq('id', avManager2.id);

  await admin.from('store_staff').upsert(
    [
      { user_id: vnManager2.id, store_id: VIJAY_NAGAR, role: 'store_manager', is_active: true },
      { user_id: avManager2.id, store_id: AWAS_VIKAS, role: 'store_manager', is_active: true },
    ],
    { onConflict: 'user_id,store_id' },
  );

  // --- Rebalance the FULL rider roster (7 existing + 3 new = 10) to exactly 5/5 ---
  // Existing rider profile ids, keyed by phone (from the live roster
  // audited before this script was written) — kept stable, only
  // primary_store_id/availability are normalized here.
  const EXISTING_RIDER_PROFILE_ID_BY_PHONE = {
    '919000000202': '425d95e5-3311-49c9-ad2d-1315e922d8b6', // Demo Rider
    '919000000206': 'abf76e9d-4b59-48fd-8dbf-7232adfb02c2', // Demo Rider Two
    '919000001101': 'b78d0361-75b7-4c1c-bb39-f94ff726536d', // Demo Rider 01
    '919000001102': '19c78b5a-7f9b-4097-8d37-fe41586eee79', // Demo Rider 02
    '919000001103': '9442fd79-eb6f-4a42-9077-9ff78c6c39d1', // Demo Rider 03
    '919000001104': '66f27703-8ed7-4358-9981-2e958a1f02e1', // Demo Rider 04
    '919000001105': '94f7a86e-a2e2-4147-9a78-3368c2a4b901', // Demo Rider 05
  };

  // Final assignment: 5 at Vijay Nagar, 5 at Awas Vikas, all active + available.
  const FINAL_ASSIGNMENT = [
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000000202'], store: VIJAY_NAGAR },
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000001101'], store: VIJAY_NAGAR },
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000001103'], store: VIJAY_NAGAR },
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000001105'], store: VIJAY_NAGAR },
    { profileId: newRiders[0].id, store: VIJAY_NAGAR, vehicle: 'scooter', plate: 'UP80 QA 1006' },

    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000000206'], store: AWAS_VIKAS },
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000001102'], store: AWAS_VIKAS },
    { riderId: EXISTING_RIDER_PROFILE_ID_BY_PHONE['919000001104'], store: AWAS_VIKAS },
    { profileId: newRiders[1].id, store: AWAS_VIKAS, vehicle: 'bike', plate: 'UP80 QA 1007' },
    { profileId: newRiders[2].id, store: AWAS_VIKAS, vehicle: 'scooter', plate: 'UP80 QA 1008' },
  ];

  for (const a of FINAL_ASSIGNMENT) {
    if (a.riderId) {
      // Existing riders table row — just move/normalize it.
      await admin.from('riders').update({ primary_store_id: a.store, is_active: true, is_available: true }).eq('id', a.riderId);
    } else {
      // New rider — no riders row yet.
      await admin.from('riders').upsert(
        { profile_id: a.profileId, vehicle_type: a.vehicle, vehicle_number: a.plate, is_active: true, is_available: true, primary_store_id: a.store, max_active_deliveries: 1 },
        { onConflict: 'profile_id' },
      );
    }
  }

  console.log('Final roster seeded/rebalanced.');
  console.log('New riders:', newRiders.map((r) => `${r.user_metadata?.full_name} (${r.phone})`).join(', '));
  console.log('New managers:', `${vnManager2.user_metadata?.full_name} (${vnManager2.phone}) -> Vijay Nagar`, '|', `${avManager2.user_metadata?.full_name} (${avManager2.phone}) -> Awas Vikas`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
