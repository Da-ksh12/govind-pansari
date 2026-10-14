/**
 * Hand-maintained row shapes for the Supabase tables/views the
 * catalogue layer reads. Narrower than `supabase gen types` output
 * (only the columns repositories actually select), which keeps
 * mappers.ts honest about exactly what's fetched — see
 * services/supabase/mappers.ts.
 */

export interface ProductVariantRow {
  id: string;
  product_id: string;
  sku: string;
  weight_value: number;
  weight_unit: 'g' | 'kg';
  price: number;
  mrp: number;
  is_active: boolean;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  short_description: string | null;
  image: string | null;
  gallery: string[];
  is_active: boolean;
  is_featured: boolean;
  is_bestseller: boolean;
  tags: string[];
  created_at: string;
  product_variants?: ProductVariantRow[];
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface StoreRow {
  id: string;
  name: string;
  address_line: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  opening_time: string;
  closing_time: string;
  is_active: boolean;
  is_accepting_orders: boolean;
}

export interface ReviewRow {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface ProductAvailabilityRow {
  product_variant_id: string;
  store_id: string;
  stock_status: StockStatus;
}

export interface ProductRatingRow {
  product_id: string;
  rating: number;
  review_count: number;
}

export interface BannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  target_type: 'product' | 'category' | 'collection' | 'url' | 'none';
  target_id: string | null;
  target_url: string | null;
  theme: 'dark' | 'light';
  eyebrow: string | null;
  sort_order: number;
}

export interface OfferRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  cta_label: string | null;
  category: string;
  sort_order: number;
}
