// QA TC-13: a raw gateway payload must never reach the customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPaymentFailure, extractGatewayFields, verificationFailureMessage } from '../../services/payments/paymentErrors.ts';

// The exact payload from the tester's screenshot.
const TESTER_PAYLOAD = {
  error: {
    code: 'BAD_REQUEST_ERROR',
    description: 'undefined',
    source: 'customer',
    step: 'payment_authentication',
    reason: 'payment_error',
    metadata: {},
  },
};

function assertSafe(failure) {
  assert.doesNotMatch(failure.message, /BAD_REQUEST|undefined|payment_authentication|payment_error|[{}]|"error"/i);
  assert.ok(failure.message.length > 10);
}

test('the tester payload becomes a friendly authentication message', () => {
  const failure = classifyPaymentFailure(TESTER_PAYLOAD);
  assert.equal(failure.kind, 'authentication');
  assert.equal(failure.showError, true);
  assertSafe(failure);
  assert.deepEqual(failure.diagnostics, {
    code: 'BAD_REQUEST_ERROR', reason: 'payment_error', step: 'payment_authentication', source: 'customer',
  });
});

test('the same payload as a JSON string, an Error, or a bare error object', () => {
  assert.equal(classifyPaymentFailure(JSON.stringify(TESTER_PAYLOAD)).kind, 'authentication');
  assert.equal(classifyPaymentFailure(new Error(JSON.stringify(TESTER_PAYLOAD))).kind, 'authentication');
  assert.equal(classifyPaymentFailure(TESTER_PAYLOAD.error).kind, 'authentication');
  for (const raw of [JSON.stringify(TESTER_PAYLOAD), new Error(JSON.stringify(TESTER_PAYLOAD)), TESTER_PAYLOAD.error]) {
    assertSafe(classifyPaymentFailure(raw));
  }
});

test('a deliberate back-out is not an error', () => {
  for (const raw of ['Payment cancelled by user', { code: 'PAYMENT_CANCELLED', description: 'Payment processing cancelled by user' }, new Error('User closed the checkout')]) {
    const failure = classifyPaymentFailure(raw);
    assert.equal(failure.kind, 'cancelled');
    assert.equal(failure.showError, false);
  }
});

test('network, timeout and decline are told apart', () => {
  assert.equal(classifyPaymentFailure(new Error('Network request failed')).kind, 'network');
  assert.equal(classifyPaymentFailure(new Error('Failed to fetch')).kind, 'network');
  assert.equal(classifyPaymentFailure(new Error('Request timed out')).kind, 'timeout');
  assert.equal(classifyPaymentFailure({ error: { code: 'BAD_REQUEST_ERROR', description: 'Payment declined by bank', reason: 'payment_failed' } }).kind, 'declined');
  assert.equal(classifyPaymentFailure({ error: { description: 'Insufficient funds' } }).kind, 'declined');
});

test('unrecognised, empty and hostile input still gives a safe message', () => {
  const inputs = [undefined, null, '', 'undefined', 'null', 42, {}, [], { error: {} }, { error: 'x'.repeat(5000) }, '{not json', { error: { description: 'undefined' } }];
  for (const raw of inputs) {
    const failure = classifyPaymentFailure(raw);
    assert.ok(failure.message, String(raw));
    assert.doesNotMatch(failure.message, /undefined|\{|\}/);
  }
  assert.equal(classifyPaymentFailure(undefined).kind, 'unknown');
});

test('descriptions that are the literal string "undefined" are dropped', () => {
  const fields = extractGatewayFields(TESTER_PAYLOAD);
  assert.equal(fields.description, undefined);
  assert.equal(fields.code, 'BAD_REQUEST_ERROR');
});

test('deeply nested payloads do not recurse forever', () => {
  let nested = { code: 'X' };
  for (let i = 0; i < 20; i++) nested = { error: nested };
  assert.doesNotThrow(() => classifyPaymentFailure(nested));
});

test('verification failure copy is safe and mentions refunds', () => {
  assert.match(verificationFailureMessage(), /refund/i);
  assertSafe({ message: verificationFailureMessage() });
});
