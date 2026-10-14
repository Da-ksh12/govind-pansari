import { supabase } from '../supabase/client';
import { toProduct } from '../supabase/mappers';
import { cacheProducts } from '../supabase/productCache';
import { CatalogueError, toCatalogueError } from '../supabase/errors';
import type { Product } from '../../types/models';
import type { ProductRatingRow, ProductRow, StockStatus } from '../../types/supabase';

const PRODUCT_SELECT = '*, product_variants(*)';
const DEFAULT_PAGE_SIZE = 20;

export type ProductSort = 'featured' | 'newest' | 'price_low_to_high' | 'price_high_to_low' | 'bestseller';

export interface ProductListOptions {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  /** When set, every variant's stockStatus reflects this store's inventory (not global). */
  storeId?: string;
  featured?: boolean;
  bestseller?: boolean;
  tag?: string;
  search?: string;
  sort?: ProductSort;
}

export interface ProductListResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const VALID_SORTS: ProductSort[] = ['featured', 'newest', 'price_low_to_high', 'price_high_to_low', 'bestseller'];

async function fetchRatings(productIds: string[]): Promise<Map<string, ProductRatingRow>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase.from('product_ratings').select('*').in('product_id', productIds);
  if (error) return new Map(); // ratings are an enrichment, never block the listing on them
  return new Map((data as ProductRatingRow[]).map((r) => [r.product_id, r]));
}

async function fetchAvailability(variantIds: string[], storeId: string): Promise<Map<string, StockStatus>> {
  if (variantIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('product_availability')
    .select('product_variant_id, stock_status')
    .eq('store_id', storeId)
    .in('product_variant_id', variantIds);
  if (error) return new Map();
  return new Map(data.map((r) => [r.product_variant_id, r.stock_status as StockStatus]));
}

async function mapAndEnrich(rows: ProductRow[], storeId?: string): Promise<Product[]> {
  const productIds = rows.map((r) => r.id);
  const variantIds = rows.flatMap((r) => (r.product_variants ?? []).map((v) => v.id));

  const [ratings, availability] = await Promise.all([
    fetchRatings(productIds),
    storeId ? fetchAvailability(variantIds, storeId) : Promise.resolve(new Map<string, StockStatus>()),
  ]);

  const products = rows.map((row) =>
    toProduct(row, { rating: ratings.get(row.id), availabilityByVariant: storeId ? availability : undefined, storeId }),
  );
  cacheProducts(products);
  return products;
}

function applySort(query: any, sort: ProductSort) {
  switch (sort) {
    case 'newest':
      return query.order('created_at', { ascending: false });
    case 'bestseller':
      return query.order('is_bestseller', { ascending: false }).order('created_at', { ascending: false });
    case 'price_low_to_high':
    case 'price_high_to_low':
      // Price lives on product_variants (one-to-many), not orderable
      // directly via PostgREST — sorted client-side after fetch below.
      // Fine at the current catalogue size; upgrade to a min-price view
      // + two-step query if/when the catalogue grows large enough for
      // page-local sorting to stop being globally correct.
      return query.order('created_at', { ascending: false });
    case 'featured':
    default:
      // products has no sort_order column (only categories/offers do,
      // see 20260825000005_catalogue.sql) — is_featured then
      // is_bestseller then recency is the real available ordering.
      return query
        .order('is_featured', { ascending: false })
        .order('is_bestseller', { ascending: false })
        .order('created_at', { ascending: false });
  }
}

function sortByPrice(products: Product[], direction: 'asc' | 'desc'): Product[] {
  const minPrice = (p: Product) => Math.min(...p.variants.map((v) => v.price), Infinity);
  return [...products].sort((a, b) => (direction === 'asc' ? minPrice(a) - minPrice(b) : minPrice(b) - minPrice(a)));
}

async function listByIds(ids: string[], storeId?: string): Promise<Product[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).in('id', ids).eq('is_active', true);
  if (error) throw toCatalogueError(error);
  return mapAndEnrich((data ?? []) as ProductRow[], storeId);
}

/** SKU lives on product_variants, not products — a separate query, merged in by search(). */
async function findProductIdsBySku(q: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('product_id')
    .eq('is_active', true)
    .ilike('sku', `%${q}%`)
    .limit(20);
  if (error) return []; // SKU match is a bonus enrichment, never block name/description search on it
  return [...new Set((data ?? []).map((r) => r.product_id as string))];
}

async function list(options: ProductListOptions = {}): Promise<ProductListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const sort = options.sort ?? 'featured';
  if (!VALID_SORTS.includes(sort)) throw new CatalogueError('INVALID_SORT', `Unknown sort "${sort}"`);

  let query = supabase.from('products').select(PRODUCT_SELECT, { count: 'exact' }).eq('is_active', true);

  if (options.categoryId) query = query.eq('category_id', options.categoryId);
  if (options.featured) query = query.eq('is_featured', true);
  if (options.bestseller) query = query.eq('is_bestseller', true);
  if (options.tag) query = query.contains('tags', [options.tag]);
  if (options.search) {
    const q = options.search.trim();
    if (!q) throw new CatalogueError('INVALID_FILTER', 'Empty search query');
    // PostgREST's .or() filter string treats `,` as a condition
    // separator and `(`/`)` as grouping — a raw search term containing
    // any of those would otherwise corrupt the filter. Quoting the
    // value (and escaping literal quotes/backslashes inside it) is
    // PostgREST's documented way to pass an arbitrary string safely.
    const escaped = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`name.ilike."%${escaped}%",short_description.ilike."%${escaped}%"`);
  }

  query = applySort(query, sort);
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw toCatalogueError(error);

  let items = await mapAndEnrich((data ?? []) as ProductRow[], options.storeId);
  if (sort === 'price_low_to_high') items = sortByPrice(items, 'asc');
  if (sort === 'price_high_to_low') items = sortByPrice(items, 'desc');

  const total = count ?? items.length;
  return { items, total, page, pageSize, hasMore: from + items.length < total };
}

export const productRepository = {
  list,

  async getById(id: string, storeId?: string): Promise<Product | undefined> {
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    const [product] = await mapAndEnrich([data as ProductRow], storeId);
    return product;
  },

  async getBySlug(slug: string, storeId?: string): Promise<Product | undefined> {
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('slug', slug).eq('is_active', true).maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return undefined;
    const [product] = await mapAndEnrich([data as ProductRow], storeId);
    return product;
  },

  async listByCategory(categoryId: string, storeId?: string): Promise<Product[]> {
    const result = await list({ categoryId, storeId, pageSize: 50 });
    return result.items;
  },

  async listByTag(tag: string, storeId?: string): Promise<Product[]> {
    const result = await list({ tag, storeId, pageSize: 30 });
    return result.items;
  },

  async listBestsellers(storeId?: string): Promise<Product[]> {
    const result = await list({ bestseller: true, storeId, sort: 'bestseller', pageSize: 10 });
    return result.items;
  },

  async listPremium(storeId?: string): Promise<Product[]> {
    const result = await list({ featured: true, storeId, pageSize: 10 });
    return result.items;
  },

  async listNewArrivals(storeId?: string): Promise<Product[]> {
    const result = await list({ storeId, sort: 'newest', pageSize: 10 });
    return result.items;
  },

  async listGiftHampers(storeId?: string): Promise<Product[]> {
    const { data, error } = await supabase.from('categories').select('id').eq('slug', 'gift-hampers').maybeSingle();
    if (error || !data) return [];
    const result = await list({ categoryId: data.id, storeId, pageSize: 20 });
    return result.items;
  },

  async search(query: string, storeId?: string): Promise<Product[]> {
    const q = query.trim();
    if (!q) return [];
    const [byNameOrDescription, skuProductIds] = await Promise.all([
      list({ search: q, storeId, pageSize: 30 }),
      findProductIdsBySku(q),
    ]);
    const alreadyMatched = new Set(byNameOrDescription.items.map((p) => p.id));
    const extraIds = skuProductIds.filter((id) => !alreadyMatched.has(id));
    if (extraIds.length === 0) return byNameOrDescription.items;
    const skuMatches = await listByIds(extraIds, storeId);
    return [...byNameOrDescription.items, ...skuMatches];
  },

  listByIds,

  /** "You may also like" — same category, excluding the given product. */
  async listRelated(productId: string, limit = 6, storeId?: string): Promise<Product[]> {
    const { data: source, error: sourceError } = await supabase
      .from('products')
      .select('category_id')
      .eq('id', productId)
      .maybeSingle();
    if (sourceError || !source?.category_id) return [];
    const result = await list({ categoryId: source.category_id, storeId, pageSize: limit + 1 });
    return result.items.filter((p) => p.id !== productId).slice(0, limit);
  },
};
