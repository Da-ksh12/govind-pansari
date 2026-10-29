// QA TC-03 / TC-04 / TC-23: one decision for "can this order be placed", the
// same inputs always giving the same answer, with a reason for every block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cartSignature, evaluatePlaceOrder, formatRupees, paymentStepState } from '../../services/checkoutGate.ts';

const ready = (over = {}) => ({ status: 'ready', meetsMinimumOrder: true, amountToMinimumOrder: 0, minimumOrderValue: 299, ...over });
const input = (over = {}) => ({ hasAddress: true, paymentMethod: 'cod', summary: ready(), placing: false, ...over });

test('a complete checkout can be placed', () => {
  assert.deepEqual(evaluatePlaceOrder(input()), { canPlace: true, block: null, message: null });
});

test('identical inputs always give the identical outcome (TC-03: ₹359 was inconsistent)', () => {
  const at359 = input({ summary: ready({ minimumOrderValue: 299 }) });
  const first = evaluatePlaceOrder(at359);
  for (let i = 0; i < 50; i++) assert.deepEqual(evaluatePlaceOrder(at359), first);
});

test('below the minimum order explains how much more to add (TC-04)', () => {
  const gate = evaluatePlaceOrder(input({ summary: ready({ meetsMinimumOrder: false, amountToMinimumOrder: 51, minimumOrderValue: 299 }) }));
  assert.equal(gate.canPlace, false);
  assert.equal(gate.block, 'below_minimum');
  assert.match(gate.message, /₹51/);
  assert.match(gate.message, /₹299/);
});

test('every blocked state carries a message, except while placing', () => {
  const blocked = [
    input({ hasAddress: false }),
    input({ summary: { status: 'none' } }),
    input({ summary: { status: 'loading' } }),
    input({ summary: { status: 'failed', message: 'Could not load' } }),
    input({ summary: ready({ meetsMinimumOrder: false, amountToMinimumOrder: 10, minimumOrderValue: 299 }) }),
    input({ paymentMethod: null }),
  ];
  for (const b of blocked) {
    const gate = evaluatePlaceOrder(b);
    assert.equal(gate.canPlace, false);
    assert.ok(gate.message && gate.message.length > 0, `no message for block ${gate.block}`);
  }
  const placing = evaluatePlaceOrder(input({ placing: true }));
  assert.equal(placing.canPlace, false);
  assert.equal(placing.block, 'placing');
  assert.equal(placing.message, null);
});

test('no payment method is selected by default (TC-23)', () => {
  const gate = evaluatePlaceOrder(input({ paymentMethod: null }));
  assert.equal(gate.block, 'payment_not_selected');
  assert.equal(gate.canPlace, false);
});

test('a failed summary reports its own message, not the minimum-order one', () => {
  const gate = evaluatePlaceOrder(input({ summary: { status: 'failed', message: 'Outside service area' } }));
  assert.equal(gate.block, 'summary_failed');
  assert.equal(gate.message, 'Outside service area');
});

test('formatRupees uses Indian grouping and drops a zero fraction', () => {
  assert.equal(formatRupees(0), '₹0');
  assert.equal(formatRupees(299), '₹299');
  assert.equal(formatRupees(1299), '₹1,299');
  assert.equal(formatRupees(125000), '₹1,25,000');
  assert.equal(formatRupees(12345678), '₹1,23,45,678');
  assert.equal(formatRupees(1299.5), '₹1,299.50');
  assert.equal(formatRupees(0.1 + 0.2), '₹0.30', 'floating point noise is rounded to paise');
});

test('cartSignature ignores line order and changes with quantity', () => {
  const a = cartSignature([{ cartItemId: 'b', quantity: 2 }, { cartItemId: 'a', quantity: 1 }]);
  const b = cartSignature([{ cartItemId: 'a', quantity: 1 }, { cartItemId: 'b', quantity: 2 }]);
  assert.equal(a, b);
  assert.notEqual(a, cartSignature([{ cartItemId: 'a', quantity: 2 }, { cartItemId: 'b', quantity: 2 }]));
  assert.equal(cartSignature([]), '');
});

test('Payment step is not ticked before a method is chosen (TC-23)', () => {
  const base = { deliveryDone: true, paymentMethod: null, gatewayPaymentConfirmed: false, gatewayPaymentFailed: false, placing: false };
  assert.equal(paymentStepState(base), 'unselected');
});

test('Payment step ticks only for settled payments', () => {
  const base = { deliveryDone: true, paymentMethod: 'upi', gatewayPaymentConfirmed: false, gatewayPaymentFailed: false, placing: false };
  assert.equal(paymentStepState(base), 'selected', 'choosing UPI is not a verified payment');
  assert.equal(paymentStepState({ ...base, placing: true }), 'processing');
  assert.equal(paymentStepState({ ...base, gatewayPaymentConfirmed: true }), 'verified');
  assert.equal(paymentStepState({ ...base, gatewayPaymentFailed: true }), 'failed');
  assert.equal(paymentStepState({ ...base, gatewayPaymentFailed: true, gatewayPaymentConfirmed: true }), 'failed');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'cod' }), 'verified', 'COD has nothing to confirm online');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'cod', deliveryDone: false }), 'selected');
});
