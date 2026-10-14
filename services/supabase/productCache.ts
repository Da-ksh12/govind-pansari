/**
 * Lightweight in-memory index of products/variants the app has already
 * fetched, keyed by both variant id and product id. Replaces the old
 * data/mock/productIndex static Map now that product ids come from
 * Supabase rather than a fixed mock array.
 *
 * Why this exists: useCartLines() and the wishlist screen need
 * synchronous product/variant details for whatever's in the cart/
 * wishlist (name, image, price) so they render instantly, with no
 * per-render async fetch. A customer can only add something to the
 * cart or wishlist from a screen that already fetched and displayed it
 * (a rail, a grid, product detail) — by the time it's referenced by
 * id elsewhere, it's already been through productRepository and is in
 * this cache. Not a general catalogue cache; don't use this to avoid a
 * real fetch.
 */
import type { Product } from '../../types/models';

const variantIndex = new Map<string, { product: Product; variant: Product['variants'][number] }>();
const productIndex = new Map<string, Product>();

/** Called by productRepository after every fetch — indexes every returned product and its variants. */
export function cacheProducts(products: Product[]): void {
  for (const product of products) {
    productIndex.set(product.id, product);
    for (const variant of product.variants) {
      variantIndex.set(variant.id, { product, variant });
    }
  }
}

export function getCachedVariant(variantId: string) {
  return variantIndex.get(variantId);
}

/** Used by screens that only ever hold a productId (e.g. wishlist items) and need the full product for display. */
export function getCachedProduct(productId: string): Product | undefined {
  return productIndex.get(productId);
}
