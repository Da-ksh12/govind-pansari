import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toCategory } from '../supabase/mappers';
import { productRepository } from './productRepository';
import type { Category, Product } from '../../types/models';
import type { CategoryRow } from '../../types/supabase';

export interface SearchResult {
  products: Product[];
  categories: Category[];
}

/**
 * Combines a product search (name/short_description, server-side —
 * see productRepository.search) with matching category suggestions, so
 * a query like "almond" can surface both product hits and the Almonds
 * category itself. The current search screen only renders the product
 * grid today (search() below covers that unchanged); this is here for
 * a richer suggestions UI to adopt without a new query path later.
 */
export const searchRepository = {
  async search(query: string, storeId?: string, limit = 20): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return { products: [], categories: [] };

    const [products, categoriesResult] = await Promise.all([
      productRepository.search(q, storeId),
      supabase.from('categories').select('*').eq('is_active', true).ilike('name', `%${q}%`).limit(5),
    ]);

    if (categoriesResult.error) throw toCatalogueError(categoriesResult.error);
    const categories = (categoriesResult.data as CategoryRow[]).map(toCategory);

    return { products: products.slice(0, limit), categories };
  },
};
