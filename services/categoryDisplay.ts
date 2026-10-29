/**
 * What a customer sees for a category: a real picture, and only categories that have something to buy.
 *
 * Two live problems this fixes: a category with no image of its own showed a grey grid icon (the "Dry spices" tile), and a
 * category that contained no products at all was still listed and opened an empty page. A category without its own image now
 * borrows a real photo of a product it contains (its own first, then its sub-categories'); a category with no products at all
 * (and no sub-category with products) is not shown to customers. Nothing is invented: no stock photo, no keyword guess.
 */
export interface CategoryNodeLite {
  id: string;
  parentId?: string | null;
}

export interface ProductPhoto {
  categoryId: string;
  image: string;
}

/** The category itself and every category below it, in tree order. Safe against cycles in bad data. */
export function selfAndDescendants(categories: readonly CategoryNodeLite[], id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    out.push(current);
    for (const c of categories) if (c.parentId === current) walk(c.id);
  };
  walk(id);
  return out;
}

/** Products in the category plus everything below it. */
export function totalProductCount(categories: readonly CategoryNodeLite[], ownCounts: ReadonlyMap<string, number>, id: string): number {
  return selfAndDescendants(categories, id).reduce((sum, c) => sum + (ownCounts.get(c) ?? 0), 0);
}

/** A category with nothing to buy (itself or below) is not worth showing a customer. */
export function isBrowsable(categories: readonly CategoryNodeLite[], ownCounts: ReadonlyMap<string, number>, id: string): boolean {
  return totalProductCount(categories, ownCounts, id) > 0;
}

/**
 * For each category that has no image, the first product photo (in the order given) from the category itself, otherwise from
 * the nearest sub-category that has one. Categories with no usable photo anywhere below them are simply absent from the result.
 */
export function pickRepresentativeImages(
  categories: readonly CategoryNodeLite[],
  missingIds: readonly string[],
  photos: readonly ProductPhoto[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of missingIds) {
    const order = selfAndDescendants(categories, id); // self first, then the tree below
    for (const candidate of order) {
      const photo = photos.find((p) => p.categoryId === candidate && p.image.trim() !== '');
      if (photo) {
        result.set(id, photo.image);
        break;
      }
    }
  }
  return result;
}

/** A category image is usable only if it is a non-empty string. */
export function hasImage(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.trim() !== '';
}
