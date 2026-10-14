import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { productRepository } from './productRepository';
import type { Product } from '../../types/models';

/**
 * No new database functions here (unlike cart) — toggle/remove is a
 * trivial, unvalidated operation already fully covered by Phase 01's
 * RLS (wishlist_items_owner_all) and its unique(wishlist_id,
 * product_id) constraint, which already prevents duplicates. Adding a
 * function would just be the "function for every trivial operation"
 * this phase says not to build.
 */
export const wishlistRepository = {
  /** Full enriched Product objects (price/availability/rating), not raw wishlist_item rows — reuses productRepository so there's one source of truth for product shape. */
  async list(): Promise<Product[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: wishlist } = await supabase.from('wishlists').select('id').eq('user_id', user.id).maybeSingle();
    if (!wishlist) return [];

    const { data, error } = await supabase.from('wishlist_items').select('product_id').eq('wishlist_id', wishlist.id);
    if (error) throw toCatalogueError(error);

    const productIds = (data ?? []).map((r) => r.product_id);
    return productRepository.listByIds(productIds);
  },

  async add(productId: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be signed in to use the wishlist');

    let { data: wishlist } = await supabase.from('wishlists').select('id').eq('user_id', user.id).maybeSingle();
    if (!wishlist) {
      const { data: created, error } = await supabase.from('wishlists').insert({ user_id: user.id }).select('id').single();
      if (error) throw toCatalogueError(error);
      wishlist = created;
    }

    const { error } = await supabase.from('wishlist_items').insert({ wishlist_id: wishlist.id, product_id: productId });
    // Duplicate is a no-op, not an error — the unique constraint is
    // there to prevent double-adds, not to be surfaced as a failure.
    if (error && error.code !== '23505') throw toCatalogueError(error);
  },

  async remove(productId: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: wishlist } = await supabase.from('wishlists').select('id').eq('user_id', user.id).maybeSingle();
    if (!wishlist) return;
    const { error } = await supabase.from('wishlist_items').delete().eq('wishlist_id', wishlist.id).eq('product_id', productId);
    if (error) throw toCatalogueError(error);
  },
};
