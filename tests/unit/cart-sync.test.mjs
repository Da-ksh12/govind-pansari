// The cart must survive a restart and never lose or double items. Pure sync rules (services/cartSync.ts) plus static
// guards for the specific defects: a failed read replacing the cart with an empty one, whole-cart rollbacks, and the
// missing Home cart icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cartItemCount, formatBadge, reconcileWithServer, restoreLine, undoAdd } from '../../services/cartSync.ts';

const source = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const line = (variantId, quantity, extra = {}) => ({ id: `cart-${variantId}`, productId: `p-${variantId}`, variantId, quantity, ...extra });
const srv = (variantId, quantity) => ({ variantId, productId: `p-${variantId}`, quantity });

test('the server cart becomes the on-device cart: one line per variant, no duplicates', () => {
  const out = reconcileWithServer([], [srv('a', 2), srv('b', 1), srv('a', 5)], new Set());
  assert.deepEqual(out.map((i) => [i.variantId, i.quantity]), [['a', 2], ['b', 1]]);
});

test('restoring the same cart twice changes nothing (no doubled quantities)', () => {
  const once = reconcileWithServer([line('a', 2)], [srv('a', 2)], new Set());
  const twice = reconcileWithServer(once, [srv('a', 2)], new Set());
  assert.deepEqual(twice, once);
  assert.equal(cartItemCount(twice), 2);
});

test('"saved for later" stays saved when the cart is synced', () => {
  const out = reconcileWithServer([line('a', 1, { savedForLater: true })], [srv('a', 1)], new Set());
  assert.equal(out[0].savedForLater, true);
});

test('an item the server removed (e.g. order created) disappears; the rest stay', () => {
  const out = reconcileWithServer([line('a', 1), line('b', 1)], [srv('b', 1)], new Set());
  assert.deepEqual(out.map((i) => i.variantId), ['b']);
});

test('a change still in flight is not overwritten by an older server answer', () => {
  // The customer just tapped + on "a" (now 3 locally); the server still says 2.
  const out = reconcileWithServer([line('a', 3)], [srv('a', 2)], new Set(['a']));
  assert.equal(out[0].quantity, 3);
  // A brand-new item the server does not list yet is kept while its add is in flight.
  const added = reconcileWithServer([line('a', 1), line('new', 1)], [srv('a', 1)], new Set(['new']));
  assert.deepEqual(added.map((i) => i.variantId).sort(), ['a', 'new']);
  // Once nothing is in flight the server is the truth again.
  assert.deepEqual(reconcileWithServer([line('a', 1), line('new', 1)], [srv('a', 1)], new Set()).map((i) => i.variantId), ['a']);
});

test('a refused add takes back only that quantity from that variant — other taps survive', () => {
  const items = [line('a', 3), line('b', 2)];
  const out = undoAdd(items, 'a', 1);
  assert.deepEqual(out.map((i) => [i.variantId, i.quantity]), [['a', 2], ['b', 2]]);
  // A refused first add removes the line entirely.
  assert.deepEqual(undoAdd([line('a', 1), line('b', 2)], 'a', 1).map((i) => i.variantId), ['b']);
});

test('a refused remove / quantity change puts back only that line', () => {
  const before = line('a', 4);
  const afterRemove = [line('b', 2)];
  assert.deepEqual(restoreLine(afterRemove, 'a', before).map((i) => i.variantId).sort(), ['a', 'b']);
  // Quantity change refused: restore the old quantity, leave others as they are now.
  const mid = [line('a', 9), line('b', 7)];
  const restored = restoreLine(mid, 'a', before);
  assert.equal(restored.find((i) => i.variantId === 'a').quantity, 4);
  assert.equal(restored.find((i) => i.variantId === 'b').quantity, 7);
});

test('the Home badge counts real items (not saved-for-later), and caps at 99+', () => {
  assert.equal(cartItemCount([line('a', 2), line('b', 3), line('c', 5, { savedForLater: true })]), 5);
  assert.equal(cartItemCount([]), 0);
  assert.equal(formatBadge(7), '7');
  assert.equal(formatBadge(100), '99+');
});

// ---- static guards -------------------------------------------------------------------------------------------------

test('a cart that cannot be READ is an error, never "an empty cart" that replaces the real one', () => {
  const repo = source('services/repositories/cartRepository.ts');
  assert.match(repo, /if \(cartError\) throw toCatalogueError\(cartError\)/);
  // The signed-in check uses the local session; getUser() is a network call whose failure used to look like "signed out".
  assert.match(repo, /auth\.getSession\(\)/);
  assert.doesNotMatch(repo, /auth\.getUser\(\)/);
  const store = source('store/cartStore.ts');
  assert.match(store, /await whenHydrated\(\)/);
  assert.match(store, /never replace a real cart/);
  // Only the lines are persisted.
  assert.match(store, /partialize: \(state\) => \(\{ items: state\.items \}\)/);
});

test('rollbacks are per line, not a snapshot of the whole cart', () => {
  const store = source('store/cartStore.ts');
  assert.doesNotMatch(store, /set\(\{ items: previous \}\)/);
  assert.match(store, /undoAdd\(state\.items, variantId, quantity\)/);
  assert.match(store, /restoreLine\(state\.items, variantId, previousLine\)/);
});

test('the Cart screen shows loading / retry — never "empty" — while stored items have not loaded', () => {
  const cart = source('app/cart.tsx');
  assert.match(cart, /totalCount === 0 && storedLineCount > 0/);
  assert.match(cart, /Couldn't load your cart/);
});

test('Home shows the cart icon in every state (loading and failed included), wired to the real cart', () => {
  const header = source('components/home/LocationHeader.tsx');
  assert.match(header, /testID="home-cart-button"/);
  assert.match(header, /router\.push\('\/cart'\)/);
  assert.match(header, /cartItemCount\(s\.items\)/);
  const home = source('app/(tabs)/index.tsx');
  // The same header element is rendered in the error, loading and loaded states.
  assert.equal((home.match(/\{header\}/g) ?? []).length, 3);
  assert.match(home, /<HomeSkeleton showHeader=\{isWide\} \/>/);
});
