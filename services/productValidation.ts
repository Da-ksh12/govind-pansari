/**
 * Add/Edit Product validation rules, kept free of React Native so they can
 * be unit-tested. The same rules are enforced again in the database
 * (admin_create_product_full / admin_upsert_variant /
 * admin_initialize_inventory, migration 20260827000006) — this module gives
 * the admin immediate, field-level feedback; it is never the only check.
 */

export interface VariantDraftFields {
  sku: string;
  weightText: string;
  priceText: string;
  mrpText: string;
}

export interface VariantFieldErrors {
  sku?: string;
  weight?: string;
  price?: string;
  mrp?: string;
}

/** Parses a money/decimal field. Returns NaN for anything that is not a plain non-negative decimal number. */
export function parseDecimal(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function hasMoreThanTwoDecimals(text: string): boolean {
  const dot = text.trim().indexOf('.');
  return dot !== -1 && text.trim().length - dot - 1 > 2;
}

/** SKUs compare case-insensitively and ignoring surrounding spaces — the database does the same. */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export function validateVariants(variants: VariantDraftFields[]): VariantFieldErrors[] {
  const firstIndexOfSku = new Map<string, number>();
  return variants.map((v, i) => {
    const errors: VariantFieldErrors = {};

    const sku = normalizeSku(v.sku);
    if (!sku) {
      errors.sku = 'Enter a SKU.';
    } else {
      const first = firstIndexOfSku.get(sku);
      if (first === undefined) firstIndexOfSku.set(sku, i);
      else errors.sku = `Same SKU as variant ${first + 1} — each variant needs its own.`;
    }

    const weight = parseDecimal(v.weightText);
    if (v.weightText.trim() === '') errors.weight = 'Enter the weight.';
    else if (Number.isNaN(weight)) errors.weight = 'Enter a number.';
    else if (weight <= 0) errors.weight = 'Must be more than 0.';

    const price = parseDecimal(v.priceText);
    if (v.priceText.trim() === '') errors.price = 'Enter the selling price.';
    else if (Number.isNaN(price)) errors.price = 'Enter an amount like 450 or 449.50.';
    else if (price <= 0) errors.price = 'Must be more than ₹0.';
    else if (hasMoreThanTwoDecimals(v.priceText)) errors.price = 'Use at most 2 decimal places.';

    const mrp = parseDecimal(v.mrpText);
    if (v.mrpText.trim() === '') errors.mrp = 'Enter the MRP.';
    else if (Number.isNaN(mrp)) errors.mrp = 'Enter an amount like 550 or 549.50.';
    else if (mrp <= 0) errors.mrp = 'Must be more than ₹0.';
    else if (hasMoreThanTwoDecimals(v.mrpText)) errors.mrp = 'Use at most 2 decimal places.';
    else if (!Number.isNaN(price) && price > 0 && mrp < price) errors.mrp = 'MRP can’t be lower than the selling price.';

    return errors;
  });
}

export function variantErrorsPresent(errors: VariantFieldErrors[]): boolean {
  return errors.some((e) => Object.keys(e).length > 0);
}

/**
 * MRP follows the selling price only while the admin has not typed an MRP
 * themselves. Once they have (or for an existing variant), it is left
 * exactly as entered — a validation message, never a silent overwrite, is
 * how a too-low MRP is handled.
 */
export function nextMrpText(args: { priceText: string; mrpText: string; mrpTouched: boolean }): string {
  if (args.mrpTouched) return args.mrpText;
  return args.priceText;
}

export interface WholeNumberResult {
  value?: number;
  error?: string;
}

/**
 * Opening stock and reorder level: a whole number of units, zero or more.
 * An empty field means 0 (nothing stocked yet); a negative or fractional
 * entry is rejected instead of being clamped or rounded.
 */
export function parseWholeNumber(text: string, label: string): WholeNumberResult {
  const trimmed = text.trim();
  if (trimmed === '') return { value: 0 };
  if (/^-/.test(trimmed)) return { error: `${label} can’t be negative.` };
  if (!/^\d+$/.test(trimmed)) return { error: `${label} must be a whole number.` };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { error: `${label} is too large.` };
  return { value };
}

/** Escapes LIKE wildcards so an exact, case-insensitive SKU lookup with ilike cannot match more than the SKU itself. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
