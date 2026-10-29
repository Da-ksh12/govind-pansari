// What a customer sees for a category: a real picture, and only categories that have something to buy. The first fixtures are the
// REAL category tree and product counts read from the live store on 2026-10-28 (the "Dry spices" tile showed a grey grid icon).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasImage, isBrowsable, pickRepresentativeImages, selfAndDescendants, totalProductCount } from '../../services/categoryDisplay.ts';

const LIVE = [
  { id: 'dry-spices', parentId: null }, // empty, no image (the tile in the screenshot)
  { id: 'hbfkg', parentId: null }, //      empty, no image (test category)
  { id: 'almonds', parentId: 'dry-fruits' },
  { id: 'makhana', parentId: 'dry-fruits' },
  { id: 'dry-fruits', parentId: null },
  { id: 'cashews', parentId: 'dry-fruits' },
  { id: 'spices', parentId: null },
  { id: 'tea', parentId: null },
];
const COUNTS = new Map([['dry-spices', 0], ['hbfkg', 0], ['almonds', 2], ['makhana', 2], ['dry-fruits', 5], ['cashews', 4], ['spices', 16], ['tea', 2]]);
const ids = (list) => list.map((c) => c.id);

test('the two empty categories are not shown to customers; everything with products is', () => {
  const shown = LIVE.filter((c) => isBrowsable(LIVE, COUNTS, c.id));
  assert.deepEqual(ids(shown).sort(), ['almonds', 'cashews', 'dry-fruits', 'makhana', 'spices', 'tea']);
  assert.equal(isBrowsable(LIVE, COUNTS, 'dry-spices'), false);
  assert.equal(isBrowsable(LIVE, COUNTS, 'hbfkg'), false);
});

test('a parent with no products of its own is still shown when a sub-category has some', () => {
  const tree = [{ id: 'p', parentId: null }, { id: 'c', parentId: 'p' }];
  const counts = new Map([['p', 0], ['c', 3]]);
  assert.equal(totalProductCount(tree, counts, 'p'), 3);
  assert.equal(isBrowsable(tree, counts, 'p'), true);
  assert.equal(isBrowsable(tree, new Map([['p', 0], ['c', 0]]), 'p'), false);
});

test('descendants are found at any depth, and a cycle in bad data cannot loop forever', () => {
  const deep = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd', parentId: 'c' }];
  assert.deepEqual(selfAndDescendants(deep, 'a'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selfAndDescendants(deep, 'c'), ['c', 'd']);
  const cyc = [{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }];
  assert.deepEqual(selfAndDescendants(cyc, 'x'), ['x', 'y']);
});

test('a category with no image borrows the first photo of a product it contains', () => {
  const photos = [{ categoryId: 'tea', image: 'tea-1.jpg' }, { categoryId: 'spices', image: 'turmeric.jpg' }, { categoryId: 'spices', image: 'chilli.jpg' }];
  const out = pickRepresentativeImages(LIVE, ['spices', 'tea'], photos);
  assert.equal(out.get('spices'), 'turmeric.jpg', 'the first photo in the given (oldest-first) order, so the tile does not change between loads');
  assert.equal(out.get('tea'), 'tea-1.jpg');
});

test('a parent with no photo of its own borrows from its own products first, then from its sub-categories', () => {
  const photos = [{ categoryId: 'almonds', image: 'almond.jpg' }, { categoryId: 'dry-fruits', image: 'mixed.jpg' }, { categoryId: 'cashews', image: 'cashew.jpg' }];
  assert.equal(pickRepresentativeImages(LIVE, ['dry-fruits'], photos).get('dry-fruits'), 'mixed.jpg', 'its own product wins');
  const onlyBelow = photos.filter((p) => p.categoryId !== 'dry-fruits');
  assert.equal(pickRepresentativeImages(LIVE, ['dry-fruits'], onlyBelow).get('dry-fruits'), 'almond.jpg', 'otherwise the first sub-category with a photo');
});

test('a category with no product photo anywhere below it gets nothing — never an invented picture', () => {
  const out = pickRepresentativeImages(LIVE, ['dry-spices', 'hbfkg'], [{ categoryId: 'tea', image: 'tea-1.jpg' }]);
  assert.equal(out.size, 0);
  assert.equal(pickRepresentativeImages(LIVE, ['tea'], [{ categoryId: 'tea', image: '   ' }]).size, 0, 'a blank URL is not a photo');
  assert.equal(pickRepresentativeImages(LIVE, ['tea'], [{ categoryId: 'spices', image: 'chilli.jpg' }]).size, 0, 'another category\'s photo is not borrowed');
});

test('only a real, non-empty string counts as an image', () => {
  assert.equal(hasImage('https://x/y.jpg'), true);
  for (const bad of [null, undefined, '', '   ']) assert.equal(hasImage(bad), false);
});

const source = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('the customer category lists go through the one function that borrows photos and hides empty categories', () => {
  const repo = code('services/repositories/categoryRepository.ts');
  assert.match(repo, /pickRepresentativeImages\(/);
  assert.match(repo, /isBrowsable\(/);
  assert.match(repo, /async list\(\): Promise<Category\[\]> \{\s*return browsable\(await loadCategories\(\)\);/);
  assert.match(repo, /listTopLevel[\s\S]*categoryRepository\.list\(\)/, 'home, search and cart use the same filtered list');
  assert.match(repo, /getTree[\s\S]*categoryRepository\.list\(\)/);
  assert.doesNotMatch(repo, /\.from\('categories'\)\.select\('\*'\)\.eq\('is_active', true\)\.is\('parent_id', null\)/, 'no second, unfiltered top-level query');
});

test('a failed photo lookup never breaks the category list (the tile just stays neutral)', () => {
  assert.match(code('services/repositories/categoryRepository.ts'), /if \(error \|\| !data\) return \[\]/);
});

test('admin: a category cannot be saved without an image, and one without is flagged in the list', () => {
  const src = code('app/admin/categories.tsx');
  assert.match(src, /if \(!imageUrl\) return showToast\('Add a category image/);
  assert.match(src, /!item\.image_url \? <Text style=\{styles\.noImage\}>No image/);
});

// ---- Search screen: the heading under the search bar ---------------------------------------------------------------

test('Search: the bar is not wrapped in a flex:1 view (it collapsed the row and let "Popular Right Now" slide under the bar)', () => {
  const src = code('app/(tabs)/search.tsx');
  const row = src.slice(src.indexOf('const searchRowContent'), src.indexOf('const recentSection'));
  assert.doesNotMatch(row, /flex: 1/);
  assert.match(row, /<View style=\{styles\.searchRow\}>\s*<SearchBar/);
  const styles = src.slice(src.indexOf('searchRow:'), src.indexOf('content:'));
  assert.match(styles, /minHeight: 48 \+ spacing\.sm \* 2/, 'the row reserves the bar\'s height itself');
  assert.match(styles, /flexShrink: 0/);
});
