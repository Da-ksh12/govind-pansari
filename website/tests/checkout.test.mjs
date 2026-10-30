// Address rules, the place-order gate and payment-failure wording (the last two are shared with the mobile app).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addressOneLine, addressSchema, composeLine1, composeLine2, toAddressRow } from '../lib/address.ts';
import { evaluatePlaceOrder, paymentStepState } from '../lib/checkout/gate.ts';
import { classifyPaymentFailure, verificationFailureMessage } from '../lib/payments/errors.ts';

const good = { label: 'home', receiverName: 'Asha Verma', receiverPhone: '98765 43210', houseNo: '12', building: 'Shanti Apartments', floor: '2', street: 'Awas Vikas Road', locality: 'Awas Vikas Colony', landmark: '', instructions: '', city: 'Agra', state: 'Uttar Pradesh', pincode: '282007' };

test('a complete address passes; the composed lines read the way a rider needs them', () => {
  const parsed = addressSchema.safeParse(good);
  assert.equal(parsed.success, true);
  assert.equal(composeLine1(good), '12, Shanti Apartments, 2 floor, Awas Vikas Road');
  assert.equal(composeLine1({ ...good, floor: '2nd floor' }), '12, Shanti Apartments, 2nd floor, Awas Vikas Road');
  assert.equal(composeLine2(good), 'Awas Vikas Colony');
  assert.equal(composeLine2({ locality: ' ' }), null);
});

test('each missing or wrong part is named', () => {
  const fail = (patch) => addressSchema.safeParse({ ...good, ...patch });
  assert.equal(fail({ receiverName: 'A' }).success, false);
  assert.equal(fail({ receiverPhone: '12345' }).success, false);
  assert.equal(fail({ receiverPhone: '5876543210' }).success, false);
  assert.equal(fail({ houseNo: '' }).success, false);
  assert.equal(fail({ pincode: '28200' }).success, false);
  assert.equal(fail({ city: '' }).success, false);
  assert.equal(fail({ instructions: 'x'.repeat(501) }).success, false);
  const noWhere = fail({ street: '', locality: '', building: '' });
  assert.equal(noWhere.success, false);
  assert.equal(noWhere.error.issues[0].path[0], 'street');
});

test('the saved row stores digits only, blanks as NULL, and where the pin came from', () => {
  const row = toAddressRow('user-1', { ...good, receiverPhone: '+91 98765 43210', landmark: '', instructions: ' ' }, { lat: 27.2, lng: 78, source: 'osm', formatted: 'Awas Vikas, Agra' });
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.phone, '9876543210');
  assert.equal(row.landmark, null);
  assert.equal(row.delivery_instructions, null);
  assert.equal(row.geocode_source, 'osm');
  assert.equal(row.postal_code, '282007');
  assert.equal(
    addressOneLine({ line1: row.address_line_1, line2: row.address_line_2, landmark: null, city: 'Agra', pincode: '282007' }),
    '12, Shanti Apartments, 2 floor, Awas Vikas Road, Awas Vikas Colony, Agra 282007',
  );
});

const ready = { status: 'ready', meetsMinimumOrder: true, amountToMinimumOrder: 0, minimumOrderValue: 299 };

test('an order can be placed only with an address, a loaded total above the minimum, and a chosen payment method', () => {
  assert.equal(evaluatePlaceOrder({ hasAddress: false, paymentMethod: 'cod', summary: ready, placing: false }).block, 'no_address');
  assert.equal(evaluatePlaceOrder({ hasAddress: true, paymentMethod: 'cod', summary: { status: 'loading' }, placing: false }).block, 'summary_loading');
  const below = evaluatePlaceOrder({ hasAddress: true, paymentMethod: 'cod', summary: { ...ready, meetsMinimumOrder: false, amountToMinimumOrder: 49 }, placing: false });
  assert.equal(below.block, 'below_minimum');
  assert.match(below.message, /₹49 more/);
  assert.equal(evaluatePlaceOrder({ hasAddress: true, paymentMethod: null, summary: ready, placing: false }).block, 'payment_not_selected');
  assert.equal(evaluatePlaceOrder({ hasAddress: true, paymentMethod: 'upi', summary: ready, placing: false }).canPlace, true);
  assert.equal(evaluatePlaceOrder({ hasAddress: true, paymentMethod: 'upi', summary: ready, placing: true }).canPlace, false);
});

test('the payment step only shows "verified" for money that is actually settled', () => {
  const base = { deliveryDone: true, gatewayPaymentConfirmed: false, gatewayPaymentFailed: false, placing: false };
  assert.equal(paymentStepState({ ...base, paymentMethod: null }), 'unselected');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'upi' }), 'selected');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'upi', placing: true }), 'processing');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'upi', gatewayPaymentConfirmed: true }), 'verified');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'upi', gatewayPaymentFailed: true }), 'failed');
  assert.equal(paymentStepState({ ...base, paymentMethod: 'cod' }), 'verified');
});

test('payment failures are worded for customers; gateway payloads never leak and a cancel is quiet', () => {
  const cancelled = classifyPaymentFailure({ description: 'Payment cancelled by user' });
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(cancelled.showError, false);
  const auth = classifyPaymentFailure({ code: 'BAD_REQUEST_ERROR', description: 'undefined', source: 'customer', step: 'payment_authentication', reason: 'payment_error' });
  assert.equal(auth.kind, 'authentication');
  assert.doesNotMatch(auth.message, /BAD_REQUEST|undefined|payment_error/);
  assert.equal(classifyPaymentFailure('Failed to fetch').kind, 'network');
  assert.equal(classifyPaymentFailure({ description: 'Your card was declined by the bank' }).kind, 'declined');
  assert.equal(classifyPaymentFailure(null).kind, 'unknown');
  assert.match(verificationFailureMessage(), /refunded automatically/);
});
