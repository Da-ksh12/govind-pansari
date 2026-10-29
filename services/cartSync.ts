// How the on-device cart and the server cart are kept in step. The server cart (carts / cart_items) is the source of
// truth; the on-device copy is what the UI shows instantly and what survives a restart. No React Native / Supabase
// imports, so tests/unit covers the rules that stop items disappearing or doubling.

export interface CartLineLike {
  id: string;
  productId: string;
  variantId: string;
  quantity: number;
  savedForLater?: boolean;
}

export interface ServerCartLine {
  variantId: string;
  productId: string;
  quantity: number;
}

export const cartLineId = (variantId: string) => `cart-${variantId}`;

/**
 * The server cart as the new on-device cart.
 *  - one line per variant (a repeated variant from the server is ignored, never added twice);
 *  - "saved for later" (device-only) flags are kept for variants still in the cart;
 *  - a variant with a change still in flight (an add/remove/quantity call that has not answered) keeps its on-device
 *    line, so a slower sync can never wipe out what the customer just did.
 */
export function reconcileWithServer(local: CartLineLike[], server: ServerCartLine[], inFlight: ReadonlySet<string>): CartLineLike[] {
  const savedVariantIds = new Set(local.filter((i) => i.savedForLater).map((i) => i.variantId));
  const out: CartLineLike[] = [];
  const seen = new Set<string>();

  for (const line of server) {
    if (seen.has(line.variantId)) continue;
    seen.add(line.variantId);
    if (inFlight.has(line.variantId)) {
      const mine = local.find((i) => i.variantId === line.variantId);
      if (mine) {
        out.push(mine);
        continue;
      }
    }
    out.push({
      id: cartLineId(line.variantId),
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      ...(savedVariantIds.has(line.variantId) ? { savedForLater: true as const } : {}),
    });
  }

  // Changes still in flight for variants the server does not list yet (just added) stay as they are.
  for (const mine of local) {
    if (inFlight.has(mine.variantId) && !seen.has(mine.variantId)) {
      seen.add(mine.variantId);
      out.push(mine);
    }
  }
  return out;
}

/** Undo an add that the server refused: take back exactly that quantity from that variant only (other lines are untouched). */
export function undoAdd(items: CartLineLike[], variantId: string, quantity: number): CartLineLike[] {
  return items
    .map((i) => (i.variantId === variantId && !i.savedForLater ? { ...i, quantity: i.quantity - quantity } : i))
    .filter((i) => i.quantity > 0 || i.savedForLater);
}

/** Undo a remove / quantity change the server refused: put that variant's line back as it was. Other lines are untouched. */
export function restoreLine(items: CartLineLike[], variantId: string, previous: CartLineLike | undefined): CartLineLike[] {
  const rest = items.filter((i) => !(i.variantId === variantId && !i.savedForLater));
  return previous ? [...rest, previous] : rest;
}

/** The on-device count shown on the Home header: what is actually in the cart, independent of any product cache. */
export function cartItemCount(items: CartLineLike[]): number {
  return items.reduce((sum, i) => (i.savedForLater ? sum : sum + i.quantity), 0);
}

/** "99+" once the number stops fitting in a badge. */
export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}
