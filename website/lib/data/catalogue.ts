import { unstable_cache } from 'next/cache';
import { publicClient } from '../supabase/public';
import { loadCatalogue, type Catalogue, type Category } from './catalogue-source';
import type { Product } from '../catalog/model';

// One cached read of the whole public catalogue, shared by every page. 60 seconds is short enough that a price or stock change made in the
// admin panel shows up within a minute, and long enough that a traffic spike hits the cache, not the database. Pages that must be exact
// (cart, checkout) never rely on this: they ask the server RPCs, which read live rows.
export const CATALOGUE_TAG = 'catalogue';

export const getCatalogue = unstable_cache(async (): Promise<Catalogue> => loadCatalogue(publicClient()), ['catalogue-v1'], {
  tags: [CATALOGUE_TAG],
  revalidate: 60,
});

export async function getProductBySlug(slug: string): Promise<Product | undefined> {
  const { products } = await getCatalogue();
  return products.find((p) => p.slug === slug);
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  const { categories } = await getCatalogue();
  return categories.find((c) => c.slug === slug);
}

/** The category plus its sub-categories' ids, for "show everything on this shelf". */
export function categoryFamilyIds(categories: readonly Category[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of categories) if (c.parentId === out[i] && !out.includes(c.id)) out.push(c.id);
  return out;
}
