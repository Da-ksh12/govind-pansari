import type { ProductBadge } from '../types/models';

/**
 * Which badges a product shows. The admin's two switches (Best Seller, Premium) are deliberate choices and always win; the
 * automatic "New" badge only fills a remaining slot. Showing just the first badge (what the cards did) silently dropped
 * "Premium" whenever "Best Seller" was also on (QA TC-27).
 */
const PRIORITY: ProductBadge[] = ['bestseller', 'premium', 'new', 'organic', 'limited'];

export const MAX_VISIBLE_BADGES = 2;

export function visibleBadges(badges: readonly ProductBadge[] | undefined, max: number = MAX_VISIBLE_BADGES): ProductBadge[] {
  if (!badges || badges.length === 0) return [];
  const unique = [...new Set(badges)];
  return unique.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)).slice(0, Math.max(0, max));
}
