/**
 * Supabase row -> app domain model converters (types/models.ts). All
 * repositories funnel their query results through these, so the
 * mapping/derivation logic (badges, discount, image ordering, ...)
 * lives in exactly one place instead of being re-derived per screen.
 */
import type {
  Banner,
  Category,
  Offer,
  Product,
  ProductBadge,
  ProductVariant,
  Review,
  Store,
} from '../../types/models';
import type {
  BannerRow,
  CategoryRow,
  OfferRow,
  ProductRatingRow,
  ProductRow,
  ProductVariantRow,
  ReviewRow,
  StockStatus,
  StoreRow,
} from '../../types/supabase';
import { categoryImg, productImg } from '../../data/images';

const NEW_WINDOW_DAYS = 30;

function formatWeightLabel(row: ProductVariantRow): string {
  const value = Number(row.weight_value);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${formatted} ${row.weight_unit}`;
}

export function toProductVariant(row: ProductVariantRow, stockStatus: StockStatus = 'in_stock'): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    label: formatWeightLabel(row),
    weightValue: Number(row.weight_value),
    weightUnit: row.weight_unit,
    mrp: Number(row.mrp),
    price: Number(row.price),
    stockStatus,
    // Raw counts are deliberately never exposed to the client — see
    // docs/inventory-lifecycle.md. stockStatus alone drives the UI.
    stockCount: undefined,
  };
}

function deriveBadges(row: ProductRow): ProductBadge[] {
  const badges: ProductBadge[] = [];
  if (row.is_bestseller) badges.push('bestseller');
  if (row.is_featured) badges.push('premium');
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs <= NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000) badges.push('new');
  return badges;
}

export interface ToProductOptions {
  /** stock_status per product_variant_id, from the product_availability view — only present when a storeId was given. */
  availabilityByVariant?: Map<string, StockStatus>;
  rating?: ProductRatingRow;
  storeId?: string;
}

export function toProduct(row: ProductRow, options: ToProductOptions = {}): Product {
  const variantRows = row.product_variants ?? [];
  const variants = variantRows
    .filter((v) => v.is_active)
    .map((v) => toProductVariant(v, options.availabilityByVariant?.get(v.id)));

  const images = [row.image, ...(row.gallery ?? [])].filter((v): v is string => Boolean(v));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    descriptor: row.short_description ?? '',
    categoryId: row.category_id ?? '',
    images: images.length > 0 ? images : [productImg(row.name)],
    badges: deriveBadges(row),
    rating: options.rating?.rating ?? 0,
    reviewCount: options.rating?.review_count ?? 0,
    variants,
    defaultVariantId: variants[0]?.id ?? '',
    // Structured info sections (Quality & Origin / Ingredients /
    // Nutrition / ...) have no backing columns yet — only render what
    // we actually have (the product's own description), per the brand
    // rule against inventing product claims.
    infoSections: row.description
      ? [{ key: 'about', title: 'About this product', body: row.description }]
      : [],
    tags: row.tags ?? [],
    // With no storeId context we deliberately don't make a false
    // unavailability claim (section 12) — per-variant stockStatus is
    // what actually drives the UI once a store is known.
    availableInArea: options.storeId
      ? variants.some((v) => v.stockStatus !== 'out_of_stock')
      : true,
    fulfillingStoreId: options.storeId,
  };
}

export function toCategory(row: CategoryRow): Category {
  const image = row.image_url ?? categoryImg(row.name);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    heroImage: image,
    thumbnail: image,
    itemCount: 0, // filled in by categoryRepository where it's cheap to compute (see listTopLevel/getTree)
    parentId: row.parent_id ?? undefined,
  };
}

export function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    name: row.name,
    addressLine: row.address_line,
    area: row.address_line.split(',')[0]?.trim() ?? row.address_line,
    city: row.city,
    lat: row.latitude,
    lng: row.longitude,
    phone: row.phone ?? '',
    openTime: row.opening_time,
    closeTime: row.closing_time,
    isOpen: row.is_active && row.is_accepting_orders,
  };
}

export function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    productId: row.product_id,
    authorName: row.profiles?.full_name ?? 'Verified Customer',
    rating: row.rating,
    comment: row.comment ?? '',
    createdAt: row.created_at,
  };
}

export function toBanner(row: BannerRow, deepLink: string): Banner {
  return {
    id: row.id,
    eyebrow: row.eyebrow ?? undefined,
    title: row.title,
    subtitle: row.subtitle ?? '',
    image: row.image_url,
    ctaLabel: row.cta_label ?? 'Shop Now',
    deepLink,
    theme: row.theme,
  };
}

export function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? '',
    image: row.image_url,
    ctaLabel: row.cta_label ?? 'Shop Now',
    category: row.category as Offer['category'],
  };
}

/** Rounded, floor-clamped display discount — the one place this is computed (section 23). */
export function discountPercentage(mrp: number, price: number): number {
  if (mrp <= 0 || price >= mrp) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}
