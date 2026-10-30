// Reads the whole public catalogue from Supabase in a handful of queries. Framework-free (takes a client), so a script can run it as-is;
// lib/data/catalogue.ts wraps it in Next's cache. The catalogue is small (a pansari's range, not a marketplace), so the pages filter and
// sort in memory with lib/catalog/query.ts instead of re-asking the database for every filter click.
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeAvailability, toProduct, type AvailabilityRow, type Product, type ProductRow } from '../catalog/model';

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string;
  /** The category's own picture, or — when none was uploaded — a real photo of a product inside it. null when there is nothing honest to show. */
  image: string | null;
  /** Products in this category and all its sub-categories. */
  productCount: number;
  sortOrder: number;
}

export interface Catalogue {
  products: Product[];
  /** Only categories a customer can buy something from. */
  categories: Category[];
  /** False when the stock view returned nothing for any active store, so stock is shown as unknown rather than "sold out". */
  stockKnown: boolean;
  fetchedAt: string;
}

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
}

// Supabase answers at most 1000 rows per request; availability (variants x stores) can pass that, so every list is read in pages.
const PAGE = 1000;

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** The category and everything below it, so a parent such as "Dry Fruits" counts the products of its children. */
function selfAndDescendants(categories: readonly { id: string; parentId: string | null }[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const c of categories) if (c.parentId === out[i] && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}

export function buildCategories(rows: readonly CategoryRow[], products: readonly Product[]): Category[] {
  const lite = rows.map((r) => ({ id: r.id, parentId: r.parent_id }));
  const photoByCategory = new Map<string, string>();
  const countByCategory = new Map<string, number>();
  for (const p of products) {
    if (!p.categoryId) continue;
    countByCategory.set(p.categoryId, (countByCategory.get(p.categoryId) ?? 0) + 1);
    const photo = p.images[0];
    if (photo && !photoByCategory.has(p.categoryId)) photoByCategory.set(p.categoryId, photo);
  }

  const result: Category[] = [];
  for (const row of rows) {
    const family = selfAndDescendants(lite, row.id);
    const productCount = family.reduce((sum, id) => sum + (countByCategory.get(id) ?? 0), 0);
    if (productCount === 0) continue; // an empty shelf is not shown to customers
    const own = row.image_url?.trim() || null;
    const borrowed = family.map((id) => photoByCategory.get(id)).find(Boolean) ?? null;
    result.push({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      slug: row.slug,
      description: row.description?.trim() ?? '',
      image: own ?? borrowed,
      productCount,
      sortOrder: row.sort_order,
    });
  }
  return result.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function loadCatalogue(db: SupabaseClient, now = Date.now()): Promise<Catalogue> {
  const [productRows, availability, stores, ratings, categoryRows] = await Promise.all([
    readAll<ProductRow>((from, to) =>
      db.from('products').select('*, categories(name, slug), product_variants(*)').eq('is_active', true).order('created_at', { ascending: false }).range(from, to),
    ),
    readAll<AvailabilityRow>((from, to) => db.from('product_availability').select('product_variant_id, store_id, stock_status').range(from, to)),
    readAll<{ id: string }>((from, to) => db.from('stores').select('id').eq('is_active', true).range(from, to)),
    readAll<{ product_id: string; rating: number | string; review_count: number | string }>((from, to) =>
      db.from('product_ratings').select('product_id, rating, review_count').range(from, to),
    ),
    readAll<CategoryRow>((from, to) =>
      db.from('categories').select('id, parent_id, name, slug, description, image_url, sort_order').eq('is_active', true).order('sort_order').range(from, to),
    ),
  ]);

  const stock = mergeAvailability(availability, stores.map((s) => s.id));
  const stockKnown = stock.size > 0;
  const ratingByProduct = new Map(ratings.map((r) => [r.product_id, { rating: Number(r.rating) || 0, reviewCount: Number(r.review_count) || 0 }]));

  // A product with no sellable variant (none active) cannot be bought, so it is not listed.
  const products = productRows
    .map((row) => toProduct(row, stock, ratingByProduct.get(row.id), now, stockKnown ? 'out_of_stock' : 'unknown'))
    .filter((p) => p.variants.length > 0);

  return { products, categories: buildCategories(categoryRows, products), stockKnown, fetchedAt: new Date(now).toISOString() };
}
