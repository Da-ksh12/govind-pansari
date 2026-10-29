import { useMemo } from 'react';
import { getCachedVariant } from '../services/supabase/productCache';
import { useCartStore } from '../store/cartStore';
import { useDeliveryPricingStore } from '../store/deliveryPricingStore';
import { FALLBACK_PRICING, quoteDelivery } from '../services/deliveryPricing';
import type { Product, ProductVariant } from '../types/models';

export interface CartLine {
  cartItemId: string;
  product: Product;
  variant: ProductVariant;
  quantity: number;
  lineTotal: number;
  lineMrp: number;
}

export function useCartLines() {
  const items = useCartStore((s) => s.items);
  // The delivery fee and free-delivery level come from the server (the delivery zone's own numbers), not from constants in the app.
  const pricing = useDeliveryPricingStore((s) => s.pricing) ?? FALLBACK_PRICING;

  return useMemo(() => {
    const active = items.filter((i) => !i.savedForLater);
    const saved = items.filter((i) => i.savedForLater);

    const toLine = (item: (typeof items)[number]): CartLine | undefined => {
      const entry = getCachedVariant(item.variantId);
      if (!entry) return undefined;
      return {
        cartItemId: item.id,
        product: entry.product,
        variant: entry.variant,
        quantity: item.quantity,
        lineTotal: entry.variant.price * item.quantity,
        lineMrp: entry.variant.mrp * item.quantity,
      };
    };

    const lines = active.map(toLine).filter((l): l is CartLine => Boolean(l));
    const savedLines = saved.map(toLine).filter((l): l is CartLine => Boolean(l));

    const itemTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const mrpTotal = lines.reduce((sum, l) => sum + l.lineMrp, 0);
    const totalCount = lines.reduce((sum, l) => sum + l.quantity, 0);
    const { deliveryFee, amountToFreeDelivery, freeDeliveryProgress, hasFreeDelivery } = quoteDelivery(itemTotal, pricing);
    const savings = mrpTotal - itemTotal;

    return {
      lines,
      savedLines,
      itemTotal,
      mrpTotal,
      totalCount,
      deliveryFee,
      amountToFreeDelivery,
      freeDeliveryProgress,
      hasFreeDelivery,
      savings,
      grandTotal: itemTotal + deliveryFee,
    };
  }, [items, pricing]);
}
