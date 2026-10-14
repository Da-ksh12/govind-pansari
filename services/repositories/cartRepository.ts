import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { cacheProducts } from '../supabase/productCache';
import { toProduct } from '../supabase/mappers';
import type { ProductRow } from '../../types/supabase';

export type CartItemAvailability = 'available' | 'unavailable';

export interface EnrichedCartItem {
  variantId: string;
  productId: string;
  quantity: number;
  /** Live price, from product_variants — always the authoritative number, never price_snapshot. */
  currentPrice: number;
  mrp: number;
  /** Price when this line was added/last incremented — display-only, see docs/cart-architecture.md. */
  priceSnapshot: number | null;
  priceChanged: boolean;
  availability: CartItemAvailability;
  productName: string;
  variantLabel: string;
  image: string;
}

interface CartItemJoinRow {
  quantity: number;
  price_snapshot: number | null;
  product_variants: {
    id: string;
    price: number;
    mrp: number;
    weight_value: number;
    weight_unit: 'g' | 'kg';
    is_active: boolean;
    products: ProductRow;
  } | null;
}

/**
 * The one place that reads the cart with full server truth (live
 * price, availability) — used to power the Cart screen's price-change/
 * unavailable banners. The fast global cart badge/total shown
 * elsewhere reads store/cartStore.ts's local optimistic state instead;
 * this is deliberately the "load the cart properly" path, not
 * something called on every render everywhere.
 */
export const cartRepository = {
  async list(): Promise<EnrichedCartItem[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: cart } = await supabase.from('carts').select('id').eq('user_id', user.id).maybeSingle();
    if (!cart) return [];

    const { data, error } = await supabase
      .from('cart_items')
      .select(
        'quantity, price_snapshot, product_variants(id, price, mrp, weight_value, weight_unit, is_active, products(*))',
      )
      .eq('cart_id', cart.id);
    if (error) throw toCatalogueError(error);

    const rows = data as unknown as CartItemJoinRow[];
    const products = rows
      .filter((r) => r.product_variants?.products)
      .map((r) => toProduct({ ...r.product_variants!.products, product_variants: [] } as ProductRow));
    cacheProducts(products);

    return rows
      .filter((r) => r.product_variants) // a variant could be hard-deleted in principle; skip rather than crash
      .map((r) => {
        const v = r.product_variants!;
        const product = v.products;
        const active = v.is_active && product.is_active;
        const changed = r.price_snapshot != null && Number(r.price_snapshot) !== Number(v.price);
        return {
          variantId: v.id,
          productId: product.id,
          quantity: r.quantity,
          currentPrice: Number(v.price),
          mrp: Number(v.mrp),
          priceSnapshot: r.price_snapshot != null ? Number(r.price_snapshot) : null,
          priceChanged: active && changed,
          availability: active ? 'available' : 'unavailable',
          productName: product.name,
          variantLabel: `${v.weight_value} ${v.weight_unit}`,
          image: product.image ?? '',
        };
      });
  },

  async addToCart(variantId: string, quantity = 1) {
    const { error } = await supabase.rpc('add_to_cart', { p_variant_id: variantId, p_quantity: quantity });
    if (error) throw toCatalogueError(error);
  },

  async setQuantity(variantId: string, quantity: number) {
    const { error } = await supabase.rpc('set_cart_item_quantity', { p_variant_id: variantId, p_quantity: quantity });
    if (error) throw toCatalogueError(error);
  },

  async remove(variantId: string) {
    const { error } = await supabase.rpc('remove_cart_item', { p_variant_id: variantId });
    if (error) throw toCatalogueError(error);
  },
};
