// What the cart shows for delivery, from the numbers the server charges. Pure, so tests/unit covers it.
//
// The server (resolve_checkout) charges the delivery zone's fee, requires the zone's minimum order, and makes delivery free for a cart that meets the
// minimum AND reaches the zone's free-delivery level. The cart used to estimate this with numbers built into the app (Rs 40 / free from Rs 499) while
// the zones charged Rs 49 — so the cart and checkout disagreed. Now the cart asks the server (get_delivery_pricing) for the same numbers and
// calculates with this same rule.

export interface DeliveryPricing {
  deliveryFee: number;
  minimumOrderValue: number;
  /** Null: this area has no free-delivery level. */
  freeDeliveryThreshold: number | null;
}

/**
 * Shown only until the server has answered (first launch, no location chosen yet, offline). They are the zones' current values, kept here so the
 * cart is never blank; the server's numbers replace them as soon as they arrive.
 */
export const FALLBACK_PRICING: DeliveryPricing = { deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 499 };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The server's answer as DeliveryPricing, or null for "nothing serves this place" ({}) and for anything malformed. */
export function parseDeliveryPricing(raw: unknown): DeliveryPricing | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!finite(o.deliveryFee) || !finite(o.minimumOrderValue) || o.deliveryFee < 0 || o.minimumOrderValue < 0) return null;
  const free = o.freeDeliveryThreshold;
  if (free !== null && free !== undefined && (!finite(free) || free < 0)) return null;
  return { deliveryFee: o.deliveryFee, minimumOrderValue: o.minimumOrderValue, freeDeliveryThreshold: free === null || free === undefined ? null : free };
}

export interface DeliveryQuote {
  deliveryFee: number;
  /** Rupees still to add for free delivery; 0 when already free or when this area has none. */
  amountToFreeDelivery: number;
  /** 0..1 progress towards free delivery (1 when free). */
  freeDeliveryProgress: number;
  /** Whether this area offers free delivery at all (hide the "add ₹X more" bar when it does not). */
  hasFreeDelivery: boolean;
}

export function quoteDelivery(itemTotal: number, pricing: DeliveryPricing): DeliveryQuote {
  const threshold = pricing.freeDeliveryThreshold;
  const hasFreeDelivery = threshold !== null;
  // The same rule as resolve_checkout(): free only for a cart that meets the minimum and reaches the free-delivery level.
  const free = hasFreeDelivery && itemTotal >= pricing.minimumOrderValue && itemTotal >= threshold;
  const deliveryFee = itemTotal === 0 || free ? 0 : pricing.deliveryFee;
  return {
    deliveryFee,
    amountToFreeDelivery: hasFreeDelivery ? Math.max(0, Math.max(threshold, pricing.minimumOrderValue) - itemTotal) : 0,
    freeDeliveryProgress: hasFreeDelivery ? (threshold <= 0 ? 1 : Math.min(1, itemTotal / Math.max(threshold, pricing.minimumOrderValue))) : 0,
    hasFreeDelivery,
  };
}
