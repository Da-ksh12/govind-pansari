import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toReview } from '../supabase/mappers';
import type { Review } from '../../types/models';
import type { ProductRatingRow, ReviewRow } from '../../types/supabase';

export const reviewRepository = {
  async listByProduct(productId: string): Promise<Review[]> {
    const { data, error } = await supabase
      .from('reviews')
      .select('*, profiles(full_name)')
      .eq('product_id', productId)
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error) throw toCatalogueError(error);
    return (data as ReviewRow[]).map(toReview);
  },

  /** Aggregate rating for a product — the same product_ratings view productRepository uses to enrich listings. */
  async getRatingSummary(productId: string): Promise<{ rating: number; reviewCount: number }> {
    const { data, error } = await supabase.from('product_ratings').select('*').eq('product_id', productId).maybeSingle();
    if (error || !data) return { rating: 0, reviewCount: 0 };
    const row = data as ProductRatingRow;
    return { rating: row.rating, reviewCount: row.review_count };
  },

  /**
   * This user's own reviews for a set of products, keyed by product id —
   * used by the post-delivery review prompt to know which items in an
   * order have already been rated (reviews_public_read_published's RLS
   * already lets a user see their own row regardless of status, no
   * migration needed). Empty/failed lookups resolve to "not reviewed
   * yet" rather than blocking the screen — the same enrichment-never-
   * blocks pattern productRepository already uses for ratings.
   */
  async getMyReviews(productIds: string[]): Promise<Map<string, Review>> {
    if (productIds.length === 0) return new Map();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new Map();
    const { data, error } = await supabase
      .from('reviews')
      .select('*, profiles(full_name)')
      .eq('user_id', user.id)
      .in('product_id', productIds);
    if (error || !data) return new Map();
    return new Map((data as ReviewRow[]).map((row) => [row.product_id, toReview(row)]));
  },

  /**
   * add_review() itself is the real gate (section: verified-purchase
   * only — throws unless this product comes from one of this customer's
   * own delivered orders), not just a nicety enforced here.
   */
  async submitReview(productId: string, rating: number, comment?: string): Promise<void> {
    const { error } = await supabase.rpc('add_review', {
      p_product_id: productId,
      p_rating: rating,
      p_comment: comment?.trim() || null,
    });
    if (error) throw toCatalogueError(error);
  },
};
