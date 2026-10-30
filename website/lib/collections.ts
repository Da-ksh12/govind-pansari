import type { Product } from './catalog/model';

// Collections are the tags the owner already puts on products in the admin panel (the same "shop by need" groups as the mobile app). The names
// are the app's own; the one-line descriptions are deliberately plain — no health or nutrition claims, which would need to be true and approved.
export interface CollectionDef {
  slug: string;
  label: string;
  blurb: string;
}

export const COLLECTIONS: readonly CollectionDef[] = [
  { slug: 'premium-collection', label: 'Premium Collection', blurb: 'Our finest selections, for when it has to be right.' },
  { slug: 'gifting', label: 'Gifting', blurb: 'Boxes and packs chosen for giving.' },
  { slug: 'healthy-snacking', label: 'Healthy Snacking', blurb: 'Nuts, seeds and dried fruit to keep within reach.' },
  { slug: 'daily-essentials', label: 'Daily Essentials', blurb: 'The staples a kitchen runs on.' },
  { slug: 'cooking-essentials', label: 'Cooking Essentials', blurb: 'Spices and pastes for the everyday pot.' },
  { slug: 'protein-rich', label: 'Protein Rich', blurb: 'Nuts and seeds for a filling bite.' },
  { slug: 'kids', label: 'Kids Favourites', blurb: 'Picks for the younger members of the family.' },
  { slug: 'immunity', label: 'Immunity Booster', blurb: 'A curated selection from the shelves.' },
];

export interface CollectionCard extends CollectionDef {
  count: number;
  /** A real photo of a product in the collection; null if none of its products has a photo. */
  image: string | null;
}

/** Only collections that have products are listed, in the order above. */
export function collectionCards(products: readonly Product[]): CollectionCard[] {
  const cards: CollectionCard[] = [];
  for (const def of COLLECTIONS) {
    const inside = products.filter((p) => p.tags.includes(def.slug));
    if (inside.length === 0) continue;
    cards.push({ ...def, count: inside.length, image: inside.find((p) => p.images[0])?.images[0] ?? null });
  }
  return cards;
}

export const collectionBySlug = (slug: string): CollectionDef | undefined => COLLECTIONS.find((c) => c.slug === slug);

/**
 * Hand-picked photographs for the home page: these products have strong, clean photography (checked by eye against the live catalogue).
 * A slug that no longer exists is skipped and the slot is filled from featured products, so the page never breaks when the catalogue changes.
 */
export const HERO_PRODUCT_SLUGS = ['premium-dry-fruit-trail-mix', 'iranian-pistachios', 'kashmiri-saffron-kesar'] as const;
export const SHOWCASE_PRODUCT_SLUGS = ['mamra-almonds', 'royal-dry-fruit-gift-box', 'green-cardamom'] as const;
export const STORY_PRODUCT_SLUG = 'afghani-black-raisins';

export function curatedProducts(products: readonly Product[], slugs: readonly string[], count = 3): Product[] {
  const picked = slugs.map((slug) => products.find((p) => p.slug === slug)).filter((p): p is Product => !!p && p.images.length > 0);
  if (picked.length >= count) return picked.slice(0, count);
  const extra = products.filter((p) => p.badges.includes('premium') && p.images.length > 0 && !picked.includes(p) && p.categoryId);
  return [...picked, ...extra].slice(0, count);
}

/**
 * Best sellers worth showing on the home page: products the owner has flagged as bestsellers, with a photo and a category. The shop's signature
 * range (the dry-fruit family, if given) comes first, then premium-flagged, then newest. Nothing is invented: every product here is flagged.
 */
export function homeBestsellers(products: readonly Product[], count = 8, signatureCategoryIds: ReadonlySet<string> = new Set()): Product[] {
  const rank = (p: Product) => (p.categoryId && signatureCategoryIds.has(p.categoryId) ? 2 : 0) + (p.badges.includes('premium') ? 1 : 0);
  return products
    .filter((p) => p.badges.includes('bestseller') && p.images.length > 0 && p.categoryId)
    .sort((a, b) => rank(b) - rank(a) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, count);
}
