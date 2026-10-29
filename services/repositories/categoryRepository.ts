import { needTags } from '../../data/mock/categories';
import type { Category, NeedTag } from '../../types/models';
import type { CategoryRow } from '../../types/supabase';
import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toCategory } from '../supabase/mappers';
import { delay } from '../delay';
import { hasImage, isBrowsable, pickRepresentativeImages, selfAndDescendants, type ProductPhoto } from '../categoryDisplay';

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

async function fetchProductCounts(categoryIds: string[]): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  // One lightweight query per category rather than a bespoke SQL
  // function — the catalogue-tree screens only ever need this for a
  // handful of categories at a time (top-level + their children).
  const counts = await Promise.all(
    categoryIds.map(async (id) => {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id)
        .eq('is_active', true);
      return [id, count ?? 0] as const;
    }),
  );
  return new Map(counts);
}

/** Real product photos for these categories, oldest product first so the choice is stable between loads. */
async function fetchProductPhotos(categoryIds: string[]): Promise<ProductPhoto[]> {
  if (categoryIds.length === 0) return [];
  const { data, error } = await supabase
    .from('products')
    .select('category_id, image')
    .eq('is_active', true)
    .in('category_id', categoryIds)
    .not('image', 'is', null)
    .neq('image', '')
    .order('created_at', { ascending: true })
    .limit(300);
  if (error || !data) return []; // a failed photo lookup only means the neutral tile stays — never a broken category list
  return (data as { category_id: string; image: string }[]).map((r) => ({ categoryId: r.category_id, image: r.image }));
}

interface LoadedCategories {
  /** Every active category, with a picture where one can be found and its own product count. */
  all: Category[];
  /** Product counts INCLUDING sub-categories, by category id — what decides whether a customer should see it. */
  ownCounts: Map<string, number>;
}

/**
 * Loads every active category once and fills in what a customer needs: the category's own image, or — if it has none — a real
 * photo of a product it contains (its own, then its sub-categories'). `itemCount` stays the category's own product count.
 */
async function loadCategories(): Promise<LoadedCategories> {
  const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).order('sort_order');
  if (error) throw toCatalogueError(error);
  const rows = data as CategoryRow[];
  const ownCounts = await fetchProductCounts(rows.map((r) => r.id));
  const base = rows.map((r) => ({ ...toCategory(r), itemCount: ownCounts.get(r.id) ?? 0 }));

  const lite = base.map((c) => ({ id: c.id, parentId: c.parentId ?? null }));
  const missing = base.filter((c) => !hasImage(c.thumbnail)).map((c) => c.id);
  const lookIn = [...new Set(missing.flatMap((id) => selfAndDescendants(lite, id)))];
  const borrowed = pickRepresentativeImages(lite, missing, await fetchProductPhotos(lookIn));

  const all = base.map((c) => {
    const image = borrowed.get(c.id);
    return image ? { ...c, thumbnail: image, heroImage: image } : c;
  });
  return { all, ownCounts };
}

/** Only categories that have something to buy (themselves or below) are shown to customers. */
function browsable(loaded: LoadedCategories): Category[] {
  const lite = loaded.all.map((c) => ({ id: c.id, parentId: c.parentId ?? null }));
  return loaded.all.filter((c) => isBrowsable(lite, loaded.ownCounts, c.id));
}

export const categoryRepository = {
  async list(): Promise<Category[]> {
    return browsable(await loadCategories());
  },

  async listTopLevel(): Promise<Category[]> {
    return (await categoryRepository.list()).filter((c) => !c.parentId);
  },

  /** Full parent/child hierarchy in one shape the UI doesn't have to assemble itself. */
  async getTree(): Promise<CategoryNode[]> {
    const shown = await categoryRepository.list();
    const nodes = new Map<string, CategoryNode>(shown.map((c) => [c.id, { ...c, children: [] }]));
    const roots: CategoryNode[] = [];
    for (const c of shown) {
      const node = nodes.get(c.id)!;
      if (c.parentId && nodes.has(c.parentId)) nodes.get(c.parentId)!.children.push(node);
      else roots.push(node);
    }
    return roots;
  },

  // A category reached by link/slug is shown even when empty (the page says so); it still gets a real picture when one exists.
  async getBySlug(slug: string): Promise<Category | undefined> {
    const { data, error } = await supabase.from('categories').select('id').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    return (await loadCategories()).all.find((c) => c.id === (data as { id: string }).id);
  },

  async getById(id: string): Promise<Category | undefined> {
    const { data, error } = await supabase.from('categories').select('id').eq('id', id).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    return (await loadCategories()).all.find((c) => c.id === id);
  },

  /**
   * "Shop by Need" tags (Healthy Snacking, Protein Rich, Gifting, ...)
   * are a curated editorial grouping, not a catalogue entity — there's
   * no database table backing the tag *labels/icons* themselves
   * (products.tags just holds the matching slugs). Kept static; only
   * the product matches behind each tag come from Supabase
   * (productRepository.listByTag).
   */
  async listNeedTags(): Promise<NeedTag[]> {
    await delay(80);
    return needTags;
  },
};
