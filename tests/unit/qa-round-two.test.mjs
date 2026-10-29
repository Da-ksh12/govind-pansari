// Fixes from the tester's second report: TC-24 (store alert), TC-27 (both labels), TC-28 (blank form), TC-29 (urgent stock
// list), TC-30 (checkout wait), TC-32 (Back on admin pages). Logic is tested directly; the screens are pinned at the places
// where the defect lived (they cannot be rendered in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_VISIBLE_BADGES, visibleBadges } from '../../services/productBadges.ts';
import { isLowStock, isOutOfStock, rankInventoryAttention } from '../../services/inventoryAttention.ts';
import { handleAdminBack, setAdminBackGuard } from '../../services/adminBackGuard.ts';

const source = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ---- TC-27: Best Seller and Premium both show ---------------------------------------------------------------------

test('TC-27: a product that is both Best Seller and Premium shows BOTH labels', () => {
  assert.deepEqual(visibleBadges(['bestseller', 'premium']), ['bestseller', 'premium']);
  assert.deepEqual(visibleBadges(['premium', 'bestseller']), ['bestseller', 'premium'], 'order is fixed, not the order the data arrived in');
});

test('TC-27: the admin\'s two switches win over the automatic "New" label when space is short', () => {
  assert.deepEqual(visibleBadges(['new', 'premium', 'bestseller']), ['bestseller', 'premium']);
  assert.deepEqual(visibleBadges(['new', 'bestseller']), ['bestseller', 'new']);
  assert.deepEqual(visibleBadges(['new']), ['new']);
  assert.equal(MAX_VISIBLE_BADGES, 2, 'a narrow product card never gets more than two stacked labels');
});

test('TC-27: no badges, repeated badges and a smaller limit are handled', () => {
  assert.deepEqual(visibleBadges([]), []);
  assert.deepEqual(visibleBadges(undefined), []);
  assert.deepEqual(visibleBadges(['premium', 'premium']), ['premium']);
  assert.deepEqual(visibleBadges(['bestseller', 'premium'], 1), ['bestseller']);
  assert.deepEqual(visibleBadges(['bestseller', 'premium'], 0), []);
});

test('TC-27: the product card and both product-page spots render the stack, not just badges[0]', () => {
  for (const file of ['components/product/ProductCard.tsx', 'app/product/[slug].tsx']) {
    const src = code(file);
    assert.doesNotMatch(src, /badges\[0\]/, `${file} must not show only the first badge`);
    assert.match(src, /ProductBadgeStack/);
  }
  assert.equal((code('app/product/[slug].tsx').match(/<ProductBadgeStack/g) ?? []).length, 2, 'both product-page layouts');
});

// ---- TC-29: the urgent-stock list ---------------------------------------------------------------------------------

const row = (id, name, available, reorder = 5, isAvailable = true) => ({ id, product_name: name, available_quantity: available, reorder_level: reorder, is_available: isAvailable });

test('TC-29: low-stock items come first, fewest left first — a product published with 1 unit is at the top', () => {
  const rows = [row('a', 'Out A', 0), row('b', 'Big stock', 400, 500), row('c', 'Roasted Makhana', 3), row('d', 'Out B', 0), row('e', 'New product', 1), row('f', 'Healthy', 90)];
  const ranked = rankInventoryAttention(rows).map((r) => r.product_name);
  assert.deepEqual(ranked, ['New product', 'Roasted Makhana', 'Big stock', 'Out A', 'Out B']);
  assert.equal(ranked.slice(0, 4).includes('New product'), true, 'it is inside the dashboard\'s short list');
});

test('TC-29: the live data that exposed the bug now ranks correctly (two out-of-stock + two big "low" rows were shown, Makhana was not)', () => {
  const live = [row('1', 'Apple Iphone 18 pro max', 400, 500), row('2', 'Apple Iphone 18 pro max', 99, 100), row('3', 'ghgh', 0), row('4', 'jjllk', 0), row('5', 'Roasted Makhana', 3), row('6', 'Vanaspati tail', 5)];
  const top = rankInventoryAttention(live).slice(0, 3).map((r) => r.product_name);
  assert.deepEqual(top, ['Roasted Makhana', 'Vanaspati tail', 'Apple Iphone 18 pro max']);
});

test('TC-29: the list uses the same definitions as the Low Stock and Out of Stock cards', () => {
  assert.equal(isLowStock(row('x', 'a', 1)), true);
  assert.equal(isLowStock(row('x', 'a', 5)), true, 'at the reorder level counts');
  assert.equal(isLowStock(row('x', 'a', 6)), false);
  assert.equal(isLowStock(row('x', 'a', 0)), false, 'nothing left is out of stock, not low');
  assert.equal(isLowStock(row('x', 'a', 2, 5, false)), false, 'a store that does not sell it is not counted (the card does not count it)');
  assert.equal(isOutOfStock(row('x', 'a', 0)), true);
  assert.equal(isOutOfStock(row('x', 'a', -2)), true);
  assert.equal(isOutOfStock(row('x', 'a', 1)), false);
  assert.deepEqual(rankInventoryAttention([row('x', 'Healthy', 90), row('y', 'Disabled', 2, 5, false)]), []);
});

test('TC-29: ties are stable (by name, then id) so the list does not shuffle between refreshes', () => {
  const rows = [row('2', 'Beta', 2), row('1', 'Alpha', 2), row('3', 'Alpha', 2)];
  assert.deepEqual(rankInventoryAttention(rows).map((r) => r.id), ['1', '3', '2']);
  assert.deepEqual(rankInventoryAttention(rows.slice().reverse()).map((r) => r.id), ['1', '3', '2']);
});

test('TC-29: the dashboard asks for the most urgent rows, not "the first 4 by id"', () => {
  const dash = code('app/admin/index.tsx');
  assert.match(dash, /getInventoryAttention\(5\)/);
  assert.doesNotMatch(dash, /lowStockOnly: true, limit: 4/);
});

test('TC-29: the SQL orders low-stock before out-of-stock, fewest first, and mirrors the card definitions', () => {
  const sql = source('supabase/migrations/20260828000002_inventory_attention_and_unstaffed_store_alert.sql');
  const fn = sql.slice(sql.indexOf('create or replace function get_admin_inventory_attention'), sql.indexOf('-- TC-24: an order whose store'));
  assert.match(fn, /order by\s+case when \(i\.quantity - i\.reserved_quantity\) > 0 then 0 else 1 end,\s+\(i\.quantity - i\.reserved_quantity\),/);
  assert.match(fn, /\(i\.quantity - i\.reserved_quantity\) > 0 and \(i\.quantity - i\.reserved_quantity\) <= i\.reorder_level and i\.is_available/);
  assert.match(fn, /has_permission\('inventory\.view'\)/);
  assert.match(fn, /grant execute on function get_admin_inventory_attention\(uuid, int\) to authenticated/);
  assert.match(fn, /revoke all on function get_admin_inventory_attention\(uuid, int\) from public, anon/);
});

// ---- TC-24: an order's store must never go un-notified ------------------------------------------------------------

test('TC-24: when a store has no active staff, every admin is alerted with a link to the order', () => {
  const sql = source('supabase/migrations/20260828000002_inventory_attention_and_unstaffed_store_alert.sql');
  const fn = sql.slice(sql.indexOf('create or replace function notify_on_order_created'));
  assert.match(fn, /v_store_staff_notified := v_store_staff_notified \+ 1/);
  assert.match(fn, /if v_store_staff_notified = 0 then/);
  assert.match(fn, /admin_recipient_ids\(\)/);
  assert.match(fn, /'admin_system_alert'/);
  assert.match(fn, /jsonb_build_object\('orderId', new\.id\)/, 'the alert opens the order');
  assert.match(fn, /store_staff_recipient_ids\(new\.store_id\)/, 'store staff are still notified first, exactly as before');
  assert.match(fn, /'order_placed'/, 'the customer receipt is unchanged');
});

test('TC-24: the staff screen flags a store manager / staff member who has no store (they get no orders or alerts)', () => {
  const src = code('app/admin/staff.tsx');
  assert.match(src, /store_manager' \|\| item\.role === 'staff'/);
  assert.match(src, /No store assigned/);
});

// ---- TC-32: Back on every admin page ------------------------------------------------------------------------------

test('TC-32: the admin header has a Back button on every page except the dashboard', () => {
  const src = code('components/admin/AdminShell.tsx');
  assert.match(src, /pathname !== '\/admin' && pathname !== '\/admin\/'/);
  assert.match(src, /accessibilityLabel="Go back"/);
  assert.match(src, /handleAdminBack\(\)/);
  assert.match(src, /router\.canGoBack\(\)/);
  assert.match(src, /router\.replace\('\/admin' as never\)/, 'with nothing to go back to (a deep link) Back lands on the dashboard');
});

test('TC-32: a screen with unsaved work can answer Back itself; without one, Back is not swallowed', () => {
  setAdminBackGuard(null);
  assert.equal(handleAdminBack(), false);
  let calls = 0;
  setAdminBackGuard(() => {
    calls += 1;
    return true;
  });
  assert.equal(handleAdminBack(), true);
  assert.equal(calls, 1);
  setAdminBackGuard(() => false);
  assert.equal(handleAdminBack(), false, 'a guard that declines lets the shell leave');
  setAdminBackGuard(null);
  assert.equal(handleAdminBack(), false);
});

test('TC-32: the Add Product wizard registers its guard while focused and releases it on leaving (no discard without asking)', () => {
  const src = code('components/admin/ProductWizard.tsx');
  assert.match(src, /setAdminBackGuard\(interceptBack\)/);
  assert.match(src, /setAdminBackGuard\(null\)/);
  assert.match(src, /hardwareBackPress', interceptBack/);
});

// ---- TC-28 / TC-30 ------------------------------------------------------------------------------------------------

test('TC-28: Add Product always starts from a blank wizard — a published product bumps the form key', () => {
  const screen = code('app/admin/products/new.tsx');
  assert.match(screen, /<ProductWizard key=\{formKey\} mode="create" onPublished=\{\(\) => setFormKey/);
  const wizard = code('components/admin/ProductWizard.tsx');
  assert.ok(wizard.indexOf('onPublished?.()') > wizard.indexOf('published.current = true'), 'only after the product really exists');
  assert.ok(wizard.indexOf('onPublished?.()') < wizard.indexOf("router.replace(`/admin/products/${result.productId}`"), 'before leaving');
});

test('TC-30: the checkout wait for a new total is short, and the button explains itself while it waits', () => {
  const src = code('app/checkout.tsx');
  assert.match(src, /\}, 120\);/);
  assert.doesNotMatch(src, /\}, 250\);/);
  assert.match(code('services/checkoutGate.ts'), /Updating your total…/);
});
