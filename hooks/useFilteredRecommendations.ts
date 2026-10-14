import { useMemo } from 'react';
import { useCartStore } from '../store/cartStore';
import type { Product } from '../types/models';

interface FilterOptions {
  /** Exclude this product too — pass the current product's id on a product detail screen. */
  excludeProductId?: string;
  limit?: number;
}

/**
 * The one recommendation-exclusion rule, shared by every "You may also
 * like" rail (product detail, cart, search) — cart/checkout hardening
 * brief section 3. Excludes anything already in the active cart (not
 * saved-for-later — those are still "not in the cart" from the
 * customer's point of view), the current product if given, and any
 * duplicate. Inactive/unavailable products are never candidates in the
 * first place: every caller sources `candidates` from
 * productRepository, which already filters to `is_active = true`.
 *
 * Reactive by construction, not by manual invalidation: this subscribes
 * to the live cart store, so adding/removing an item recomputes the
 * filtered list on the next render with no re-fetch (section 4 — "must
 * update immediately").
 */
export function useFilteredRecommendations(candidates: Product[] | undefined, options: FilterOptions = {}): Product[] {
  const cartItems = useCartStore((s) => s.items);

  return useMemo(() => {
    if (!candidates || candidates.length === 0) return [];
    const cartProductIds = new Set(cartItems.filter((i) => !i.savedForLater).map((i) => i.productId));
    const seen = new Set<string>();
    const filtered = candidates.filter((p) => {
      if (options.excludeProductId && p.id === options.excludeProductId) return false;
      if (cartProductIds.has(p.id)) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }, [candidates, cartItems, options.excludeProductId, options.limit]);
}
