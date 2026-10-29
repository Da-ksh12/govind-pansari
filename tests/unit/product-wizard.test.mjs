// Variants, SKUs, pricing and stock in the Add Product wizard: every variant keeps its OWN data, and what is reviewed is what is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryInput,
  copyStockToAllStores,
  discountPercent,
  duplicateSizeNotes,
  isRemoteUrl,
  moveItem,
  reviewStockLines,
  suggestSku,
  variantName,
} from '../../services/productWizard.ts';
import { validateVariants, variantErrorsPresent, parseWholeNumber } from '../../services/productValidation.ts';

const cell = (storeId, quantity, reorderLevel = '5', isAvailable = true) => ({ storeId, quantity, reorderLevel, isAvailable });
const VJN = 'store-vjn';
const AWV = 'store-awv';

test('a variant is named by what the customer buys', () => {
  assert.equal(variantName('500', 'g'), '500 g');
  assert.equal(variantName('1.5', 'kg'), '1.5 kg');
  assert.equal(variantName('250.0', 'g'), '250 g');
  assert.equal(variantName('', 'g'), '');
  assert.equal(variantName('abc', 'g'), '');
  assert.equal(variantName('0', 'g'), '');
});

test('discount is a whole percentage, and only when the MRP is above the price', () => {
  assert.equal(discountPercent(450, 550), 18);
  assert.equal(discountPercent(500, 500), 0);
  assert.equal(discountPercent(600, 500), 0);
  assert.equal(discountPercent(0, 500), 0);
  assert.equal(discountPercent(Number.NaN, 500), 0);
});

test('suggested SKUs are readable and never collide with one already used', () => {
  assert.equal(suggestSku('California Almonds', '500', 'g'), 'GP-CAL-500');
  assert.equal(suggestSku('California Almonds', '1', 'kg'), 'GP-CAL-1KG');
  assert.equal(suggestSku('Roasted Cashews', '0.5', 'kg'), 'GP-ROA-0P5KG');
  assert.equal(suggestSku('', '100', 'g'), 'GP-ITM-100');
  assert.equal(suggestSku('Almonds', '', 'g'), 'GP-ALM-SIZE');
  assert.equal(suggestSku('Almonds', '100', 'g', ['gp-alm-100']), 'GP-ALM-100-2', 'case-insensitive clash');
  assert.equal(suggestSku('Almonds', '100', 'g', ['GP-ALM-100', 'GP-ALM-100-2']), 'GP-ALM-100-3');
});

test('the same pack size twice is flagged (different SKU, same weight)', () => {
  const notes = duplicateSizeNotes([
    { weightText: '500', weight_unit: 'g' },
    { weightText: '250', weight_unit: 'g' },
    { weightText: '500.0', weight_unit: 'g' },
    { weightText: '1', weight_unit: 'kg' },
  ]);
  assert.deepEqual(Object.keys(notes), ['2']);
  assert.match(notes[2], /Same size as variant 1 \(500 g\)/);
});

test('three variants with different SKUs, prices and stock at both stores keep their own data', () => {
  const drafts = [
    { sku: 'GP-ALM-100', weightText: '100', priceText: '120', mrpText: '150' },
    { sku: 'GP-ALM-250', weightText: '250', priceText: '280', mrpText: '350' },
    { sku: 'GP-ALM-500', weightText: '500', priceText: '540', mrpText: '650' },
  ];
  assert.equal(variantErrorsPresent(validateVariants(drafts)), false);
  const keys = ['k100', 'k250', 'k500'];
  const inventory = {
    k100: [cell(VJN, '40'), cell(AWV, '35', '8')],
    k250: [cell(VJN, '25'), cell(AWV, '30')],
    k500: [cell(VJN, '10', '2'), cell(AWV, '12', '2', false)],
  };
  const rows = buildInventoryInput(keys, inventory);
  assert.equal(rows.length, 6);
  const at = (index, store) => rows.find((r) => r.variant_index === index && r.store_id === store);
  assert.deepEqual([at(0, VJN).quantity, at(0, AWV).quantity, at(0, AWV).reorder_level], [40, 35, 8]);
  assert.deepEqual([at(1, VJN).quantity, at(1, AWV).quantity], [25, 30]);
  assert.deepEqual([at(2, VJN).quantity, at(2, AWV).quantity, at(2, AWV).is_available], [10, 12, false]);
});

test('removing a variant never moves its stock onto a different variant', () => {
  const inventory = {
    k100: [cell(VJN, '40'), cell(AWV, '40')],
    k250: [cell(VJN, '25'), cell(AWV, '25')],
    k500: [cell(VJN, '10'), cell(AWV, '10')],
  };
  // The middle variant is removed: 250 g's stock entry is gone with it, and 500 g keeps 10 (now at index 1).
  const { k250: _removed, ...rest } = inventory;
  const rows = buildInventoryInput(['k100', 'k500'], rest);
  assert.deepEqual(rows.filter((r) => r.variant_index === 0).map((r) => r.quantity), [40, 40]);
  assert.deepEqual(rows.filter((r) => r.variant_index === 1).map((r) => r.quantity), [10, 10]);
  assert.equal(rows.length, 4);
});

test('only real opening stock becomes a row (zero or blank stock is left out)', () => {
  const rows = buildInventoryInput(['a'], { a: [cell(VJN, '0'), cell(AWV, '15')] });
  assert.deepEqual(rows.map((r) => r.store_id), [AWV]);
  assert.deepEqual(buildInventoryInput(['a'], { a: [cell(VJN, ''), cell(AWV, '')] }), []);
});

test('stock fields are validated: empty means 0, negative and fractional are refused', () => {
  assert.deepEqual(parseWholeNumber('', 'Opening stock'), { value: 0 });
  assert.equal(parseWholeNumber('50', 'Opening stock').value, 50);
  assert.match(parseWholeNumber('-3', 'Opening stock').error, /can’t be negative/);
  assert.match(parseWholeNumber('2.5', 'Opening stock').error, /whole number/);
  assert.match(parseWholeNumber('abc', 'Low-stock alert').error, /Low-stock alert must be a whole number/);
});

test('variant validation: empty fields, duplicate SKUs, MRP below price, bad numbers', () => {
  const errors = validateVariants([
    { sku: 'GP-A-1', weightText: '100', priceText: '100', mrpText: '90' },
    { sku: 'gp-a-1', weightText: '', priceText: 'x', mrpText: '' },
    { sku: '', weightText: '-5', priceText: '0', mrpText: '10.555' },
  ]);
  assert.match(errors[0].mrp, /lower than the selling price/);
  assert.match(errors[1].sku, /Same SKU as variant 1/);
  assert.ok(errors[1].weight && errors[1].price && errors[1].mrp);
  assert.ok(errors[2].sku && errors[2].weight && errors[2].price && errors[2].mrp);
});

test('"same at all stores" copies the first store\'s numbers to every store', () => {
  const copied = copyStockToAllStores([cell(VJN, '40', '6', true), cell(AWV, '0', '5', false)], VJN);
  assert.deepEqual(copied.map((c) => [c.storeId, c.quantity, c.reorderLevel, c.isAvailable]), [[VJN, '40', '6', true], [AWV, '40', '6', true]]);
  const cells = [cell(VJN, '1')];
  assert.equal(copyStockToAllStores(cells, 'nope'), cells);
});

test('the review shows each store\'s stock exactly as it will be saved', () => {
  const lines = reviewStockLines([cell(VJN, '40', '6'), cell(AWV, '12', '3', false)], { [VJN]: 'Govind Pansari — Vijay Nagar', [AWV]: 'Govind Pansari — Awas Vikas' });
  assert.deepEqual(lines, [
    { storeName: 'Govind Pansari — Vijay Nagar', units: 40, lowStockAlert: 6, sellable: true },
    { storeName: 'Govind Pansari — Awas Vikas', units: 12, lowStockAlert: 3, sellable: false },
  ]);
});

test('gallery order: moving a photo changes only its position', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
  const same = ['a', 'b'];
  assert.equal(moveItem(same, 0, -1), same, 'out of range leaves the list as it is');
  assert.equal(moveItem(same, 1, 5), same);
  assert.equal(isRemoteUrl('https://x.supabase.co/storage/v1/object/public/product-images/a.jpg'), true);
  assert.equal(isRemoteUrl('file:///data/user/0/cache/ImageManipulator/a.jpg'), false);
});
