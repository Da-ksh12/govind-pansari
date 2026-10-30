// The order timeline: real status in, honest stages out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, buildTimeline, canCustomerCancel, describeStatus, paymentLabel } from '../lib/orders/timeline.ts';

const states = (status, history, placedAt) => buildTimeline(status, history, placedAt)?.map((s) => s.state);

test('six stages a customer can read, in order', () => {
  assert.deepEqual(STAGES.map((s) => s.label), ['Order placed', 'Confirmed', 'Packing', 'Ready for dispatch', 'Out for delivery', 'Delivered']);
});

test('every real status lands on the right stage; earlier stages are done, later ones upcoming', () => {
  assert.deepEqual(states('placed'), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(states('confirmed'), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  for (const s of ['preparing', 'picking', 'packing']) assert.deepEqual(states(s), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'], s);
  for (const s of ['packed', 'rider_assigned']) assert.deepEqual(states(s), ['done', 'done', 'done', 'current', 'upcoming', 'upcoming'], s);
  for (const s of ['out_for_delivery', 'approaching']) assert.deepEqual(states(s), ['done', 'done', 'done', 'done', 'current', 'upcoming'], s);
});

test('a delivered order is finished, not "in progress"', () => {
  assert.deepEqual(states('delivered'), ['done', 'done', 'done', 'done', 'done', 'done']);
});

test('a cancelled order has no timeline at all — it never looks "almost there"', () => {
  assert.equal(buildTimeline('cancelled'), null);
  assert.equal(buildTimeline('cancelled', [{ new_status: 'confirmed', changed_at: '2026-11-01T10:00:00Z' }]), null);
});

test('stage times come from the real status history: the first time the order entered each stage; nothing is filled in for stages not reached', () => {
  const history = [
    { new_status: 'packing', changed_at: '2026-11-01T10:30:00Z' },
    { new_status: 'confirmed', changed_at: '2026-11-01T10:05:00Z' },
    { new_status: 'picking', changed_at: '2026-11-01T10:20:00Z' },
    { new_status: 'placed', changed_at: '2026-11-01T10:00:00Z' },
  ];
  const t = buildTimeline('packing', history);
  assert.deepEqual(t.map((s) => s.at), ['2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z', '2026-11-01T10:20:00Z', null, null, null]);
});

test('the placed time falls back to the order\'s own placed_at when the history has no first row', () => {
  const t = buildTimeline('confirmed', [{ new_status: 'confirmed', changed_at: '2026-11-01T10:05:00Z' }], '2026-11-01T10:00:00Z');
  assert.equal(t[0].at, '2026-11-01T10:00:00Z');
  assert.equal(t[1].at, '2026-11-01T10:05:00Z');
});

test('one honest sentence per status', () => {
  const statuses = ['placed', 'confirmed', 'preparing', 'picking', 'packing', 'packed', 'rider_assigned', 'out_for_delivery', 'approaching', 'delivered', 'cancelled'];
  for (const s of statuses) assert.ok(describeStatus(s).length > 5, s);
  assert.match(describeStatus('cancelled'), /cancelled/);
});

test('payment wording says what actually happened', () => {
  assert.equal(paymentLabel('cod', 'pending'), 'Cash on delivery — pay when it arrives');
  assert.equal(paymentLabel('cod', 'paid'), 'Cash on delivery — paid');
  assert.equal(paymentLabel('upi', 'paid'), 'UPI — paid');
  assert.equal(paymentLabel('card', 'pending'), 'Card — waiting for payment');
  assert.equal(paymentLabel('card', 'failed'), 'Card — payment failed');
  assert.equal(paymentLabel('netbanking', 'refunded'), 'Net banking — refunded');
  assert.equal(paymentLabel(null, null), 'Online — waiting for payment');
});

test('a customer may cancel on their own only before packing starts', () => {
  for (const s of ['placed', 'confirmed', 'preparing']) assert.equal(canCustomerCancel(s), true, s);
  for (const s of ['picking', 'packing', 'packed', 'rider_assigned', 'out_for_delivery', 'approaching', 'delivered', 'cancelled']) assert.equal(canCustomerCancel(s), false, s);
});
