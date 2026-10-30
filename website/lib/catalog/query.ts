// Shop filtering, search, sorting and paging over the catalogue. Pure and framework-free.
//
// The whole active catalogue is small (about 65 products), so the shop loads it once and filters in memory: price sorting and price filtering are
// then globally correct (the price lives on the variants, which the database cannot order a product list by). If the catalogue ever grows past a
// few thousand products this moves into a database view; the functions below keep the same inputs and outputs.
import { productInStock, startingPrice, type Product } from './model';

export const PAGE_SIZE = 12;

export const SORT_OPTIONS = [
  { key: 'featured', label: 'Featured' },
  { key: 'bestseller', label: 'Bestsellers first' },
  { key: 'newest', label: 'Newest' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name: A to Z' },
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number]['key'];
/** "relevance" exists only while searching; it is the default for a search and not offered in the list otherwise. */
export type SortKey = SortOption | 'relevance';

export interface ShopParams {
  q: string;
  category: string;
  tag: string;
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  sort: SortKey;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function price(value: string | undefined): number | null {
  if (!value || !/^\d{1,6}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 0 && n <= 100_000 ? n : null;
}

/** Everything in the URL is untrusted input: anything that is not a clean value is dropped, never passed on. */
export function parseShopParams(raw: RawParams): ShopParams {
  const q = (first(raw.q) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const category = SLUG.test(first(raw.category) ?? '') ? (first(raw.category) as string) : '';
  const tag = SLUG.test(first(raw.tag) ?? '') ? (first(raw.tag) as string) : '';
  let minPrice = price(first(raw.min));
  let maxPrice = price(first(raw.max));
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  const inStock = ['1', 'true'].includes(first(raw.stock) ?? '');
  const requested = first(raw.sort);
  const validSort = SORT_OPTIONS.some((o) => o.key === requested) ? (requested as SortOption) : null;
  const sort: SortKey = validSort ?? (q ? 'relevance' : 'featured');
  const pageNumber = /^\d{1,3}$/.test(first(raw.page) ?? '') ? Number(first(raw.page)) : 1;
  return { q, category, tag, minPrice, maxPrice, inStock, sort, page: Math.max(1, pageNumber) };
}

/** The query string for a set of shop params; defaults are left out so the same view always has the same URL. */
export function shopQuery(params: Partial<ShopParams>): string {
  const out = new URLSearchParams();
  if (params.q) out.set('q', params.q);
  if (params.category) out.set('category', params.category);
  if (params.tag) out.set('tag', params.tag);
  if (params.minPrice != null) out.set('min', String(params.minPrice));
  if (params.maxPrice != null) out.set('max', String(params.maxPrice));
  if (params.inStock) out.set('stock', '1');
  if (params.sort && params.sort !== 'featured' && !(params.sort === 'relevance' && params.q)) out.set('sort', params.sort);
  if (params.page && params.page > 1) out.set('page', String(params.page));
  const text = out.toString();
  return text ? `?${text}` : '';
}

// ---- search --------------------------------------------------------------------------------------------------------------------

/** Lower-case, accents removed, anything that is not a letter or digit becomes a space: "Kaju — Katli!" -> "kaju katli". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How well a product matches a search; 0 means it does not match. Every word typed must appear somewhere (name, short text, tags, category,
 * description); matches in the name count most, and a name that STARTS with the words most of all.
 */
export function searchScore(product: Product, query: string): number {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return 0;
  const name = normalizeText(product.name);
  const short = normalizeText(product.shortDescription);
  const tags = normalizeText(product.tags.join(' '));
  const category = normalizeText(product.categoryName ?? '');
  const description = normalizeText(product.description);
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    if (name.split(' ').some((w) => w.startsWith(token))) best = 10;
    else if (name.includes(token)) best = 7;
    else if (category.includes(token) || tags.includes(token)) best = 4;
    else if (short.includes(token)) best = 3;
    else if (description.includes(token)) best = 1;
    if (best === 0) return 0;
    score += best;
  }
  if (name.startsWith(tokens.join(' '))) score += 12;
  return score;
}

// ---- filtering, sorting, paging ----------------------------------------------------------------------------------------------

const premium = (p: Product) => (p.badges.includes('premium') ? 1 : 0);
const bestseller = (p: Product) => (p.badges.includes('bestseller') ? 1 : 0);
const newestFirst = (a: Product, b: Product) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.name.localeCompare(b.name);

function sortProducts(list: Product[], sort: SortKey, q: string): Product[] {
  const copy = [...list];
  switch (sort) {
    case 'relevance':
      return copy.sort((a, b) => searchScore(b, q) - searchScore(a, q) || bestseller(b) - bestseller(a) || newestFirst(a, b));
    case 'bestseller':
      return copy.sort((a, b) => bestseller(b) - bestseller(a) || newestFirst(a, b));
    case 'newest':
      return copy.sort(newestFirst);
    case 'price-asc':
      return copy.sort((a, b) => startingPrice(a) - startingPrice(b) || a.name.localeCompare(b.name));
    case 'price-desc':
      return copy.sort((a, b) => startingPrice(b) - startingPrice(a) || a.name.localeCompare(b.name));
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'featured':
    default:
      return copy.sort((a, b) => premium(b) - premium(a) || bestseller(b) - bestseller(a) || newestFirst(a, b));
  }
}

export interface ShopResult {
  items: Product[];
  total: number;
  page: number;
  pageCount: number;
}

export function applyShopQuery(all: readonly Product[], params: ShopParams, pageSize = PAGE_SIZE): ShopResult {
  let list = [...all];
  if (params.category) list = list.filter((p) => p.categorySlug === params.category);
  if (params.tag) list = list.filter((p) => p.tags.includes(params.tag));
  if (params.q) list = list.filter((p) => searchScore(p, params.q) > 0);
  if (params.inStock) list = list.filter(productInStock);
  if (params.minPrice !== null || params.maxPrice !== null) {
    const min = params.minPrice ?? 0;
    const max = params.maxPrice ?? Number.POSITIVE_INFINITY;
    // a product matches when ANY pack size is inside the range
    list = list.filter((p) => p.variants.some((v) => v.price >= min && v.price <= max));
  }
  list = sortProducts(list, params.sort, params.q);
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, pageCount);
  return { items: list.slice((page - 1) * pageSize, page * pageSize), total, page, pageCount };
}

/** The cheapest and dearest starting prices in a list — for the price filter's placeholder values. */
export function priceBounds(all: readonly Product[]): { min: number; max: number } {
  const prices = all.flatMap((p) => p.variants.map((v) => v.price)).filter((n) => n > 0);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 };
}

/** Quick suggestions for the search overlay: best-matching products and any categories whose name matches. */
export function suggest(
  all: readonly Product[],
  categories: readonly { name: string; slug: string }[],
  query: string,
  limits = { products: 6, categories: 3 },
): { products: Product[]; categories: { name: string; slug: string }[] } {
  const q = query.trim();
  if (normalizeText(q).length < 2) return { products: [], categories: [] };
  const products = all
    .map((p) => ({ p, s: searchScore(p, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, limits.products)
    .map((x) => x.p);
  const tokens = normalizeText(q).split(' ').filter(Boolean);
  const matched = categories.filter((c) => tokens.every((t) => normalizeText(c.name).includes(t))).slice(0, limits.categories);
  return { products, categories: matched };
}
