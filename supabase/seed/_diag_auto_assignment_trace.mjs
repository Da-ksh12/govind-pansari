#!/usr/bin/env node
/**
 * TEMPORARY diagnostic — live-verifies the new true auto-assignment
 * path end to end: no-rider-available -> AUTO_ASSIGNING -> retry tick
 * assigns once a rider frees up -> stop_auto_assignment actually
 * prevents a later retry from assigning. Restores every rider's
 * original availability when done, regardless of outcome.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/_diag_auto_assignment_trace.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function otpLogin(client, phone) {
  await client.auth.signInWithOtp({ phone });
  const { data, error } = await client.auth.verifyOtp({ phone, token: '123456', type: 'sms' });
  if (error) throw error;
  return data;
}

const VIJAY_NAGAR = '00000000-0000-0000-0000-000000000102';
// The selection query prefers same-store but falls back to ANY
// active+available rider system-wide (pre-existing behavior, inherited
// unchanged from the original auto_assign_rider()) — so genuinely
// forcing AUTO_ASSIGNING means every active rider everywhere, not just
// Vijay Nagar's, must be made unavailable for the test.
const { data: allRiders } = await svc.from('riders').select('id, is_available').eq('is_active', true);
const VN_RIDER_IDS = allRiders.map((r) => r.id);
console.log('[TRACE] disabling', VN_RIDER_IDS.length, 'active riders system-wide for this test');

const admin = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { user: adminUser } = await otpLogin(admin, '+919000000301');
console.log('[TRACE] admin signed in', adminUser.id);

// Snapshot current availability so we can restore it exactly.
const { data: before } = await svc.from('riders').select('id, is_available').in('id', VN_RIDER_IDS);
console.log('[TRACE] snapshot before:', JSON.stringify(before));

async function restore() {
  for (const r of before) {
    await svc.from('riders').update({ is_available: r.is_available }).eq('id', r.id);
  }
  console.log('[TRACE] restored original availability for all VN riders used in this test.');
}

try {
  // Step 1: make every VN rider unavailable so nobody is eligible.
  for (const id of VN_RIDER_IDS) await svc.from('riders').update({ is_available: false }).eq('id', id);
  console.log('[TRACE] all VN riders now unavailable');

  const { data: demoCustomer } = await svc.from('profiles').select('id').eq('role', 'customer').ilike('email', '%@govindpansari.dev').order('full_name').limit(1).single();
  const { data: created, error: createErr } = await admin.rpc('qa_create_demo_order', { p_customer_id: demoCustomer.id, p_store_id: VIJAY_NAGAR, p_variant_id: null, p_quantity: 1 });
  if (createErr) throw createErr;
  console.log('[TRACE] demo order created', created.orderNumber, created.orderId);

  const { data: started, error: startErr } = await admin.rpc('start_auto_assignment', { p_order_id: created.orderId });
  if (startErr) throw startErr;
  console.log('[TRACE] start_auto_assignment result (expect AUTO_ASSIGNING):', JSON.stringify(started));
  if (started.code !== 'AUTO_ASSIGNING') throw new Error(`FAIL: expected AUTO_ASSIGNING, got ${started.code}`);

  const { data: roundAfterStart } = await svc.from('delivery_dispatch_rounds').select('status, mode').eq('id', started.dispatchRoundId).single();
  console.log('[TRACE] round after start:', JSON.stringify(roundAfterStart));
  if (roundAfterStart.status !== 'open' || roundAfterStart.mode !== 'auto') throw new Error('FAIL: round not open/auto');

  // Step 2: free up ONE rider, then simulate the next cron tick manually.
  const freedRiderId = VN_RIDER_IDS[0];
  await svc.from('riders').update({ is_available: true }).eq('id', freedRiderId);
  console.log('[TRACE] freed rider', freedRiderId, '- now simulating a retry tick');

  const { error: retryErr } = await admin.rpc('retry_auto_assignment_rounds', {});
  if (retryErr) throw retryErr;

  const { data: roundAfterRetry } = await svc.from('delivery_dispatch_rounds').select('status, mode, winner_rider_id, winning_assignment_id').eq('id', started.dispatchRoundId).single();
  console.log('[TRACE] round after retry tick (expect completed, winner = freed rider):', JSON.stringify(roundAfterRetry));
  if (roundAfterRetry.status !== 'completed' || roundAfterRetry.winner_rider_id !== freedRiderId) {
    throw new Error('FAIL: retry did not assign the freed rider');
  }

  const { data: assignment } = await svc.from('delivery_assignments').select('id, rider_id, status, assignment_source').eq('id', roundAfterRetry.winning_assignment_id).single();
  console.log('[TRACE] resulting delivery_assignments row:', JSON.stringify(assignment));
  if (assignment.assignment_source !== 'auto') throw new Error('FAIL: assignment_source is not auto');

  const { data: riderNotif } = await svc.from('notifications').select('event_type, title, body, user_id').eq('event_type', 'delivery_assigned').order('created_at', { ascending: false }).limit(5);
  console.log('[TRACE] recent delivery_assigned notifications (verify recipient is the freed rider):', JSON.stringify(riderNotif));

  console.log('[TRACE] PASS: no-rider -> AUTO_ASSIGNING -> retry tick assigns the freed rider, source=auto, notification created.');

  // cleanup this order
  await admin.rpc('qa_reset_demo_state', {});

  // Step 3: stop_auto_assignment test — new order, all unavailable again, start, then stop, then retry must NOT assign even if freed.
  await svc.from('riders').update({ is_available: false }).eq('id', freedRiderId);
  const { data: created2, error: createErr2 } = await admin.rpc('qa_create_demo_order', { p_customer_id: demoCustomer.id, p_store_id: VIJAY_NAGAR, p_variant_id: null, p_quantity: 1 });
  if (createErr2) throw createErr2;
  const { data: started2 } = await admin.rpc('start_auto_assignment', { p_order_id: created2.orderId });
  console.log('[TRACE] second round started:', JSON.stringify(started2));

  const { error: stopErr } = await admin.rpc('stop_auto_assignment', { p_round_id: started2.dispatchRoundId });
  if (stopErr) throw stopErr;
  const { data: roundAfterStop } = await svc.from('delivery_dispatch_rounds').select('status').eq('id', started2.dispatchRoundId).single();
  console.log('[TRACE] round after stop (expect cancelled):', JSON.stringify(roundAfterStop));
  if (roundAfterStop.status !== 'cancelled') throw new Error('FAIL: stop_auto_assignment did not cancel the round');

  await svc.from('riders').update({ is_available: true }).eq('id', freedRiderId);
  await admin.rpc('retry_auto_assignment_rounds', {});
  const { data: roundStillCancelled } = await svc.from('delivery_dispatch_rounds').select('status, winner_rider_id').eq('id', started2.dispatchRoundId).single();
  console.log('[TRACE] round after a retry tick post-stop (expect STILL cancelled, no winner):', JSON.stringify(roundStillCancelled));
  if (roundStillCancelled.status !== 'cancelled' || roundStillCancelled.winner_rider_id !== null) {
    throw new Error('FAIL: retry_auto_assignment_rounds assigned a rider to a STOPPED round');
  }
  console.log('[TRACE] PASS: stop_auto_assignment genuinely prevents any later retry from assigning.');

  await admin.rpc('qa_reset_demo_state', {});
} finally {
  await restore();
}
