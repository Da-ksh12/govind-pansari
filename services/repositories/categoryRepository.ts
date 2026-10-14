import { needTags } from '../../data/mock/categories';
import type { Category, NeedTag } from '../../types/models';
import type { CategoryRow } from '../../types/supabase';
import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toCategory } from '../supabase/mappers';
import { delay } from '../delay';

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

export const categoryRepository = {
  async list(): Promise<Category[]> {
    const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).order('sort_order');
    if (error) throw toCatalogueError(error);
    const rows = data as CategoryRow[];
    const counts = await fetchProductCounts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toCategory(r), itemCount: counts.get(r.id) ?? 0 }));
  },

  async listTopLevel(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .is('parent_id', null)
      .order('sort_order');
    if (error) throw toCatalogueError(error);
    const rows = data as CategoryRow[];
    const counts = await fetchProductCounts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toCategory(r), itemCount: counts.get(r.id) ?? 0 }));
  },

  /** Full parent/child hierarchy in one shape the UI doesn't have to assemble itself. */
  async getTree(): Promise<CategoryNode[]> {
    const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).order('sort_order');
    if (error) throw toCatalogueError(error);
    const rows = data as CategoryRow[];
    const counts = await fetchProductCounts(rows.map((r) => r.id));

    const nodes = new Map<string, CategoryNode>(rows.map((r) => [r.id, { ...toCategory(r), itemCount: counts.get(r.id) ?? 0, children: [] }]));
    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      if (row.parent_id && nodes.has(row.parent_id)) {
        nodes.get(row.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  },

  async getBySlug(slug: string): Promise<Category | undefined> {
    const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    const [count] = [(await fetchProductCounts([data.id])).get(data.id) ?? 0];
    return { ...toCategory(data as CategoryRow), itemCount: count };
  },

  async getById(id: string): Promise<Category | undefined> {
    const { data, error } = await supabase.from('categories').select('*').eq('id', id).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    const count = (await fetchProductCounts([data.id])).get(data.id) ?? 0;
    return { ...toCategory(data as CategoryRow), itemCount: count };
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
