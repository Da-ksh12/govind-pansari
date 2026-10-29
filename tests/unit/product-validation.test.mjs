// QA TC-18 / TC-19 / TC-20: opening stock, variant SKUs and MRP rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeLikePattern,
  nextMrpText,
  normalizeSku,
  parseDecimal,
  parseWholeNumber,
  validateVariants,
  variantErrorsPresent,
} from '../../services/productValidation.ts';

const variant = (over = {}) => ({ sku: 'ALM-250', weightText: '250', priceText: '450', mrpText: '500', ...over });

test('a correct variant has no errors', () => {
  const errors = validateVariants([variant()]);
  assert.deepEqual(errors, [{}]);
  assert.equal(variantErrorsPresent(errors), false);
});

test('opening stock rejects negatives and fractions, accepts empty as 0 (TC-18)', () => {
  assert.deepEqual(parseWholeNumber('', 'Opening stock'), { value: 0 });
  assert.deepEqual(parseWholeNumber('  ', 'Opening stock'), { value: 0 });
  assert.deepEqual(parseWholeNumber('0', 'Opening stock'), { value: 0 });
  assert.deepEqual(parseWholeNumber('120', 'Opening stock'), { value: 120 });
  assert.match(parseWholeNumber('-5', 'Opening stock').error, /negative/);
  assert.match(parseWholeNumber('-0', 'Opening stock').error, /negative/);
  assert.match(parseWholeNumber('2.5', 'Opening stock').error, /whole number/);
  assert.match(parseWholeNumber('1e3', 'Opening stock').error, /whole number/);
  assert.match(parseWholeNumber('abc', 'Opening stock').error, /whole number/);
  assert.match(parseWholeNumber('99999999999999999999', 'Opening stock').error, /too large/);
  assert.equal(parseWholeNumber('-5', 'Opening stock').value, undefined, 'a rejected value is never clamped to 0');
});

test('every variant needs its own SKU (TC-19)', () => {
  const errors = validateVariants([variant({ sku: 'ALM-250' }), variant({ sku: ' alm-250 ' }), variant({ sku: 'ALM-500' })]);
  assert.equal(errors[0].sku, undefined, 'the first use of a SKU is fine');
  assert.match(errors[1].sku, /variant 1/);
  assert.equal(errors[2].sku, undefined);
  assert.equal(variantErrorsPresent(errors), true);
  assert.equal(validateVariants([variant({ sku: '   ' })])[0].sku, 'Enter a SKU.');
});

test('SKUs compare case-insensitively with surrounding spaces ignored', () => {
  assert.equal(normalizeSku('  alm-250 '), 'ALM-250');
});

test('MRP must not be below the selling price (TC-20)', () => {
  assert.match(validateVariants([variant({ priceText: '450', mrpText: '400' })])[0].mrp, /lower than the selling price/);
  assert.equal(validateVariants([variant({ priceText: '450', mrpText: '450' })])[0].mrp, undefined, 'equal is allowed (no discount)');
  assert.equal(validateVariants([variant({ priceText: '450', mrpText: '450.01' })])[0].mrp, undefined);
});

test('MRP follows the price until the admin types one, then is left alone (TC-20)', () => {
  assert.equal(nextMrpText({ priceText: '450', mrpText: '', mrpTouched: false }), '450');
  assert.equal(nextMrpText({ priceText: '480', mrpText: '450', mrpTouched: false }), '480');
  assert.equal(nextMrpText({ priceText: '400', mrpText: '550', mrpTouched: true }), '550', 'an entered MRP is never overwritten');
});

test('price and MRP: empty, non-numeric, zero and too many decimals', () => {
  const e = validateVariants([
    variant({ priceText: '', mrpText: '' }),
    variant({ sku: 'B', priceText: 'abc', mrpText: '-5' }),
    variant({ sku: 'C', priceText: '0', mrpText: '0' }),
    variant({ sku: 'D', priceText: '10.999', mrpText: '20.123' }),
  ]);
  assert.equal(e[0].price, 'Enter the selling price.');
  assert.equal(e[0].mrp, 'Enter the MRP.');
  assert.ok(e[1].price && e[1].mrp);
  assert.match(e[2].price, /more than/);
  assert.match(e[2].mrp, /more than/);
  assert.match(e[3].price, /2 decimal/);
  assert.match(e[3].mrp, /2 decimal/);
});

test('weight must be a positive number', () => {
  const e = validateVariants([variant({ weightText: '' }), variant({ sku: 'B', weightText: 'x' }), variant({ sku: 'C', weightText: '0' })]);
  assert.equal(e[0].weight, 'Enter the weight.');
  assert.equal(e[1].weight, 'Enter a number.');
  assert.equal(e[2].weight, 'Must be more than 0.');
});

test('parseDecimal accepts plain decimals only', () => {
  assert.equal(parseDecimal('449.50'), 449.5);
  assert.equal(parseDecimal(' 450 '), 450);
  assert.equal(parseDecimal('.5'), 0.5);
  assert.ok(Number.isNaN(parseDecimal('1,299')));
  assert.ok(Number.isNaN(parseDecimal('₹450')));
  assert.ok(Number.isNaN(parseDecimal('1e3')));
  assert.ok(Number.isNaN(parseDecimal('-1')));
  assert.ok(Number.isNaN(parseDecimal('')));
});

test('LIKE wildcards in a SKU are escaped so a lookup stays exact', () => {
  assert.equal(escapeLikePattern('A_B%C'), 'A\\_B\\%C');
  assert.equal(escapeLikePattern('A\\B'), 'A\\\\B');
  assert.equal(escapeLikePattern('PLAIN-1'), 'PLAIN-1');
});
