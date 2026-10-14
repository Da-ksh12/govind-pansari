#!/usr/bin/env node
// TEMPORARY diagnostic — not part of the seed pipeline. Prints the
// live rider and store-manager roster so we can plan the reduction
// from the actual current state, not from seed-script archaeology.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: stores } = await admin.from('stores').select('id, name, is_active').order('name');
  console.log('=== STORES ===');
  console.table(stores);

  const { data: riders, error: rErr } = await admin
    .from('riders')
    .select('id, profile_id, vehicle_type, vehicle_number, is_active, is_available, primary_store_id, profiles!riders_profile_id_fkey(full_name, phone)')
    .order('primary_store_id');
  if (rErr) console.error('riders error', rErr);
  console.log('\n=== RIDERS ===');
  console.table((riders ?? []).map((r) => ({
    riderId: r.id,
    profileId: r.profile_id,
    name: r.profiles?.full_name,
    phone: r.profiles?.phone,
    store: stores?.find((s) => s.id === r.primary_store_id)?.name ?? r.primary_store_id,
    active: r.is_active,
    available: r.is_available,
    vehicle: r.vehicle_type,
  })));

  const { data: staff, error: sErr } = await admin
    .from('store_staff')
    .select('id, user_id, store_id, role, is_active, profiles!store_staff_user_id_fkey(full_name, phone)')
    .order('store_id');
  if (sErr) console.error('store_staff error', sErr);
  console.log('\n=== STORE STAFF (all roles) ===');
  console.table((staff ?? []).map((s) => ({
    id: s.id,
    userId: s.user_id,
    name: s.profiles?.full_name,
    phone: s.profiles?.phone,
    store: stores?.find((st) => st.id === s.store_id)?.name ?? s.store_id,
    role: s.role,
    active: s.is_active,
  })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
