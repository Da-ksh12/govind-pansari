// Shop URLs, search, filters, sorting and paging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toProduct } from '../lib/catalog/model.ts';
import { PAGE_SIZE, applyShopQuery, normalizeText, parseShopParams, priceBounds, searchScore, shopQuery, suggest } from '../lib/catalog/query.ts';

const NOW = Date.parse('2026-11-01T00:00:00Z');
let n = 0;
const make = (name, over = {}) => {
  n += 1;
  const id = `p${n}`;
  const { variants = [[250, 300, 300]], stock = 'in_stock', ...row } = over;
  const availability = new Map();
  const product_variants = variants.map(([grams, price, mrp], i) => {
    const vid = `${id}-v${i}`;
    availability.set(vid, stock);
    return { id: vid, sku: vid, weight_value: grams, weight_unit: 'g', price, mrp, is_active: true };
  });
  return toProduct({
    id, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, description: '', short_description: '', category_id: 'c', image: null, gallery: [], tags: [],
    is_featured: false, is_bestseller: false, created_at: '2026-01-01T00:00:00Z', categories: { name: 'Dry fruits', slug: 'dry-fruits' }, product_variants, ...row,
  }, availability, undefined, NOW);
};

const CATALOGUE = [
  make('California Almonds', { is_bestseller: true, tags: ['gifting', 'protein-rich'], variants: [[250, 300, 340], [1000, 1100, 1300]], created_at: '2026-03-01T00:00:00Z' }),
  make('Kashmiri Walnuts', { categories: { name: 'Walnuts', slug: 'walnuts' }, variants: [[500, 650, 650]], is_featured: true, created_at: '2026-02-01T00:00:00Z' }),
  make('Whole Cashews', { categories: { name: 'Cashews', slug: 'cashews' }, variants: [[250, 400, 450]], stock: 'out_of_stock', created_at: '2026-04-01T00:00:00Z' }),
  make('Roasted Pistachios', { categories: { name: 'Pistachios', slug: 'pistachios' }, short_description: 'Salted, roasted pistachios', variants: [[100, 220, 220]], created_at: '2026-05-01T00:00:00Z' }),
  make('Mixed Dry Fruit Gift Box', { categories: { name: 'Gift Hampers', slug: 'gift-hampers' }, tags: ['gifting'], variants: [[1000, 1800, 2000]], is_bestseller: true, is_featured: true, created_at: '2026-06-01T00:00:00Z' }),
];
const names = (items) => items.map((p) => p.name);
const params = (raw = {}) => parseShopParams(raw);

// ---- reading the URL -----------------------------------------------------------------------------------------------------------

test('the URL is untrusted: only clean values survive, everything else falls back to the defaults', () => {
  const p = params({ q: '  almonds   gift ', category: 'dry-fruits', tag: 'gifting', min: '100', max: '500', stock: '1', sort: 'price-asc', page: '3' });
  assert.deepEqual(p, { q: 'almonds gift', category: 'dry-fruits', tag: 'gifting', minPrice: 100, maxPrice: 500, inStock: true, sort: 'price-asc', page: 3 });
  const hostile = params({ q: 'x'.repeat(500), category: "a'; drop table products;--", tag: '../../etc', min: '-5', max: '1e9', stock: 'yes', sort: 'DROP', page: '-2' });
  assert.equal(hostile.q.length, 80);
  assert.equal(hostile.category, '');
  assert.equal(hostile.tag, '');
  assert.equal(hostile.minPrice, null);
  assert.equal(hostile.maxPrice, null);
  assert.equal(hostile.inStock, false);
  assert.equal(hostile.sort, 'relevance', 'a search with an unknown sort falls back to relevance');
  assert.equal(hostile.page, 1);
  assert.equal(params({}).sort, 'featured');
  assert.equal(params({ page: 'abc' }).page, 1);
  assert.equal(params({ category: ['almonds', 'walnuts'] }).category, 'almonds', 'a repeated parameter uses the first value');
});

test('a reversed price range is put the right way round', () => {
  const p = params({ min: '900', max: '100' });
  assert.deepEqual([p.minPrice, p.maxPrice], [100, 900]);
});

test('the same view always has the same URL, with defaults left out', () => {
  assert.equal(shopQuery(params({})), '');
  assert.equal(shopQuery(params({ q: 'almond' })), '?q=almond', 'relevance is the default for a search');
  assert.equal(shopQuery(params({ category: 'walnuts', sort: 'price-desc', page: '2', stock: '1', min: '50' })), '?category=walnuts&min=50&stock=1&sort=price-desc&page=2');
  assert.equal(shopQuery({ ...params({ page: '1' }), page: 1 }), '');
  const roundTrip = params(Object.fromEntries(new URLSearchParams(shopQuery(params({ q: 'box', tag: 'gifting', min: '10', max: '99', sort: 'newest' })))));
  assert.equal(roundTrip.q, 'box');
  assert.equal(roundTrip.sort, 'newest');
});

// ---- search --------------------------------------------------------------------------------------------------------------------

test('search ignores case, accents and punctuation', () => {
  assert.equal(normalizeText('Kāju — Katli!'), 'kaju katli');
  assert.equal(normalizeText('  Dry-Fruit  '), 'dry fruit');
  assert.ok(searchScore(CATALOGUE[0], 'ALMONDS') > 0);
  assert.ok(searchScore(CATALOGUE[0], 'california-almonds') > 0);
});

test('every word typed has to match somewhere; a name match beats a description match', () => {
  assert.ok(searchScore(CATALOGUE[3], 'roasted salted') > 0, 'one word in the name, one in the short text');
  assert.equal(searchScore(CATALOGUE[3], 'roasted almonds'), 0, 'a word that matches nothing rules the product out');
  assert.equal(searchScore(CATALOGUE[0], ''), 0);
  assert.equal(searchScore(CATALOGUE[0], '   '), 0);
  const inName = make('Pistachio Mix');
  const inShort = make('Premium Mix', { short_description: 'with pistachio' });
  assert.ok(searchScore(inName, 'pistachio') > searchScore(inShort, 'pistachio'));
});

test('suggestions: best products first, matching categories alongside, nothing for a one-letter query', () => {
  const s = suggest(CATALOGUE, [{ name: 'Walnuts', slug: 'walnuts' }, { name: 'Cashews', slug: 'cashews' }], 'walnut');
  assert.deepEqual(names(s.products), ['Kashmiri Walnuts']);
  assert.deepEqual(s.categories, [{ name: 'Walnuts', slug: 'walnuts' }]);
  assert.deepEqual(suggest(CATALOGUE, [], 'a'), { products: [], categories: [] });
  assert.deepEqual(suggest(CATALOGUE, [], 'zzzzzz'), { products: [], categories: [] });
  assert.ok(suggest(CATALOGUE, [], 'nuts', { products: 1, categories: 0 }).products.length <= 1);
});

// ---- filters, sorting, paging --------------------------------------------------------------------------------------------------

test('category, tag and in-stock filters', () => {
  assert.deepEqual(names(applyShopQuery(CATALOGUE, params({ category: 'walnuts' })).items), ['Kashmiri Walnuts']);
  assert.deepEqual(names(applyShopQuery(CATALOGUE, params({ tag: 'gifting', sort: 'name' })).items), ['California Almonds', 'Mixed Dry Fruit Gift Box']);
  const inStock = applyShopQuery(CATALOGUE, params({ stock: '1', sort: 'name' }));
  assert.equal(names(inStock.items).includes('Whole Cashews'), false);
  assert.equal(inStock.total, 4);
});

test('the price filter matches a product when ANY of its packs is in range', () => {
  const r = applyShopQuery(CATALOGUE, params({ min: '1000', max: '1200', sort: 'name' }));
  assert.deepEqual(names(r.items), ['California Almonds'], 'only its 1 kg pack (₹1,100) is in range, and that is enough');
  assert.equal(applyShopQuery(CATALOGUE, params({ max: '100' })).total, 0);
  assert.equal(applyShopQuery(CATALOGUE, params({ min: '1500' })).total, 1);
});

test('sorting by price uses what can actually be bought, in both directions, with stable ties', () => {
  const asc = names(applyShopQuery(CATALOGUE, params({ sort: 'price-asc' })).items);
  assert.equal(asc[0], 'Roasted Pistachios');
  assert.equal(asc.at(-1), 'Mixed Dry Fruit Gift Box');
  const desc = names(applyShopQuery(CATALOGUE, params({ sort: 'price-desc' })).items);
  assert.equal(desc[0], 'Mixed Dry Fruit Gift Box');
  assert.deepEqual(names(applyShopQuery(CATALOGUE, params({ sort: 'name' })).items), [...names(CATALOGUE)].sort((a, b) => a.localeCompare(b)));
  assert.equal(names(applyShopQuery(CATALOGUE, params({ sort: 'newest' })).items)[0], 'Mixed Dry Fruit Gift Box');
});

test('"featured" puts premium and bestsellers first; "bestseller" puts bestsellers first', () => {
  assert.equal(names(applyShopQuery(CATALOGUE, params({})).items)[0], 'Mixed Dry Fruit Gift Box', 'premium + bestseller');
  const best = names(applyShopQuery(CATALOGUE, params({ sort: 'bestseller' })).items);
  assert.deepEqual(best.slice(0, 2), ['Mixed Dry Fruit Gift Box', 'California Almonds']);
});

test('a search lists the best match first', () => {
  const r = applyShopQuery(CATALOGUE, params({ q: 'pistachios' }));
  assert.equal(r.items[0].name, 'Roasted Pistachios');
  assert.equal(r.total, 1);
});

test('paging: twelve to a page, the last page is partial, an out-of-range page is clamped, an empty result still has one page', () => {
  const many = Array.from({ length: 30 }, (_, i) => make(`Product ${String(i).padStart(2, '0')}`));
  const first = applyShopQuery(many, params({ sort: 'name' }));
  assert.equal(first.items.length, PAGE_SIZE);
  assert.equal(first.pageCount, 3);
  assert.equal(first.total, 30);
  const last = applyShopQuery(many, params({ sort: 'name', page: '3' }));
  assert.equal(last.items.length, 6);
  assert.equal(last.items[0].name, 'Product 24');
  assert.equal(applyShopQuery(many, params({ page: '99' })).page, 3);
  const empty = applyShopQuery(many, params({ q: 'nothing like this' }));
  assert.deepEqual([empty.total, empty.pageCount, empty.page, empty.items.length], [0, 1, 1, 0]);
});

test('the filter does not change the catalogue it is given', () => {
  const before = names(CATALOGUE);
  applyShopQuery(CATALOGUE, params({ sort: 'price-desc' }));
  assert.deepEqual(names(CATALOGUE), before);
});

test('price bounds for the filter placeholders', () => {
  assert.deepEqual(priceBounds(CATALOGUE), { min: 220, max: 1800 });
  assert.deepEqual(priceBounds([]), { min: 0, max: 0 });
});
