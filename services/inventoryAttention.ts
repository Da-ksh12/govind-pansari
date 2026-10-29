/**
 * Which inventory rows the dashboard's Inventory Health list shows, and in what order. Mirrors
 * get_admin_inventory_attention() in SQL (supabase/migrations/20260828000002) so the list and the Low Stock / Out of Stock
 * cards above it speak about the same items. Before this the list was "the first 4 rows by id" — an arbitrary sample that
 * left out the most urgent items (QA TC-29).
 */
export interface AttentionRow {
  id: string;
  product_name: string;
  available_quantity: number;
  reorder_level: number;
  is_available: boolean;
}

/** Low stock = what the Low Stock card counts: something left, at or below the reorder level, and sold at that store. */
export function isLowStock(row: AttentionRow): boolean {
  return row.available_quantity > 0 && row.available_quantity <= row.reorder_level && row.is_available;
}

/** Out of stock = what the Out of Stock card counts: nothing available. */
export function isOutOfStock(row: AttentionRow): boolean {
  return row.available_quantity <= 0;
}

/** Low-stock rows first (fewest left first), then out-of-stock rows; ties by name, then id. Rows that are neither are dropped. */
export function rankInventoryAttention<T extends AttentionRow>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => isLowStock(r) || isOutOfStock(r))
    .slice()
    .sort((a, b) => {
      const groupA = a.available_quantity > 0 ? 0 : 1;
      const groupB = b.available_quantity > 0 ? 0 : 1;
      if (groupA !== groupB) return groupA - groupB;
      if (a.available_quantity !== b.available_quantity) return a.available_quantity - b.available_quantity;
      const byName = a.product_name.localeCompare(b.product_name);
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
}
