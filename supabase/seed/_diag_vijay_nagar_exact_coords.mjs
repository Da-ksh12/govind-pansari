#!/usr/bin/env node
/**
 * TEMPORARY diagnostic — the exact test requested: place a REAL order
 * (real checkout RPC, real inventory reservation) with the customer's
 * delivery address set to Vijay Nagar's OWN store coordinates, and
 * confirm the order that actually gets created is assigned to Vijay
 * Nagar. No shortcuts — this goes through create_order_from_cart(),
 * the same function the real checkout screen calls.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/_diag_vijay_nagar_exact_coords.mjs
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

const VIJAY_NAGAR_STORE_ID = '00000000-0000-0000-0000-000000000102';

// Pull Vijay Nagar's OWN coordinates straight from the stores table —
// not retyped/guessed, the literal value the store record holds.
const { data: store } = await svc.from('stores').select('id, name, latitude, longitude').eq('id', VIJAY_NAGAR_STORE_ID).single();
console.log('Vijay Nagar store record:', JSON.stringify(store));

const { client: customer, user } = await otpLogin('+919000001001');

// Address = exactly the store's own coordinates.
const { data: address, error: addrErr } = await customer
  .from('addresses')
  .insert({
    user_id: user.id, label: 'other', recipient_name: 'Definitive Test',
    phone: '+919000001001', address_line_1: 'Exact Vijay Nagar Coordinates Test',
    city: 'Agra', state: 'Uttar Pradesh', postal_code: '282001',
    latitude: store.latitude, longitude: store.longitude, is_default: false,
  })
  .select('id')
  .single();
if (addrErr) throw addrErr;
console.log('customer address created with coordinates:', store.latitude, store.longitude);

// Clear cart, add a real in-stock item at Vijay Nagar, enough to clear the minimum order value.
const { data: cartRow } = await svc.from('carts').select('id').eq('user_id', user.id).maybeSingle();
if (cartRow) await svc.from('cart_items').delete().eq('cart_id', cartRow.id);

const { data: inv } = await svc.from('inventory').select('product_variant_id').eq('store_id', VIJAY_NAGAR_STORE_ID).eq('is_available', true).gt('quantity', 20).limit(1).single();
const { error: cartErr } = await customer.rpc('add_to_cart', { p_variant_id: inv.product_variant_id, p_quantity: 10 });
if (cartErr) throw cartErr;

// The real checkout RPC — exactly what the app's Checkout screen calls.
const { data: order, error: orderErr } = await customer.rpc('create_order_from_cart', {
  p_address_id: address.id,
  p_idempotency_key: `definitive-vn-test-${Date.now()}`,
});
if (orderErr) throw orderErr;
console.log('create_order_from_cart result:', JSON.stringify(order));
if (!order.success) throw new Error('Checkout failed: ' + JSON.stringify(order));

const { data: finalOrder } = await svc.from('orders').select('id, order_number, store_id, delivery_address, stores(name)').eq('id', order.orderId).single();
console.log('\n=== FINAL ORDER RECORD ===');
console.log('Order number:', finalOrder.order_number);
console.log('Delivery address lat/lng on the order:', finalOrder.delivery_address.latitude, finalOrder.delivery_address.longitude);
console.log('store_id on the order:', finalOrder.store_id);
console.log('Store name:', finalOrder.stores.name);

const correct = finalOrder.store_id === VIJAY_NAGAR_STORE_ID;
console.log('\n' + (correct ? '✅ PASS — order correctly assigned to Vijay Nagar' : '❌ FAIL — order assigned to the WRONG store'));

// Clean up: cancel this test order so it doesn't linger as a real-looking order.
await customer.rpc('update_order_status', { p_order_id: order.orderId, p_new_status: 'cancelled', p_reason: 'diagnostic cleanup' });
console.log('test order cancelled (cleanup)');

if (!correct) process.exit(1);
