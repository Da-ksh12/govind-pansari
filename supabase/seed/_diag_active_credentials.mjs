#!/usr/bin/env node
// Live, authoritative snapshot of every account that should currently
// be able to log in, across every role — not a memory of what was
// seeded, but what the database actually has right now.
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const STORES = {
  '00000000-0000-0000-0000-000000000103': 'Awas Vikas',
  '00000000-0000-0000-0000-000000000101': 'Sanjay Place',
  '00000000-0000-0000-0000-000000000102': 'Vijay Nagar',
};

async function main() {
  console.log('=== RIDERS (active only) ===');
  const { data: riders, error: rErr } = await admin
    .from('riders')
    .select('id, profile_id, is_active, is_available, primary_store_id, profiles!riders_profile_id_fkey(full_name, phone)')
    .eq('is_active', true)
    .order('primary_store_id');
  if (rErr) console.error(rErr);
  for (const r of riders ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(r.profile_id);
    console.log({
      name: r.profiles?.full_name,
      phone: r.profiles?.phone,
      email: authUser?.user?.email ?? null,
      phoneConfirmed: !!authUser?.user?.phone_confirmed_at,
      emailConfirmed: !!authUser?.user?.email_confirmed_at,
      store: STORES[r.primary_store_id] ?? r.primary_store_id,
      available: r.is_available,
    });
  }

  console.log('\n=== STORE MANAGERS/STAFF (active only) ===');
  const { data: staff, error: sErr } = await admin
    .from('store_staff')
    .select('id, user_id, store_id, role, is_active, profiles!store_staff_user_id_fkey(full_name, phone)')
    .eq('is_active', true)
    .order('store_id');
  if (sErr) console.error(sErr);
  for (const s of staff ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(s.user_id);
    console.log({
      name: s.profiles?.full_name,
      phone: s.profiles?.phone,
      email: authUser?.user?.email ?? null,
      phoneConfirmed: !!authUser?.user?.phone_confirmed_at,
      emailConfirmed: !!authUser?.user?.email_confirmed_at,
      store: STORES[s.store_id] ?? s.store_id,
      role: s.role,
    });
  }

  console.log('\n=== ADMINS ===');
  const { data: admins, error: aErr } = await admin
    .from('profiles')
    .select('id, full_name, phone, role, admin_role')
    .eq('role', 'admin');
  if (aErr) console.error(aErr);
  for (const a of admins ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(a.id);
    console.log({
      name: a.full_name,
      phone: a.phone,
      email: authUser?.user?.email ?? null,
      phoneConfirmed: !!authUser?.user?.phone_confirmed_at,
      emailConfirmed: !!authUser?.user?.email_confirmed_at,
      adminRole: a.admin_role,
    });
  }

  console.log('\n=== A REAL TEST CUSTOMER ===');
  const { data: customers } = await admin
    .from('profiles')
    .select('id, full_name, phone, role')
    .eq('role', 'customer')
    .ilike('full_name', 'Demo Customer%')
    .order('full_name')
    .limit(3);
  for (const c of customers ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(c.id);
    console.log({
      name: c.full_name,
      phone: c.phone,
      email: authUser?.user?.email ?? null,
      phoneConfirmed: !!authUser?.user?.phone_confirmed_at,
    });
  }

  console.log('\n=== sms_test_otp config (which numbers can actually OTP-login) ===');
  // Not queryable via supabase-js — confirmed separately via Management API if needed.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
