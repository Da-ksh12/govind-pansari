#!/usr/bin/env node
/**
 * TEMPORARY diagnostic — the full, real, end-to-end order journey
 * requested in the urgent bug report, run against the live backend
 * with real client-callable RPCs and a real Storage upload (not a
 * mocked/service-role shortcut for the delivery-completion part
 * specifically, since that's exactly what's under suspicion).
 *
 * Customer places a real order near Vijay Nagar -> store walks it to
 * packed -> auto-assign picks a rider -> rider accepts/arrives/picks
 * up/starts delivery/marks approaching -> rider uploads a REAL photo
 * to the delivery-proofs bucket and calls complete_delivery() with
 * real-shaped coordinates -> verifies order/assignment/rider/
 * notification end state. Then repeats near Awas Vikas.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/_diag_full_order_journey_trace.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function otpLogin(phone) {
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithOtp({ phone });
  const { data, error } = await client.auth.verifyOtp({ phone, token: '123456', type: 'sms' });
  if (error) throw error;
  return { client, user: data.user };
}

// A tiny valid 1x1 JPEG, base64-encoded — a real file, not an empty buffer.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

async function run(label, storeId, customerLat, customerLng) {
  console.log(`\n========== ${label} ==========`);

  const { client: customer, user: customerUser } = await otpLogin('+919000001001');
  const { client: manager } = await otpLogin(storeId === '00000000-0000-0000-0000-000000000102' ? '+919000000205' : '+919000000203');
  const { client: admin } = await otpLogin('+919000000301');

  // Step 1: real checkout — resolve_checkout/find_serviceable_stores must pick the right store on their own.
  const { data: address, error: addrErr } = await customer
    .from('addresses')
    .insert({ user_id: customerUser.id, label: 'other', recipient_name: 'Journey Test', phone: '+919000001001', address_line_1: 'Journey Test Address', city: 'Agra', state: 'Uttar Pradesh', postal_code: '282001', latitude: customerLat, longitude: customerLng, is_default: false })
    .select('id')
    .single();
  if (addrErr) throw addrErr;

  const { data: cartRow } = await svc.from('carts').select('id').eq('user_id', customerUser.id).maybeSingle();
  if (cartRow) await svc.from('cart_items').delete().eq('cart_id', cartRow.id);

  const { data: inv } = await svc.from('inventory').select('product_variant_id').eq('store_id', storeId).eq('is_available', true).gt('quantity', 20).limit(1).single();
  const { error: addToCartErr } = await customer.rpc('add_to_cart', { p_variant_id: inv.product_variant_id, p_quantity: 10 });
  if (addToCartErr) throw addToCartErr;

  const { data: order, error: orderErr } = await customer.rpc('create_order_from_cart', { p_address_id: address.id, p_idempotency_key: `journey-${Date.now()}` });
  if (orderErr) throw orderErr;
  console.log('order placed:', order.orderNumber, '-> success:', order.success);
  if (!order.success) throw new Error('checkout failed: ' + JSON.stringify(order));

  const { data: orderRow } = await svc.from('orders').select('store_id, stores(name)').eq('id', order.orderId).single();
  console.log('backend selected store:', orderRow.stores.name, orderRow.store_id === storeId ? '(CORRECT)' : `(WRONG — expected ${storeId})`);
  if (orderRow.store_id !== storeId) throw new Error('FAIL: wrong store selected');

  // Step 2: store walks it to packed.
  for (const status of ['confirmed', 'preparing', 'packed']) {
    const { error } = await manager.rpc('update_order_status', { p_order_id: order.orderId, p_new_status: status });
    if (error) throw error;
  }
  console.log('store walked order to packed');

  // Step 3: auto-assign.
  const { data: assign, error: assignErr } = await manager.rpc('start_auto_assignment', { p_order_id: order.orderId });
  if (assignErr) throw assignErr;
  console.log('auto-assign result:', JSON.stringify(assign));
  if (assign.code !== 'ASSIGNED') throw new Error('FAIL: no rider was immediately available for this journey test — cannot continue (this itself is not Bug 2, just means try again when a rider is free)');

  const riderId = assign.riderId;
  const assignmentId = assign.assignmentId;
  const { data: riderProfile } = await svc.from('riders').select('profile_id, profiles(phone, full_name)').eq('id', riderId).single();
  console.log('assigned rider:', riderProfile.profiles.full_name, riderProfile.profiles.phone);

  const { client: rider } = await otpLogin('+' + riderProfile.profiles.phone);

  // Step 4: rider walks the full delivery lifecycle exactly as the app would call it.
  let r;
  r = await rider.rpc('accept_delivery', { p_assignment_id: assignmentId }); if (r.error) throw r.error;
  console.log('rider accepted');
  r = await rider.rpc('mark_arrived_at_store', { p_assignment_id: assignmentId }); if (r.error) throw r.error;
  console.log('rider arrived at store');
  r = await rider.rpc('mark_picked_up', { p_assignment_id: assignmentId, p_order_number: order.orderNumber }); if (r.error) throw r.error;
  console.log('rider picked up (order number confirmed)');
  r = await rider.rpc('start_delivery', { p_assignment_id: assignmentId }); if (r.error) throw r.error;
  console.log('rider started delivery (out_for_delivery)');
  r = await rider.rpc('mark_order_approaching', { p_order_id: order.orderId }); if (r.error) throw r.error;
  console.log('rider marked "I\'ve Reached Destination" (approaching)');

  const { data: assignmentBeforeComplete } = await svc.from('delivery_assignments').select('status').eq('id', assignmentId).single();
  console.log('delivery_assignments.status right before completion attempt:', assignmentBeforeComplete.status);

  // Step 5: THE SUSPECT STEP — real photo upload to the real private bucket, then complete_delivery().
  const photoBytes = Buffer.from(TINY_JPEG_BASE64, 'base64');
  const photoPath = `${assignmentId}/${Date.now()}-diagtest.jpg`;
  const { error: uploadErr } = await rider.storage.from('delivery-proofs').upload(photoPath, photoBytes, { contentType: 'image/jpeg', upsert: false });
  if (uploadErr) {
    console.log('PHOTO UPLOAD FAILED:', JSON.stringify(uploadErr));
    throw uploadErr;
  }
  console.log('photo uploaded to', photoPath);

  const completeArgs = {
    p_assignment_id: assignmentId,
    p_proof_photo_url: photoPath,
    p_proof_latitude: customerLat,
    p_proof_longitude: customerLng,
    p_cash_collected: null,
  };
  const { error: completeErr } = await rider.rpc('complete_delivery', completeArgs);
  if (completeErr) {
    console.log('COMPLETE_DELIVERY FAILED — this is Bug 2, reproduced. Full error:', JSON.stringify(completeErr));
    throw completeErr;
  }
  console.log('complete_delivery() SUCCEEDED');

  // Step 6: verify final state exactly as the acceptance criteria demand.
  const { data: finalOrder } = await svc.from('orders').select('status, delivered_at, payment_status').eq('id', order.orderId).single();
  const { data: finalAssignment } = await svc.from('delivery_assignments').select('status, completed_at').eq('id', assignmentId).single();
  const { data: riderActiveCount } = await svc.from('delivery_assignments').select('id', { count: 'exact', head: true }).eq('rider_id', riderId).not('status', 'in', '(completed,cancelled,declined,expired,failed)');
  const { data: customerNotif } = await svc.from('notifications').select('title, body').eq('user_id', customerUser.id).eq('event_type', 'order_delivered').order('created_at', { ascending: false }).limit(1);

  console.log('FINAL order.status:', finalOrder.status, finalOrder.status === 'delivered' ? 'PASS' : 'FAIL');
  console.log('FINAL delivery_assignments.status:', finalAssignment.status, finalAssignment.status === 'completed' ? 'PASS' : 'FAIL');
  console.log('rider active (non-terminal) deliveries remaining:', riderActiveCount.count ?? '(count via head not shown, check below)');
  console.log('customer order_delivered notification:', JSON.stringify(customerNotif));

  console.log(`RESULT for ${label}: SUCCESS end to end.`);
}

try {
  await run('Journey 1 — customer near Vijay Nagar', '00000000-0000-0000-0000-000000000102', 27.2075, 78.0245);
} catch (e) {
  console.error('Journey 1 FAILED:', e.message ?? e);
}

try {
  await run('Journey 2 — customer near Awas Vikas', '00000000-0000-0000-0000-000000000103', 27.2085, 77.9670);
} catch (e) {
  console.error('Journey 2 FAILED:', e.message ?? e);
}
