// The cart: quantities, merging after sign-in, reading a damaged saved cart, and the delivery quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_QUANTITY, addLine, cartTotals, clampQuantity, itemCount, mergeCarts, parseStoredCart, quoteDelivery, removeLine, setQuantity } from '../lib/cart/model.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

test('quantities are whole numbers between 1 and the limit', () => {
  assert.equal(clampQuantity(3), 3);
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-4), 1);
  assert.equal(clampQuantity(2.9), 2);
  assert.equal(clampQuantity(99), DEFAULT_MAX_QUANTITY);
  assert.equal(clampQuantity(Number.NaN), 1);
  assert.equal(clampQuantity(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampQuantity(50, 5), 5);
});

test('adding the same pack again increases its quantity, up to the limit; a new pack becomes a new line', () => {
  let cart = addLine([], A);
  cart = addLine(cart, A, 2);
  assert.deepEqual(cart, [{ variantId: A, quantity: 3 }]);
  cart = addLine(cart, B, 1);
  assert.equal(cart.length, 2);
  assert.deepEqual(addLine([{ variantId: A, quantity: 19 }], A, 5), [{ variantId: A, quantity: 20 }]);
  assert.deepEqual(addLine([], A, 400), [{ variantId: A, quantity: 20 }]);
});

test('setting a quantity to zero or less removes the line; other lines are never touched', () => {
  const cart = [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 4 }];
  assert.deepEqual(setQuantity(cart, A, 0), [{ variantId: B, quantity: 4 }]);
  assert.deepEqual(setQuantity(cart, A, -1), [{ variantId: B, quantity: 4 }]);
  assert.deepEqual(setQuantity(cart, B, 7), [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 7 }]);
  assert.deepEqual(setQuantity(cart, B, 70), [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 20 }]);
  assert.deepEqual(setQuantity(cart, C, 3), cart, 'a pack that is not in the cart is not added by a set');
  assert.deepEqual(removeLine(cart, A), [{ variantId: B, quantity: 4 }]);
  assert.deepEqual(removeLine(cart, C), cart);
});

test('the cart is never changed in place', () => {
  const cart = Object.freeze([Object.freeze({ variantId: A, quantity: 1 })]);
  assert.doesNotThrow(() => { addLine(cart, A); setQuantity(cart, A, 3); removeLine(cart, A); mergeCarts(cart, cart); });
});

test('signing in with a cart already on the server keeps both: quantities add up, capped, server order first', () => {
  const server = [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 18 }];
  const local = [{ variantId: B, quantity: 5 }, { variantId: C, quantity: 1 }];
  assert.deepEqual(mergeCarts(server, local), [{ variantId: A, quantity: 2 }, { variantId: B, quantity: 20 }, { variantId: C, quantity: 1 }]);
  assert.deepEqual(mergeCarts([], local), local);
  assert.deepEqual(mergeCarts(server, []), server);
});

test('item count adds quantities, not lines', () => {
  assert.equal(itemCount([{ variantId: A, quantity: 2 }, { variantId: B, quantity: 3 }]), 5);
  assert.equal(itemCount([]), 0);
});

test('a damaged or tampered saved cart is dropped line by line and never crashes the page', () => {
  assert.deepEqual(parseStoredCart(null), []);
  assert.deepEqual(parseStoredCart(''), []);
  assert.deepEqual(parseStoredCart('{not json'), []);
  assert.deepEqual(parseStoredCart('{"a":1}'), []);
  assert.deepEqual(parseStoredCart('"text"'), []);
  const mixed = JSON.stringify([
    { variantId: A, quantity: 2 },
    { variantId: 'not-a-uuid', quantity: 1 },
    { variantId: B, quantity: '5' },
    { variantId: B, quantity: 999 },
    { variantId: B, quantity: 3 },
    null,
    7,
    { quantity: 4 },
    { variantId: C, quantity: -3 },
  ]);
  assert.deepEqual(parseStoredCart(mixed), [
    { variantId: A, quantity: 2 },
    { variantId: B, quantity: 20 },
    { variantId: C, quantity: 1 },
  ]);
});

test('display totals: items, what the MRPs would have been, and the saving — a price above its MRP is not a negative saving', () => {
  assert.deepEqual(cartTotals([{ quantity: 2, price: 300, mrp: 340 }, { quantity: 1, price: 1100, mrp: 1300 }]), { subtotal: 1700, mrpTotal: 1980, savings: 280 });
  assert.deepEqual(cartTotals([{ quantity: 1, price: 500, mrp: 400 }]), { subtotal: 500, mrpTotal: 500, savings: 0 });
  assert.deepEqual(cartTotals([]), { subtotal: 0, mrpTotal: 0, savings: 0 });
});

const RULE = { deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 499 };

test('delivery quote follows the server rule: free only when the cart meets the minimum AND the free level', () => {
  assert.deepEqual(quoteDelivery(0, RULE), { fee: 0, amountToFree: 499, progress: 0, hasFreeDelivery: true });
  assert.deepEqual(quoteDelivery(400, RULE), { fee: 49, amountToFree: 99, progress: 400 / 499, hasFreeDelivery: true });
  assert.equal(quoteDelivery(498, RULE).fee, 49);
  assert.deepEqual(quoteDelivery(499, RULE), { fee: 0, amountToFree: 0, progress: 1, hasFreeDelivery: true });
  const odd = { deliveryFee: 49, minimumOrderValue: 500, freeDeliveryThreshold: 300 };
  assert.equal(quoteDelivery(400, odd).fee, 49, 'meets the free level but not the minimum: still charged');
  assert.equal(quoteDelivery(400, odd).amountToFree, 100);
  assert.equal(quoteDelivery(500, odd).fee, 0);
});

test('an area with no free-delivery level never promises free delivery', () => {
  const none = { ...RULE, freeDeliveryThreshold: null };
  assert.deepEqual(quoteDelivery(2000, none), { fee: 49, amountToFree: 0, progress: 0, hasFreeDelivery: false });
});
