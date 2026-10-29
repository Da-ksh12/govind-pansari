// Pure helpers behind the Add/Edit Product wizard: variant naming, SKU suggestions, discount, gallery order, and the
// variant -> store stock mapping that goes to the database. No React Native imports, so tests/unit covers them.
import { normalizeSku, parseDecimal, parseWholeNumber } from './productValidation';

export type WeightUnit = 'g' | 'kg';

/** One variant's stock at one store, exactly as typed. */
export interface StockCell {
  storeId: string;
  quantity: string;
  reorderLevel: string;
  isAvailable: boolean;
}

export interface InventoryInputRow {
  variant_index: number;
  store_id: string;
  quantity: number;
  reorder_level: number;
  is_available: boolean;
}

export const isRemoteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** A new array with the item at `from` moved to `to` (out-of-range indexes leave the order unchanged). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Percentage off, whole number; 0 when the MRP is not above the price. */
export function discountPercent(price: number, mrp: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(mrp) || price <= 0 || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

/** "500 g" / "1.5 kg" — the name customers see for the variant; '' until the weight is a valid number. */
export function variantName(weightText: string, unit: WeightUnit): string {
  const weight = parseDecimal(weightText);
  if (!Number.isFinite(weight) || weight <= 0) return '';
  return `${Number(weight.toFixed(3))} ${unit}`;
}

/**
 * A readable, unique-looking SKU to start from: GP-<3 letters of the product>-<size>, e.g. GP-ALM-500, GP-ALM-1KG.
 * Never one that is already `taken` (a numeric suffix is added); the admin can always edit it.
 */
export function suggestSku(productName: string, weightText: string, unit: WeightUnit, taken: string[] = []): string {
  const word = (productName.match(/[A-Za-z]{2,}/)?.[0] ?? 'ITM').toUpperCase().slice(0, 3);
  const weight = parseDecimal(weightText);
  const size = Number.isFinite(weight) && weight > 0 ? `${String(Number(weight.toFixed(3))).replace('.', 'P')}${unit === 'kg' ? 'KG' : ''}` : 'SIZE';
  const base = `GP-${word}-${size}`;
  const used = new Set(taken.map(normalizeSku));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return base;
}

/** Variants whose pack size is the same as an earlier one (different SKU, same weight): index -> message. Advisory only. */
export function duplicateSizeNotes(variants: { weightText: string; weight_unit: WeightUnit }[]): Record<number, string> {
  const notes: Record<number, string> = {};
  const first = new Map<string, number>();
  variants.forEach((v, i) => {
    const name = variantName(v.weightText, v.weight_unit);
    if (!name) return;
    const earlier = first.get(name);
    if (earlier === undefined) first.set(name, i);
    else notes[i] = `Same size as variant ${earlier + 1} (${name}). Is that intended?`;
  });
  return notes;
}

/**
 * The stock rows sent with a new product. `variantKeys[i]` is the stable key of the variant at position i; each row carries
 * that variant's INDEX, so stock can never attach to a different variant (removing or reordering variants only changes
 * which index a key has, never which stock belongs to it). Only positive opening stock becomes a row; an invalid entry
 * is the caller's to refuse first (see stockProblems).
 */
export function buildInventoryInput(variantKeys: string[], inventory: Record<string, StockCell[]>): InventoryInputRow[] {
  const rows: InventoryInputRow[] = [];
  variantKeys.forEach((key, index) => {
    for (const cell of inventory[key] ?? []) {
      const quantity = parseWholeNumber(cell.quantity, 'Opening stock').value ?? 0;
      if (quantity <= 0) continue;
      rows.push({
        variant_index: index,
        store_id: cell.storeId,
        quantity,
        reorder_level: parseWholeNumber(cell.reorderLevel, 'Low-stock alert').value ?? 5,
        is_available: cell.isAvailable,
      });
    }
  });
  return rows;
}

/** Copies one store's quantity / alert level / availability to every store (the stores are meant to carry the same range). */
export function copyStockToAllStores(cells: StockCell[], fromStoreId: string): StockCell[] {
  const source = cells.find((c) => c.storeId === fromStoreId);
  if (!source) return cells;
  return cells.map((c) => ({ ...c, quantity: source.quantity, reorderLevel: source.reorderLevel, isAvailable: source.isAvailable }));
}

export interface ReviewStockLine {
  storeName: string;
  units: number;
  lowStockAlert: number;
  sellable: boolean;
}

/** One line per store for the Review step: what will actually be saved. */
export function reviewStockLines(cells: StockCell[], storeNames: Record<string, string>): ReviewStockLine[] {
  return cells.map((c) => ({
    storeName: storeNames[c.storeId] ?? 'Store',
    units: parseWholeNumber(c.quantity, 'Opening stock').value ?? 0,
    lowStockAlert: parseWholeNumber(c.reorderLevel, 'Low-stock alert').value ?? 5,
    sellable: c.isAvailable,
  }));
}
