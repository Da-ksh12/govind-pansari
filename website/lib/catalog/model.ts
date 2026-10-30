// The catalogue as the website sees it. Rows come straight from the shared Supabase tables (products, product_variants, categories) and the
// product_availability view; this file turns them into what the pages need. Pure — no framework or network imports.
import { discountPercent, weightInGrams, weightLabel } from '../format';

/** What the database's product_availability view says about one variant at one store. */
export type DbStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
/**
 * What the website shows. 'unknown' exists for one case only: the stock view could not be read at all (it returned nothing for any active store).
 * Claiming "sold out" for the whole shop because of a read problem would be as wrong as claiming "in stock", so an unknown variant stays
 * purchasable and says nothing about stock; the server's checkout (resolve_checkout) is what enforces real stock, whatever the pages showed.
 */
export type StockStatus = DbStockStatus | 'unknown';
export type ProductBadge = 'bestseller' | 'premium' | 'new';

/** A product counts as "new" for this long after it was added — the same window the mobile app uses. */
export const NEW_WINDOW_DAYS = 14;

// ---- database rows (only the columns the website reads) --------------------------------------------------------------------

export interface VariantRow {
  id: string;
  sku: string;
  weight_value: number | string;
  weight_unit: string;
  price: number | string;
  mrp: number | string;
  is_active: boolean;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  short_description: string | null;
  category_id: string | null;
  image: string | null;
  gallery: string[] | null;
  tags: string[] | null;
  is_featured: boolean;
  is_bestseller: boolean;
  created_at: string;
  categories?: { name: string; slug: string } | null;
  product_variants?: VariantRow[] | null;
}

export interface AvailabilityRow {
  product_variant_id: string;
  store_id: string;
  stock_status: DbStockStatus;
}

// ---- view models -------------------------------------------------------------------------------------------------------------

export interface Variant {
  id: string;
  sku: string;
  label: string;
  weightGrams: number;
  price: number;
  mrp: number;
  /** 0 unless the MRP really is higher than the price. */
  discountPercent: number;
  stock: StockStatus;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  /** Exactly the pictures uploaded for the product, main one first — possibly none (the page then shows the brand tile, never a stand-in photo). */
  images: string[];
  badges: ProductBadge[];
  tags: string[];
  variants: Variant[];
  rating: number;
  reviewCount: number;
  createdAt: string;
}

const STOCK_RANK: Record<DbStockStatus, number> = { out_of_stock: 0, low_stock: 1, in_stock: 2 };

/**
 * A variant is as available as its best active store. A variant that no ACTIVE store has a stock row for is out of stock (a store that does not
 * stock it cannot sell it). Stores that are not active (e.g. Sanjay Place) are ignored entirely: whatever they hold cannot be delivered.
 */
export function mergeAvailability(rows: readonly AvailabilityRow[], activeStoreIds: readonly string[]): Map<string, DbStockStatus> {
  const active = new Set(activeStoreIds);
  const best = new Map<string, DbStockStatus>();
  for (const row of rows) {
    if (!active.has(row.store_id)) continue;
    const current = best.get(row.product_variant_id);
    if (current === undefined || STOCK_RANK[row.stock_status] > STOCK_RANK[current]) best.set(row.product_variant_id, row.stock_status);
  }
  return best;
}

export function deriveBadges(row: Pick<ProductRow, 'is_bestseller' | 'is_featured' | 'created_at'>, now = Date.now()): ProductBadge[] {
  const badges: ProductBadge[] = [];
  if (row.is_bestseller) badges.push('bestseller');
  if (row.is_featured) badges.push('premium');
  const age = now - new Date(row.created_at).getTime();
  if (Number.isFinite(age) && age >= 0 && age <= NEW_WINDOW_DAYS * 86_400_000) badges.push('new');
  return badges;
}

const num = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function toVariant(row: VariantRow, stock: StockStatus): Variant {
  const price = num(row.price);
  const mrp = num(row.mrp);
  const weightValue = num(row.weight_value);
  return {
    id: row.id,
    sku: row.sku,
    label: weightLabel(weightValue, row.weight_unit),
    weightGrams: weightInGrams(weightValue, row.weight_unit),
    price,
    mrp,
    discountPercent: discountPercent(price, mrp),
    stock,
  };
}

export function toProduct(
  row: ProductRow,
  availability: ReadonlyMap<string, DbStockStatus>,
  rating: { rating: number; reviewCount: number } = { rating: 0, reviewCount: 0 },
  now = Date.now(),
  /** Status of a variant with no availability row. 'out_of_stock' when the view is readable; 'unknown' when it is not (see StockStatus). */
  whenMissing: StockStatus = 'out_of_stock',
): Product {
  const variants = (row.product_variants ?? [])
    .filter((v) => v.is_active)
    .map((v) => toVariant(v, availability.get(v.id) ?? whenMissing))
    .sort((a, b) => a.weightGrams - b.weightGrams || a.price - b.price);

  const images: string[] = [];
  for (const url of [row.image, ...(row.gallery ?? [])]) {
    const trimmed = url?.trim();
    if (trimmed && !images.includes(trimmed)) images.push(trimmed);
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description?.trim() ?? '',
    description: row.description?.trim() ?? '',
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    categorySlug: row.categories?.slug ?? null,
    images,
    badges: deriveBadges(row, now),
    tags: row.tags ?? [],
    variants,
    rating: rating.rating,
    reviewCount: rating.reviewCount,
    createdAt: row.created_at,
  };
}

// ---- helpers the pages use ---------------------------------------------------------------------------------------------------

export const isInStock = (v: Variant): boolean => v.stock !== 'out_of_stock';

export function productInStock(product: Product): boolean {
  return product.variants.some(isInStock);
}

/** The variant a "Quick add" button adds: the smallest pack that is in stock, else the smallest pack (shown as sold out). */
export function defaultVariant(product: Product): Variant | undefined {
  return product.variants.find(isInStock) ?? product.variants[0];
}

/** The lowest price a customer can actually buy at, counting only variants in stock (all variants when nothing is in stock). */
export function startingPrice(product: Product): number {
  const pool = product.variants.some(isInStock) ? product.variants.filter(isInStock) : product.variants;
  return pool.length ? Math.min(...pool.map((v) => v.price)) : 0;
}

export function priceRange(product: Product): { min: number; max: number } {
  const prices = product.variants.map((v) => v.price);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 };
}

/** The biggest saving across the product's variants, for a "Save 20%" tag. 0 when there is no real saving. */
export function bestDiscount(product: Product): number {
  return product.variants.reduce((best, v) => Math.max(best, v.discountPercent), 0);
}
