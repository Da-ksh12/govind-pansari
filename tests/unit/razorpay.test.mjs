// Razorpay verification rules: signatures, amount / currency / order binding, merchant account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  checkPaymentAgainstOrder,
  merchantMatches,
  rupeesToPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  webhookAccountAllowed,
} from '../../supabase/functions/_shared/razorpay.ts';

const KEY_SECRET = 'api-key-secret-for-tests';
const WEBHOOK_SECRET = 'webhook-secret-for-tests';
const hex = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

test('checkout signature: valid only for the exact order id, payment id and secret', async () => {
  const sig = hex(KEY_SECRET, 'order_A|pay_A');
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', 'pay_A', sig), true);
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_B', 'pay_A', sig), false, 'different order');
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', 'pay_B', sig), false, 'different payment');
  assert.equal(await verifyCheckoutSignature('another-secret', 'order_A', 'pay_A', sig), false, 'different merchant secret');
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', 'pay_A', sig.toUpperCase()), false);
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', 'pay_A', sig.slice(0, -1)), false, 'truncated');
});

test('checkout signature: empty inputs never verify', async () => {
  const sig = hex(KEY_SECRET, 'order_A|pay_A');
  assert.equal(await verifyCheckoutSignature('', 'order_A', 'pay_A', sig), false);
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, '', 'pay_A', sig), false);
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', '', sig), false);
  assert.equal(await verifyCheckoutSignature(KEY_SECRET, 'order_A', 'pay_A', ''), false);
  // the well-known empty-secret signature must not pass either
  assert.equal(await verifyCheckoutSignature('', 'order_A', 'pay_A', hex('', 'order_A|pay_A')), false);
});

test('webhook signature: keyed with the WEBHOOK secret over the raw body', async () => {
  const body = '{"event":"payment.captured","payload":{}}';
  const sig = hex(WEBHOOK_SECRET, body);
  assert.equal(await verifyWebhookSignature(WEBHOOK_SECRET, body, sig), true);
  assert.equal(await verifyWebhookSignature(WEBHOOK_SECRET, body + ' ', sig), false, 'altered body');
  assert.equal(await verifyWebhookSignature(KEY_SECRET, body, sig), false, 'the API key secret is not the webhook secret');
  assert.equal(await verifyWebhookSignature(WEBHOOK_SECRET, body, ''), false);
  assert.equal(await verifyWebhookSignature('', body, sig), false);
});

const expected = { internalOrderId: 'order-uuid-1', orderNumber: 'GP26102701001', gatewayOrderId: 'order_RZP1', razorpayPaymentId: 'pay_RZP1', amountPaise: 35900 };
const goodPayment = () => ({ id: 'pay_RZP1', order_id: 'order_RZP1', amount: 35900, currency: 'INR', status: 'captured' });
const goodOrder = () => ({ id: 'order_RZP1', amount: 35900, currency: 'INR', receipt: 'GP26102701001', notes: { internal_order_id: 'order-uuid-1' } });

test('a captured payment that matches the order in every respect is accepted', () => {
  assert.deepEqual(checkPaymentAgainstOrder(expected, goodPayment(), goodOrder()), { ok: true });
});

test('wrong amount is refused, in either the payment or the Razorpay order (the "pay ₹50, claim ₹5,000" case)', () => {
  assert.deepEqual(checkPaymentAgainstOrder(expected, { ...goodPayment(), amount: 5000 }, goodOrder()), { ok: false, reason: 'amount_mismatch', pending: false });
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), amount: 5000 }).reason, 'amount_mismatch');
  assert.equal(checkPaymentAgainstOrder({ ...expected, amountPaise: 500000 }, goodPayment(), goodOrder()).reason, 'amount_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), amount: '35900' }, goodOrder()).reason, 'amount_mismatch', 'a string amount is not trusted');
});

test('wrong currency is refused', () => {
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), currency: 'USD' }, goodOrder()).reason, 'currency_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), currency: 'USD' }).reason, 'currency_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), currency: undefined }, goodOrder()).reason, 'currency_mismatch');
});

test('wrong payment id or order id is refused', () => {
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), id: 'pay_OTHER' }, goodOrder()).reason, 'payment_id_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), order_id: 'order_OTHER' }, goodOrder()).reason, 'order_id_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), id: 'order_OTHER' }).reason, 'order_id_mismatch');
});

test('a Razorpay order created for a DIFFERENT application order cannot be attached to this one', () => {
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), notes: { internal_order_id: 'someone-elses-order' } }).reason, 'order_binding_mismatch');
  // no notes at all: fall back to the receipt (the order number)
  assert.deepEqual(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), notes: [] }), { ok: true });
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), notes: [], receipt: 'GP-OTHER' }).reason, 'order_binding_mismatch');
  assert.equal(checkPaymentAgainstOrder(expected, goodPayment(), { ...goodOrder(), notes: undefined, receipt: null }).reason, 'order_binding_mismatch');
});

test('only a captured payment counts as paid; authorized-only is pending, not a failure', () => {
  assert.deepEqual(checkPaymentAgainstOrder(expected, { ...goodPayment(), status: 'authorized' }, goodOrder()), { ok: false, reason: 'not_captured', pending: true });
  assert.deepEqual(checkPaymentAgainstOrder(expected, { ...goodPayment(), status: 'created' }, goodOrder()), { ok: false, reason: 'not_captured', pending: true });
  assert.deepEqual(checkPaymentAgainstOrder(expected, { ...goodPayment(), status: 'failed' }, goodOrder()), { ok: false, reason: 'payment_failed', pending: false });
  assert.deepEqual(checkPaymentAgainstOrder(expected, { ...goodPayment(), status: 'refunded' }, goodOrder()), { ok: false, reason: 'payment_failed', pending: false });
});

test('identity and amount problems are reported ahead of the payment status', () => {
  // a failed payment with the wrong amount is an amount problem first (security signal), not just a failure
  assert.equal(checkPaymentAgainstOrder(expected, { ...goodPayment(), amount: 1, status: 'failed' }, goodOrder()).reason, 'amount_mismatch');
});

test('rupees convert to whole paise without floating point drift', () => {
  assert.equal(rupeesToPaise(359), 35900);
  assert.equal(rupeesToPaise(359.5), 35950);
  assert.equal(rupeesToPaise(0.1 + 0.2), 30);
  assert.equal(rupeesToPaise(1299.99), 129999);
  assert.equal(rupeesToPaise(19.99), 1999);
  assert.ok(Number.isInteger(rupeesToPaise(1234.57)));
});

test('merchant account: an order started under another merchant (or before tracking) does not match', () => {
  assert.equal(merchantMatches('rzp_live_CLIENT', 'rzp_live_CLIENT'), true);
  assert.equal(merchantMatches('rzp_test_OLD', 'rzp_live_CLIENT'), false);
  assert.equal(merchantMatches(null, 'rzp_live_CLIENT'), false, 'legacy rows have no recorded key');
  assert.equal(merchantMatches(undefined, 'rzp_live_CLIENT'), false);
  assert.equal(merchantMatches('', ''), false);
});

test('webhook account pin: optional, and strict once set', () => {
  assert.equal(webhookAccountAllowed(undefined, 'acc_ANY'), true);
  assert.equal(webhookAccountAllowed('acc_CLIENT', 'acc_CLIENT'), true);
  assert.equal(webhookAccountAllowed('acc_CLIENT', 'acc_OTHER'), false);
  assert.equal(webhookAccountAllowed('acc_CLIENT', undefined), false);
});
