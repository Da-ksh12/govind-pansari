// The shopping cart as plain data: a list of (variant id, quantity). Pure and framework-free.
//
// A cart line names a product VARIANT (a pack size), never a product, because price, stock and the SKU belong to the variant. The cart holds
// nothing authoritative: prices shown in it are for display, and the server re-prices every line at checkout (get_checkout_summary).

export interface CartLine {
  variantId: string;
  quantity: number;
}

/** The most of one pack a customer can order at once: the server's own limit (max_cart_item_quantity() = 20 in migration 20260825000018). The server enforces it; this keeps the buttons honest. */
export const DEFAULT_MAX_QUANTITY = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clampQuantity(quantity: number, max = DEFAULT_MAX_QUANTITY): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(max, Math.max(1, Math.floor(quantity)));
}

export function addLine(lines: readonly CartLine[], variantId: string, quantity = 1, max = DEFAULT_MAX_QUANTITY): CartLine[] {
  const existing = lines.find((l) => l.variantId === variantId);
  if (!existing) return [...lines, { variantId, quantity: clampQuantity(quantity, max) }];
  return lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQuantity(l.quantity + quantity, max) } : l));
}

/** Sets an exact quantity; 0 or less removes the line. */
export function setQuantity(lines: readonly CartLine[], variantId: string, quantity: number, max = DEFAULT_MAX_QUANTITY): CartLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return removeLine(lines, variantId);
  return lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQuantity(quantity, max) } : l));
}

export function removeLine(lines: readonly CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

/**
 * What to keep when a visitor who had a cart in this browser signs in and already has a cart on the server: every pack from both, quantities
 * added together and capped. The browser's lines are folded in after the server's, so the server's order is kept.
 */
export function mergeCarts(server: readonly CartLine[], local: readonly CartLine[], max = DEFAULT_MAX_QUANTITY): CartLine[] {
  return local.reduce((acc, line) => addLine(acc, line.variantId, line.quantity, max), [...server]);
}

export function itemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Reads the cart saved in the browser; anything damaged, foreign or tampered with is dropped line by line, never trusted and never a crash. */
export function parseStoredCart(json: string | null | undefined, max = DEFAULT_MAX_QUANTITY): CartLine[] {
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CartLine[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { variantId, quantity } = item as Record<string, unknown>;
    if (typeof variantId !== 'string' || !UUID.test(variantId) || typeof quantity !== 'number') continue;
    if (out.some((l) => l.variantId === variantId)) continue;
    out.push({ variantId, quantity: clampQuantity(quantity, max) });
  }
  return out;
}

export interface PricedLine {
  quantity: number;
  price: number;
  mrp: number;
}

/** Display totals for lines whose prices are known: items total, what the MRPs would have come to, and the saving. */
export function cartTotals(lines: readonly PricedLine[]): { subtotal: number; mrpTotal: number; savings: number } {
  let subtotal = 0;
  let mrpTotal = 0;
  for (const l of lines) {
    subtotal += l.price * l.quantity;
    mrpTotal += Math.max(l.mrp, l.price) * l.quantity;
  }
  return { subtotal, mrpTotal, savings: Math.max(0, mrpTotal - subtotal) };
}

/** A fee quote for the free-delivery bar, using the same rule as the server's checkout: free only for a cart that meets the minimum AND the free level. */
export interface DeliveryRule {
  deliveryFee: number;
  minimumOrderValue: number;
  freeDeliveryThreshold: number | null;
}

export function quoteDelivery(subtotal: number, rule: DeliveryRule): { fee: number; amountToFree: number; progress: number; hasFreeDelivery: boolean } {
  const threshold = rule.freeDeliveryThreshold;
  const hasFreeDelivery = threshold !== null;
  const free = hasFreeDelivery && subtotal >= rule.minimumOrderValue && subtotal >= threshold;
  const target = hasFreeDelivery ? Math.max(threshold, rule.minimumOrderValue) : 0;
  return {
    fee: subtotal === 0 || free ? 0 : rule.deliveryFee,
    amountToFree: hasFreeDelivery ? Math.max(0, target - subtotal) : 0,
    progress: hasFreeDelivery && target > 0 ? Math.min(1, subtotal / target) : 0,
    hasFreeDelivery,
  };
}
