// How an order is shown in the admin app. Everything here formats STORED data; these tests pin that nothing is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressLines,
  allowedOrderActions,
  breakdownMismatch,
  cleanTimeline,
  describePayment,
  formatMoney,
  formatOrderDateTime,
  formatPhone,
  itemCountText,
  mainLineTitle,
  moreItemsText,
  phoneDigits,
  priceBreakdown,
  summarizeOrderLines,
} from '../../services/adminOrderView.ts';

test('money reads as Indian rupees: whole amounts plain, fractional with paise, bad values never as a number', () => {
  assert.equal(formatMoney(1000), '₹1,000');
  assert.equal(formatMoney(454100), '₹4,54,100');
  assert.equal(formatMoney('449.5'), '₹449.50');
  assert.equal(formatMoney(0), '₹0');
  assert.equal(formatMoney(null), '₹—');
  assert.equal(formatMoney(undefined), '₹—');
  assert.equal(formatMoney('abc'), '₹—');
});

test('phone numbers are shown in the Indian format and dialled as digits', () => {
  assert.equal(formatPhone('917983161732'), '+91 79831 61732');
  assert.equal(formatPhone('7983161732'), '+91 79831 61732');
  assert.equal(formatPhone('+917983161732'), '+91 79831 61732');
  assert.equal(formatPhone('+14155550123'), '+14155550123', 'anything else is shown as stored');
  assert.equal(formatPhone(null), '');
  assert.equal(phoneDigits('+91 79831 61732'), '+917983161732');
});

test('order time is shown in Indian time whatever the phone\'s zone is', () => {
  assert.equal(formatOrderDateTime('2026-10-27T18:35:00Z'), '28 Oct 2026, 12:05 AM');
  assert.equal(formatOrderDateTime('2026-10-28T06:30:00Z'), '28 Oct 2026, 12:00 PM');
  assert.equal(formatOrderDateTime(''), '');
  assert.equal(formatOrderDateTime('not a date'), '');
});

const line = (name, total, extra = {}) => ({ name, variant: '500 g', image: `https://img/${name}.jpg`, quantity: 1, total, ...extra });

test('the card\'s main product is the biggest real line, with a compact count of the rest', () => {
  const preview = summarizeOrderLines([line('Almonds', 400), line('Saffron', 900), line('Dates', 150)]);
  assert.equal(preview.main.name, 'Saffron');
  assert.equal(preview.moreLines, 2);
  assert.equal(preview.lines, 3);
  assert.equal(mainLineTitle(preview.main), 'Saffron · 500 g');
  assert.equal(mainLineTitle({ ...preview.main, variant: null }), 'Saffron');
  assert.equal(moreItemsText(2), '+ 2 more items');
  assert.equal(moreItemsText(1), '+ 1 more item');
  assert.equal(moreItemsText(0), '');
  assert.equal(itemCountText(1), '1 item');
  assert.equal(itemCountText(8), '8 items');
  // No lines: no main product and no invented image.
  assert.deepEqual(summarizeOrderLines([]), { main: null, moreLines: 0, lines: 0 });
});

test('payment is described from what is stored — "Paid" only when the server marked it paid', () => {
  assert.deepEqual(describePayment('cod', 'pending'), { method: 'Cash on delivery', status: 'To be collected on delivery', tone: 'pending' });
  assert.deepEqual(describePayment('cod', 'paid'), { method: 'Cash on delivery', status: 'Paid (verified)', tone: 'good' });
  assert.deepEqual(describePayment('razorpay', 'paid'), { method: 'Online (Razorpay)', status: 'Paid (verified)', tone: 'good' });
  assert.equal(describePayment('razorpay', 'pending').status, 'Pending');
  assert.equal(describePayment('razorpay', 'pending', true).status, 'Awaiting online payment');
  assert.equal(describePayment('upi', 'failed').tone, 'bad');
  assert.equal(describePayment('card', 'refunded').status, 'Refunded');
  assert.equal(describePayment(null, null).method, 'Not recorded');
  assert.equal(describePayment(null, null).status, 'Not recorded');
});

test('the price breakdown is the stored columns, in order, with nothing recomputed', () => {
  const stored = { subtotal: '360.00', discount: '0.00', delivery_fee: '49.00', tax: '0.00', total: '409.00' };
  assert.deepEqual(priceBreakdown(stored).map((l) => [l.label, l.amount, l.kind]), [
    ['Subtotal', 360, 'plain'],
    ['Discount', 0, 'discount'],
    ['Delivery charge', 49, 'delivery'],
    ['Tax', 0, 'plain'],
    ['Total', 409, 'total'],
  ]);
  assert.equal(breakdownMismatch(stored), false);
  assert.equal(breakdownMismatch({ ...stored, total: '500.00' }), true);
  // Missing values are 0, never NaN.
  assert.equal(priceBreakdown({ subtotal: null, discount: null, delivery_fee: null, tax: null, total: null })[4].amount, 0);
});

test('the timeline reads in order with friendly labels, and unknown codes are shown not hidden', () => {
  const out = cleanTimeline([
    { at: '2026-10-28T06:10:00Z', kind: 'delivery', label: 'delivery_assigned' },
    { at: '2026-10-28T06:00:00Z', kind: 'status', label: 'placed' },
    { at: '2026-10-28T06:00:00.2Z', kind: 'status', label: 'placed' },
    { at: '2026-10-28T06:05:00Z', kind: 'status', label: 'packed' },
    { at: '2026-10-28T06:20:00Z', kind: 'delivery', label: 'delivery_declined' },
    { at: '2026-10-28T06:30:00Z', kind: 'status', label: 'some_new_status' },
  ]);
  assert.deepEqual(out.map((e) => e.text), ['Order placed', 'Ready for pickup', 'Rider chosen', 'Rider declined', 'some new status']);
});

test('actions offered match the order\'s status and the admin\'s rights', () => {
  const all = () => true;
  const none = () => false;
  assert.deepEqual(allowedOrderActions({ status: 'packed' }, false, all), { canCancel: true, canAssignRider: true, canTrack: false });
  assert.deepEqual(allowedOrderActions({ status: 'packed' }, true, all), { canCancel: true, canAssignRider: false, canTrack: false }, 'a rider is already on it');
  assert.deepEqual(allowedOrderActions({ status: 'out_for_delivery' }, true, all), { canCancel: true, canAssignRider: false, canTrack: true });
  assert.deepEqual(allowedOrderActions({ status: 'delivered' }, false, all), { canCancel: false, canAssignRider: false, canTrack: false });
  assert.deepEqual(allowedOrderActions({ status: 'cancelled' }, false, all), { canCancel: false, canAssignRider: false, canTrack: false });
  assert.deepEqual(allowedOrderActions({ status: 'packed' }, false, none), { canCancel: false, canAssignRider: false, canTrack: false }, 'no rights, no buttons');
  assert.deepEqual(allowedOrderActions({ status: 'placed' }, false, (p) => p === 'orders.cancel'), { canCancel: true, canAssignRider: false, canTrack: false });
});

test('the delivery address is shown as stored, skipping empty parts', () => {
  assert.deepEqual(
    addressLines({ address_line_1: '12 Vijay Nagar Colony', address_line_2: '', landmark: 'Hanuman Mandir', city: 'Agra', state: 'Uttar Pradesh', postal_code: '282003' }),
    ['12 Vijay Nagar Colony', 'Near Hanuman Mandir', 'Agra, Uttar Pradesh - 282003'],
  );
  assert.deepEqual(addressLines(null), []);
  assert.deepEqual(addressLines({}), []);
});
