import { useMemo } from 'react';
import { getCachedVariant } from '../services/supabase/productCache';
import { useCartStore } from '../store/cartStore';
import type { Product, ProductVariant } from '../types/models';

export interface CartLine {
  cartItemId: string;
  product: Product;
  variant: ProductVariant;
  quantity: number;
  lineTotal: number;
  lineMrp: number;
}

export const FREE_DELIVERY_THRESHOLD = 499;
const STANDARD_DELIVERY_FEE = 40;

export function useCartLines() {
  const items = useCartStore((s) => s.items);

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
    const deliveryFee = itemTotal === 0 || itemTotal >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_FEE;
    const amountToFreeDelivery = Math.max(0, FREE_DELIVERY_THRESHOLD - itemTotal);
    const savings = mrpTotal - itemTotal;

    return {
      lines,
      savedLines,
      itemTotal,
      mrpTotal,
      totalCount,
      deliveryFee,
      amountToFreeDelivery,
      freeDeliveryProgress: Math.min(1, itemTotal / FREE_DELIVERY_THRESHOLD),
      savings,
      grandTotal: itemTotal + deliveryFee,
    };
  }, [items]);
}
