// "No store can fulfil your cart": a variant with no inventory row at the customer's store
// used to be shown as "In Stock", so it could be added to the cart and only failed at checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toProduct } from '../../services/supabase/mappers.ts';

const variant = (id) => ({ id, product_id: 'p1', sku: `SKU-${id}`, weight_value: 500, weight_unit: 'g', mrp: 100, price: 90, is_active: true });
const row = (variants) => ({
  id: 'p1', slug: 'namkeen', name: 'Namkeen', short_description: null, category_id: 'c1', description: null,
  image: 'x.jpg', gallery: [], tags: [], product_variants: variants,
});
const statuses = (product) => product.variants.map((v) => v.stockStatus);

test('a variant the customer\'s store does not stock is out of stock', () => {
  const p = toProduct(row([variant('a'), variant('b')]), { availabilityByVariant: new Map([['a', 'in_stock']]), storeId: 's1' });
  assert.deepEqual(statuses(p), ['in_stock', 'out_of_stock']);
});

test('statuses the store reports are kept as they are', () => {
  const map = new Map([['a', 'in_stock'], ['b', 'low_stock'], ['c', 'out_of_stock']]);
  const p = toProduct(row([variant('a'), variant('b'), variant('c')]), { availabilityByVariant: map, storeId: 's1' });
  assert.deepEqual(statuses(p), ['in_stock', 'low_stock', 'out_of_stock']);
});

test('a product no variant of which is stocked is not available in the area', () => {
  const p = toProduct(row([variant('a')]), { availabilityByVariant: new Map(), storeId: 's1' });
  assert.deepEqual(statuses(p), ['out_of_stock']);
  assert.equal(p.availableInArea, false);
});

test('with no store context (or a failed lookup) stock is simply unknown, not "out of stock"', () => {
  const p = toProduct(row([variant('a')]), {});
  assert.deepEqual(statuses(p), ['in_stock']);
  assert.equal(p.availableInArea, true);
});
