#!/usr/bin/env node
/**
 * TEMPORARY diagnostic (not part of the seed pipeline) — root-cause
 * trace for "rider vibration works but the offer popup doesn't
 * appear". Replicates exactly what the rider app does: signs in as a
 * real rider, subscribes to the same Realtime channel
 * notificationRepository.subscribe() uses, triggers a real dispatch
 * round, and reports whether/when the INSERT event actually arrives.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/_diag_realtime_offer_trace.mjs
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

const RIDER_PHONE = '+919000001101'; // Demo Rider 01, Vijay Nagar, available
const VIJAY_NAGAR = '00000000-0000-0000-0000-000000000102';

const riderClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { user: riderUser } = await otpLogin(riderClient, RIDER_PHONE);
console.log('[TRACE] Rider signed in:', riderUser.id, riderUser.user_metadata?.full_name);

let received = null;
const channel = riderClient
  .channel(`notifications-${riderUser.id}-trace`)
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${riderUser.id}` },
    (payload) => {
      received = payload.new;
      console.log('[TRACE] REALTIME EVENT RECEIVED at', new Date().toISOString());
      console.log('[TRACE] event_type:', payload.new.event_type, '| data:', JSON.stringify(payload.new.data));
    },
  )
  .subscribe((status) => console.log('[TRACE] channel status:', status));

await new Promise((r) => setTimeout(r, 3000));
console.log('[TRACE] Subscription settled, now creating a demo order + starting dispatch...');

const adminClient = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { user: adminUser } = await otpLogin(adminClient, '+919000000301');
console.log('[TRACE] Admin signed in:', adminUser.id);

const { data: demoCustomer } = await svc.from('profiles').select('id').eq('role', 'customer').ilike('email', '%@govindpansari.dev').order('full_name').limit(1).single();

const { data: created, error: createErr } = await adminClient.rpc('qa_create_demo_order', {
  p_customer_id: demoCustomer.id, p_store_id: VIJAY_NAGAR, p_variant_id: null, p_quantity: 1,
});
if (createErr) { console.error('[TRACE] order create failed', createErr); process.exit(1); }
console.log('[TRACE] Demo order created:', created.orderNumber, created.orderId);

const dispatchStartedAt = new Date().toISOString();
const { data: started, error: startErr } = await adminClient.rpc('start_dispatch_round', { p_order_id: created.orderId });
if (startErr) { console.error('[TRACE] start_dispatch_round failed', startErr); process.exit(1); }
console.log('[TRACE] start_dispatch_round called at', dispatchStartedAt, '-> result:', JSON.stringify(started));

const deadline = Date.now() + 15000;
while (!received && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}

if (received) {
  console.log('[TRACE] RESULT: Realtime event DID arrive.', JSON.stringify(received));
} else {
  console.log('[TRACE] RESULT: Realtime event did NOT arrive within 15s.');
  const { data: rows } = await svc.from('notifications').select('*').eq('user_id', riderUser.id).order('created_at', { ascending: false }).limit(3);
  console.log('[TRACE] Direct DB query for this rider\'s latest notifications:', JSON.stringify(rows, null, 2));
}

await adminClient.rpc('qa_reset_demo_state', {});
process.exit(0);
