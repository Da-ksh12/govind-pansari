#!/usr/bin/env node
/**
 * Live checks of the Razorpay binding / verification hardening (migrations 20260827000013-14 and the
 * create-razorpay-order / verify-razorpay-payment functions). Signs in as the QA customer
 * (+919000000201, fixed OTP), places ONE prepaid (UPI) order, exercises the payment functions with
 * forged data, and cancels the order again. NO real payment is made and no money moves; the Razorpay
 * order the function creates is simply never paid.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *   [SUPABASE_ACCESS_TOKEN=...]  node supabase/tests/payment-binding.test.mjs
 *
 * SUPABASE_ACCESS_TOKEN is optional: with it, the "order started under another merchant" case is also
 * exercised (it edits the order's recorded merchant Key ID through the Management API, then restores it).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const ref = (() => {
  try {
    return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../.temp/project-ref'), 'utf8').trim();
  } catch {
    return null;
  }
})();

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    failed++;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const base = { apikey: ANON, 'Content-Type': 'application/json' };
await fetch(`${URL_}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone: '+919000000201' }) });
const session = await (await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone: '+919000000201', token: '123456' }) })).json();
if (!session.access_token) {
  console.error('QA customer login failed.');
  process.exit(1);
}
const auth = { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: auth, ...init });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const rpc = (name, body) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
const fn = async (name, body) => {
  const res = await fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const mgmtSql = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgmtToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
};

// ---- Arrange: one prepaid order for the QA customer.
const addresses = (await rest('addresses?select=id&limit=1')).body;
const variants = (await rest('product_variants?select=id,price,products(name,is_active)&is_active=eq.true&price=gte.300&limit=20')).body.filter((v) => v.products?.is_active);
assert(addresses?.length && variants?.length, 'QA customer has no address / no suitable product');
const added = await rpc('add_to_cart', { p_variant_id: variants[0].id, p_quantity: 1 });
assert(added.status < 300, `add_to_cart failed: ${JSON.stringify(added.body)}`);
const placed = await rpc('create_order_from_cart', { p_address_id: addresses[0].id, p_idempotency_key: `pb-test-${Date.now()}`, p_payment_method: 'upi' });
if (!placed.body?.success) {
  await rpc('set_cart_item_quantity', { p_variant_id: variants[0].id, p_quantity: 0 });
  console.error('Could not place the prepaid test order:', JSON.stringify(placed.body));
  process.exit(1);
}
const orderId = placed.body.orderId;
console.log(`Placed prepaid test order ${placed.body.orderNumber}\n`);

const payment = async () => (await rest(`payments?order_id=eq.${orderId}&select=status,gateway_order_id,gateway_key_id,method`)).body?.[0];
let created = null;

try {
  await check('a prepaid order starts pending with no gateway order recorded', async () => {
    const p = await payment();
    assert(p.status === 'pending' && p.method !== 'cod' && !p.gateway_order_id, JSON.stringify(p));
  });

  await check('create-razorpay-order creates the gateway order and records its id AND the merchant Key ID', async () => {
    created = await fn('create-razorpay-order', { order_id: orderId });
    assert(created.status === 200, `status ${created.status}: ${JSON.stringify(created.body)}`);
    assert(created.body.razorpayOrderId && created.body.keyId && created.body.currency === 'INR', JSON.stringify(created.body));
    assert(created.body.amount === Math.round(Number(placed.body.total) * 100), `amount ${created.body.amount} vs order total ${placed.body.total}`);
    const p = await payment();
    assert(p.gateway_order_id === created.body.razorpayOrderId, 'gateway order id not recorded');
    assert(p.gateway_key_id === created.body.keyId, 'merchant key id not recorded');
    assert(!JSON.stringify(created.body).toLowerCase().includes('secret'), 'a secret leaked into the response');
  });

  await check('a customer can NO LONGER choose which Razorpay order their order is bound to (set_payment_gateway_order revoked)', async () => {
    const before = await payment();
    const attempt = await rpc('set_payment_gateway_order', { p_order_id: orderId, p_gateway_order_id: 'order_ATTACKER_CHOSEN' });
    assert(attempt.status >= 400, `the call was allowed (status ${attempt.status})`);
    assert((await payment()).gateway_order_id === before.gateway_order_id, 'the binding changed');
  });

  await check('the server-side binding function is not callable by a customer either', async () => {
    const attempt = await rpc('bind_payment_gateway_order', { p_order_id: orderId, p_gateway_order_id: 'order_X', p_gateway_key_id: 'rzp_test_X' });
    assert(attempt.status >= 400, `the call was allowed (status ${attempt.status})`);
    assert((await payment()).gateway_order_id === created.body.razorpayOrderId, 'the binding changed');
  });

  await check('a payment that belongs to a different gateway order is refused', async () => {
    const res = await fn('verify-razorpay-payment', { order_id: orderId, razorpay_order_id: 'order_SOMEONE_ELSES', razorpay_payment_id: 'pay_X', razorpay_signature: 'a'.repeat(64) });
    assert(res.status === 400 && res.body.success === false, `${res.status} ${JSON.stringify(res.body)}`);
    assert((await payment()).status === 'pending', 'payment state changed');
  });

  if (mgmtToken && ref) {
    await check('an order started under ANOTHER merchant account is reported as such and NOT recorded as failed', async () => {
      const original = created.body.keyId;
      await mgmtSql(`update payments set gateway_key_id = 'rzp_test_PREVIOUSMERCHANT' where order_id = '${orderId}'`);
      try {
        const res = await fn('verify-razorpay-payment', { order_id: orderId, razorpay_order_id: created.body.razorpayOrderId, razorpay_payment_id: 'pay_X', razorpay_signature: 'a'.repeat(64) });
        assert(res.status === 409 && res.body.code === 'merchant_changed', `${res.status} ${JSON.stringify(res.body)}`);
        assert((await payment()).status === 'pending', 'it was recorded as failed');
      } finally {
        await mgmtSql(`update payments set gateway_key_id = '${original.replace(/'/g, "''")}' where order_id = '${orderId}'`);
      }
    });
  } else {
    console.log('  --  (merchant-change case skipped: set SUPABASE_ACCESS_TOKEN to run it)');
  }

  await check('a forged signature is refused, recorded as failed, and the order is not paid', async () => {
    const res = await fn('verify-razorpay-payment', { order_id: orderId, razorpay_order_id: created.body.razorpayOrderId, razorpay_payment_id: 'pay_FORGED', razorpay_signature: 'f'.repeat(64) });
    assert(res.status === 400 && res.body.success === false, `${res.status} ${JSON.stringify(res.body)}`);
    const p = await payment();
    assert(p.status === 'failed', `payment status ${p.status}`);
    const order = (await rest(`orders?id=eq.${orderId}&select=payment_status,status`)).body[0];
    assert(order.payment_status !== 'paid', `order payment_status ${order.payment_status}`);
  });

  await check('after a failed payment a repeat of the same call cannot flip the order to paid', async () => {
    const res = await fn('verify-razorpay-payment', { order_id: orderId, razorpay_order_id: created.body.razorpayOrderId, razorpay_payment_id: 'pay_FORGED2', razorpay_signature: 'e'.repeat(64) });
    assert(res.status >= 400, `${res.status} ${JSON.stringify(res.body)}`);
    const order = (await rest(`orders?id=eq.${orderId}&select=payment_status`)).body[0];
    assert(order.payment_status !== 'paid', 'order became paid');
  });

  await check('a prepaid order is never in the store queue while unpaid (no prepaid fulfilment before verification)', async () => {
    const order = (await rest(`orders?id=eq.${orderId}&select=status,payment_status`)).body[0];
    assert(order.payment_status !== 'paid', 'unexpectedly paid');
  });
} finally {
  // Leave the QA customer clean: cart empty, the test order cancelled.
  const order = (await rest(`orders?id=eq.${orderId}&select=status`)).body?.[0];
  if (order && order.status !== 'cancelled') await rpc('restore_cart_after_failed_payment', { p_order_id: orderId });
  const cart = (await rest('cart_items?select=product_variant_id')).body ?? [];
  for (const line of cart) await rpc('set_cart_item_quantity', { p_variant_id: line.product_variant_id, p_quantity: 0 });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
