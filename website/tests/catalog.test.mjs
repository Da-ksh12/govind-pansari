// The catalogue model: what a visitor sees as in stock, which badges show, and how prices and packs are presented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, discountPercent, weightLabel, weightInGrams, pluralize } from '../lib/format.ts';
import {
  bestDiscount,
  defaultVariant,
  deriveBadges,
  mergeAvailability,
  priceRange,
  productInStock,
  startingPrice,
  toProduct,
} from '../lib/catalog/model.ts';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const AWV = 'store-awv';
const VJN = 'store-vjn';
const SNP = 'store-snp-inactive';

const variantRow = (id, grams, price, mrp, over = {}) => ({ id, sku: `SKU-${id}`, weight_value: grams >= 1000 ? grams / 1000 : grams, weight_unit: grams >= 1000 ? 'kg' : 'g', price, mrp, is_active: true, ...over });
const productRow = (over = {}) => ({
  id: 'p1', slug: 'almonds', name: 'California Almonds', description: 'Crunchy.', short_description: 'Premium almonds', category_id: 'c1', image: 'https://x.test/a.jpg', gallery: ['https://x.test/b.jpg'],
  tags: ['gifting'], is_featured: false, is_bestseller: false, created_at: '2026-01-01T00:00:00Z', categories: { name: 'Almonds', slug: 'almonds' },
  product_variants: [variantRow('v1000', 1000, 1000, 1200), variantRow('v250', 250, 300, 300), variantRow('v500', 500, 580, 600)], ...over,
});

// ---- formatting ----------------------------------------------------------------------------------------------------------------

test('money: whole rupees without paise, paise only when there are some, never NaN', () => {
  assert.equal(formatINR(1299), '₹1,299');
  assert.equal(formatINR(49.5), '₹49.50');
  assert.equal(formatINR(100000), '₹1,00,000', 'Indian digit grouping');
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(Number.NaN), '₹0');
  assert.equal(formatINR(Number.POSITIVE_INFINITY), '₹0');
});

test('a discount is advertised only when the MRP really is higher than the price', () => {
  assert.equal(discountPercent(800, 1000), 20);
  assert.equal(discountPercent(580, 600), 3);
  assert.equal(discountPercent(1000, 1000), 0, 'equal: no saving');
  assert.equal(discountPercent(1200, 1000), 0, 'price above MRP: no saving');
  assert.equal(discountPercent(500, 0), 0);
  assert.equal(discountPercent(Number.NaN, 100), 0);
  assert.equal(discountPercent(-5, 100), 0);
});

test('pack sizes read naturally and sort by real weight whatever the unit', () => {
  assert.equal(weightLabel(250, 'g'), '250 g');
  assert.equal(weightLabel(1, 'kg'), '1 kg');
  assert.equal(weightLabel(1.5, 'kg'), '1.5 kg');
  assert.equal(weightInGrams(1, 'kg'), 1000);
  assert.equal(weightInGrams(500, 'g'), 500);
  assert.equal(pluralize(1, 'item'), '1 item');
  assert.equal(pluralize(2, 'item'), '2 items');
});

// ---- stock ---------------------------------------------------------------------------------------------------------------------

test('a pack is as available as its best ACTIVE store; an inactive store never counts', () => {
  const rows = [
    { product_variant_id: 'a', store_id: AWV, stock_status: 'out_of_stock' },
    { product_variant_id: 'a', store_id: VJN, stock_status: 'low_stock' },
    { product_variant_id: 'b', store_id: AWV, stock_status: 'in_stock' },
    { product_variant_id: 'b', store_id: VJN, stock_status: 'out_of_stock' },
    { product_variant_id: 'c', store_id: SNP, stock_status: 'in_stock' }, // only the inactive Sanjay Place has it
    { product_variant_id: 'd', store_id: AWV, stock_status: 'out_of_stock' },
  ];
  const m = mergeAvailability(rows, [AWV, VJN]);
  assert.equal(m.get('a'), 'low_stock', 'best of out/low');
  assert.equal(m.get('b'), 'in_stock');
  assert.equal(m.has('c'), false, 'stock held only by an inactive store is not sellable');
  assert.equal(m.get('d'), 'out_of_stock');
  assert.equal(mergeAvailability(rows, []).size, 0, 'no active stores: nothing is available');
});

test('a pack with no stock row anywhere is out of stock, not "in stock by default"', () => {
  const p = toProduct(productRow(), new Map([['v250', 'in_stock']]), undefined, NOW);
  const byId = Object.fromEntries(p.variants.map((v) => [v.id, v.stock]));
  assert.deepEqual(byId, { v250: 'in_stock', v500: 'out_of_stock', v1000: 'out_of_stock' });
  assert.equal(productInStock(p), true);
  assert.equal(productInStock(toProduct(productRow(), new Map(), undefined, NOW)), false);
});

// ---- products ------------------------------------------------------------------------------------------------------------------

test('packs are listed smallest first, inactive packs are hidden, numbers arrive as numbers', () => {
  const row = productRow({ product_variants: [variantRow('v1000', 1000, '1000.00', '1200.00'), variantRow('gone', 100, 50, 50, { is_active: false }), variantRow('v250', 250, 300, 300)] });
  const p = toProduct(row, new Map([['v1000', 'in_stock'], ['v250', 'in_stock']]), undefined, NOW);
  assert.deepEqual(p.variants.map((v) => v.label), ['250 g', '1 kg']);
  assert.equal(p.variants[1].price, 1000);
  assert.equal(p.variants[1].discountPercent, 17);
  assert.equal(p.variants[0].discountPercent, 0);
});

test('pictures: exactly what was uploaded, main first, no duplicates, none invented', () => {
  const dup = toProduct(productRow({ image: 'https://x.test/a.jpg', gallery: ['https://x.test/a.jpg', ' https://x.test/b.jpg ', '', null] }), new Map(), undefined, NOW);
  assert.deepEqual(dup.images, ['https://x.test/a.jpg', 'https://x.test/b.jpg']);
  assert.deepEqual(toProduct(productRow({ image: null, gallery: null }), new Map(), undefined, NOW).images, []);
  assert.deepEqual(toProduct(productRow({ image: '  ', gallery: [] }), new Map(), undefined, NOW).images, []);
});

test('badges: bestseller and premium come from the product, "new" only for 14 days and never for a future date', () => {
  const day = 86_400_000;
  assert.deepEqual(deriveBadges({ is_bestseller: true, is_featured: true, created_at: '2025-01-01T00:00:00Z' }, NOW), ['bestseller', 'premium']);
  assert.deepEqual(deriveBadges({ is_bestseller: false, is_featured: false, created_at: new Date(NOW - 14 * day).toISOString() }, NOW), ['new']);
  assert.deepEqual(deriveBadges({ is_bestseller: false, is_featured: false, created_at: new Date(NOW - 15 * day).toISOString() }, NOW), []);
  assert.deepEqual(deriveBadges({ is_bestseller: false, is_featured: false, created_at: new Date(NOW + day).toISOString() }, NOW), [], 'a future date is not "new"');
  assert.deepEqual(deriveBadges({ is_bestseller: false, is_featured: false, created_at: 'garbage' }, NOW), []);
});

test('the quick-add pack is the smallest one in stock; prices start from what can actually be bought', () => {
  const p = toProduct(productRow(), new Map([['v500', 'in_stock'], ['v1000', 'low_stock']]), undefined, NOW);
  assert.equal(defaultVariant(p).id, 'v500', '250 g is sold out, so 500 g');
  assert.equal(startingPrice(p), 580, 'the sold-out 250 g at ₹300 does not make the product look cheaper');
  assert.deepEqual(priceRange(p), { min: 300, max: 1000 });
  const none = toProduct(productRow(), new Map(), undefined, NOW);
  assert.equal(defaultVariant(none).id, 'v250', 'nothing in stock: the smallest pack, shown as sold out');
  assert.equal(startingPrice(none), 300);
});

test('the headline saving is the best real one across packs, and zero when there is none', () => {
  assert.equal(bestDiscount(toProduct(productRow(), new Map(), undefined, NOW)), 17);
  const flat = toProduct(productRow({ product_variants: [variantRow('v1', 250, 300, 300)] }), new Map(), undefined, NOW);
  assert.equal(bestDiscount(flat), 0);
  assert.equal(bestDiscount({ ...flat, variants: [] }), 0);
});

test('a product with no packs does not crash anything', () => {
  const p = toProduct(productRow({ product_variants: null }), new Map(), undefined, NOW);
  assert.equal(defaultVariant(p), undefined);
  assert.equal(startingPrice(p), 0);
  assert.deepEqual(priceRange(p), { min: 0, max: 0 });
  assert.equal(productInStock(p), false);
});

test('when the stock view cannot be read, variants are "unknown" (still purchasable), never silently "sold out"', () => {
  const row = {
    id: 'p1', slug: 'p', name: 'P', description: null, short_description: null, category_id: null, image: null, gallery: null, tags: null,
    is_featured: false, is_bestseller: false, created_at: '2020-01-01T00:00:00Z',
    product_variants: [{ id: 'v1', sku: 'S', weight_value: 500, weight_unit: 'g', price: 100, mrp: 100, is_active: true }],
  };
  const known = toProduct(row, new Map());
  assert.equal(known.variants[0].stock, 'out_of_stock');
  assert.equal(productInStock(known), false);
  const unknown = toProduct(row, new Map(), undefined, Date.now(), 'unknown');
  assert.equal(unknown.variants[0].stock, 'unknown');
  assert.equal(productInStock(unknown), true);
});
