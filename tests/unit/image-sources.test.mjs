// Product / category / order images: which URL is shown, and when the branded fallback appears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSources, orderItemImages } from '../../services/imageSources.ts';
import { toCategory, toProduct } from '../../services/supabase/mappers.ts';

test('imageSources keeps order, drops empties and duplicates', () => {
  assert.deepEqual(imageSources('a', 'b'), ['a', 'b']);
  assert.deepEqual(imageSources(null, undefined, '', '  ', 'b'), ['b']);
  assert.deepEqual(imageSources('a', 'a'), ['a']);
  assert.deepEqual(imageSources(' a ', 'a'), ['a'], 'whitespace does not defeat de-duplication');
  assert.deepEqual(imageSources(), []);
});

test('an order line uses its snapshot first and the product photo as the fallback', () => {
  assert.deepEqual(orderItemImages('snap.jpg', 'live.jpg'), { image: 'snap.jpg', fallbackImage: 'live.jpg' });
});

test('an order line with no snapshot shows the product photo straight away', () => {
  assert.deepEqual(orderItemImages(null, 'live.jpg'), { image: 'live.jpg' });
  assert.deepEqual(orderItemImages('', 'live.jpg'), { image: 'live.jpg' });
});

test('an order line with neither image yields an empty string (AppImage then shows the branded tile)', () => {
  assert.deepEqual(orderItemImages(null, null), { image: '' });
  assert.deepEqual(orderItemImages(undefined, undefined), { image: '' });
});

test('a snapshot equal to the live photo is not offered twice', () => {
  assert.deepEqual(orderItemImages('same.jpg', 'same.jpg'), { image: 'same.jpg' });
});

const productRow = (over = {}) => ({
  id: 'p1', slug: 'almonds', name: 'Almonds', short_description: null, category_id: 'c1', description: null,
  image: null, gallery: [], tags: [], product_variants: [], ...over,
});

test('a product shows exactly the images that were uploaded, primary first', () => {
  const p = toProduct(productRow({ image: 'main.jpg', gallery: ['g1.jpg', 'g2.jpg'] }));
  assert.deepEqual(p.images, ['main.jpg', 'g1.jpg', 'g2.jpg']);
});

test('a product with no image has none — never a borrowed stock photo', () => {
  assert.deepEqual(toProduct(productRow()).images, []);
  assert.deepEqual(toProduct(productRow({ gallery: null })).images, []);
});

test('two different products without images do not end up sharing one picture', () => {
  const a = toProduct(productRow({ id: 'a', name: 'Garlic powder' }));
  const b = toProduct(productRow({ id: 'b', name: 'Kasuri methi' }));
  assert.deepEqual([a.images, b.images], [[], []]);
});

test('a gallery-only product uses its gallery photo as the first image', () => {
  assert.deepEqual(toProduct(productRow({ gallery: ['g1.jpg'] })).images, ['g1.jpg']);
});

const categoryRow = (over = {}) => ({ id: 'c1', slug: 'dates', name: 'Dates', description: null, parent_id: null, image_url: null, ...over });

test('a category image is passed through as both thumbnail and hero', () => {
  const c = toCategory(categoryRow({ image_url: 'https://x/y.jpg' }));
  assert.equal(c.thumbnail, 'https://x/y.jpg');
  assert.equal(c.heroImage, 'https://x/y.jpg');
});

test('a category without an image, or with a blank one, has null (the screens then show their neutral tile)', () => {
  assert.equal(toCategory(categoryRow()).thumbnail, null);
  assert.equal(toCategory(categoryRow({ image_url: '   ' })).thumbnail, null);
});
