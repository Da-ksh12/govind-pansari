#!/usr/bin/env node
/**
 * Client-requested final roster reduction, on top of
 * 05_seed_final_rider_manager_roster.mjs's 10-rider / 2-manager-per-store
 * state:
 *
 *   - Riders: 10 -> 5 total, named Ravi / Praveen / Ranjeet / Raju / Sunil
 *     (3 kept at Vijay Nagar, 2 at Awas Vikas — the other 5 accounts are
 *     DEACTIVATED, not deleted, so past delivery_assignments history
 *     referencing them stays intact).
 *   - Store managers: exactly 1 per real operational store —
 *     Pooja at Vijay Nagar, Shikha at Awas Vikas. The second manager at
 *     each store is deactivated (store_staff.is_active = false), same
 *     reasoning (keeps any audit-log/order history intact).
 *
 * Renames only touch profiles.full_name + the auth user's
 * user_metadata.full_name (the display name everywhere in the app) —
 * login phone/email/password are untouched, so these are still the same
 * demo accounts, just relabeled + trimmed to the real headcount.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/06_final_roster_reduction.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
  process.exit(1);
}
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function renameProfile(profileId, fullName) {
  const { data: profile, error: pErr } = await admin.from('profiles').select('id, full_name').eq('id', profileId).single();
  if (pErr) throw pErr;
  await admin.from('profiles').update({ full_name: fullName }).eq('id', profileId);
  const { data: authUser } = await admin.auth.admin.getUserById(profileId);
  if (authUser?.user) {
    await admin.auth.admin.updateUserById(profileId, { user_metadata: { ...authUser.user.user_metadata, full_name: fullName } });
  }
  return { before: profile?.full_name, after: fullName };
}

async function main() {
  console.log('--- Renaming + keeping 5 riders ---');
  const KEEP_RIDERS = [
    { riderId: '94f7a86e-a2e2-4147-9a78-3368c2a4b901', profileId: '36a4485b-c437-4e47-b00c-aad7bb9826aa', name: 'Ravi' },    // was Demo Rider 05, Vijay Nagar
    { riderId: 'b78d0361-75b7-4c1c-bb39-f94ff726536d', profileId: 'f189f159-87e0-4568-97b1-30edfcc6984a', name: 'Praveen' }, // was Demo Rider 01, Vijay Nagar
    { riderId: '3f883f28-1c8a-481a-9d55-9675997c0044', profileId: '56ddefeb-b0b2-48a8-b31c-a1dd585e1af3', name: 'Ranjeet' }, // was Demo Rider 06, Vijay Nagar
    { riderId: '66f27703-8ed7-4358-9981-2e958a1f02e1', profileId: '41a36b26-3dcc-4f36-8adc-95af5eb1c78c', name: 'Raju' },    // was Demo Rider 04, Awas Vikas
    { riderId: '52d809cb-4896-403d-b29f-b316ec1133ab', profileId: '8eabc321-cdaf-49ba-855d-dc7d8cbf993a', name: 'Sunil' },   // was Demo Rider 08, Awas Vikas
  ];
  for (const r of KEEP_RIDERS) {
    const { before, after } = await renameProfile(r.profileId, r.name);
    await admin.from('riders').update({ is_active: true, is_available: true }).eq('id', r.riderId);
    console.log(`  kept   ${r.riderId}  "${before}" -> "${after}"`);
  }

  console.log('\n--- Deactivating 5 excess riders ---');
  const DEACTIVATE_RIDER_IDS = [
    '9442fd79-eb6f-4a42-9077-9ff78c6c39d1', // Demo Rider 03, Vijay Nagar
    '425d95e5-3311-49c9-ad2d-1315e922d8b6', // Demo Rider (919000000202), Vijay Nagar
    'abf76e9d-4b59-48fd-8dbf-7232adfb02c2', // Demo Rider Two, Awas Vikas
    '19c78b5a-7f9b-4097-8d37-fe41586eee79', // Demo Rider 02, Awas Vikas
    'ad5d48c5-cc69-46f2-b468-1da3d2e6719f', // Demo Rider 07, Awas Vikas
  ];
  for (const riderId of DEACTIVATE_RIDER_IDS) {
    await admin.from('riders').update({ is_active: false, is_available: false }).eq('id', riderId);
    console.log(`  deactivated rider ${riderId}`);
  }

  console.log('\n--- Renaming + keeping 1 manager per store ---');
  const KEEP_MANAGERS = [
    { storeStaffId: '07ab835d-717b-4316-9472-483f9366e2e6', profileId: '71c603cd-851d-4ef2-b46f-241bf5efe0fc', name: 'Pooja', store: 'Vijay Nagar' },
    { storeStaffId: '123ca7be-9763-49f5-98d8-bbcf1288ac46', profileId: 'd64de75c-9c3d-4625-b650-bbcd22685480', name: 'Shikha', store: 'Awas Vikas' },
  ];
  for (const m of KEEP_MANAGERS) {
    const { before, after } = await renameProfile(m.profileId, m.name);
    await admin.from('store_staff').update({ is_active: true }).eq('id', m.storeStaffId);
    console.log(`  kept   ${m.store} manager "${before}" -> "${after}"`);
  }

  console.log('\n--- Deactivating the 2nd manager at each store ---');
  const DEACTIVATE_STORE_STAFF_IDS = [
    'e6f77a66-1ad0-4776-9517-2fe0abd10141', // Demo Store Manager 2 (Vijay Nagar)
    '93b96f5f-9168-41f2-ac6c-18da08ca1032', // Demo Store Manager 2 (Awas Vikas)
  ];
  for (const id of DEACTIVATE_STORE_STAFF_IDS) {
    await admin.from('store_staff').update({ is_active: false }).eq('id', id);
    console.log(`  deactivated store_staff ${id}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
