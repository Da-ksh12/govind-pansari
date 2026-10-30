import { unstable_cache } from 'next/cache';
import { publicClient } from '../supabase/public';
import { mentionsCouponCode, websitePath } from '../links';

// Banners, offers and the shop's own details — the editorial data the admin panel controls (Banners & Offers, Delivery & Pricing, stores).
// Cached for a minute like the catalogue.

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  imageUrl: string;
  ctaLabel: string;
  /** An internal website path ("/category/almonds") or an external https link. */
  href: string;
  dark: boolean;
}

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  category: string;
}

export interface StoreInfo {
  id: string;
  name: string;
  area: string;
  city: string;
  opensAt: string;
  closesAt: string;
  acceptingOrders: boolean;
  latitude: number;
  longitude: number;
}

interface BannerRow {
  id: string; title: string; subtitle: string | null; eyebrow: string | null; image_url: string; cta_label: string | null;
  target_type: 'product' | 'category' | 'collection' | 'url' | 'none'; target_id: string | null; target_url: string | null; theme: 'dark' | 'light';
}

async function readBanners(): Promise<Banner[]> {
  const db = publicClient();
  const now = new Date().toISOString();
  const { data, error } = await db.from('banners').select('*').eq('is_active', true).lte('start_at', now).or(`end_at.is.null,end_at.gte.${now}`).order('sort_order');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as BannerRow[];

  const categoryIds = rows.filter((r) => r.target_type === 'category' && r.target_id).map((r) => r.target_id as string);
  const productIds = rows.filter((r) => r.target_type === 'product' && r.target_id).map((r) => r.target_id as string);
  const [cats, prods] = await Promise.all([
    categoryIds.length ? db.from('categories').select('id, slug').in('id', categoryIds) : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
    productIds.length ? db.from('products').select('id, slug').in('id', productIds) : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
  ]);
  const catSlug = new Map((cats.data ?? []).map((c) => [c.id, c.slug]));
  const prodSlug = new Map((prods.data ?? []).map((p) => [p.id, p.slug]));

  return rows
    // the app's 'Build your own box' banner points at a feature the website does not have yet
    .filter((r) => r.image_url?.trim() && r.target_url !== '/build-your-box')
    .map((r) => {
      let href = '/shop';
      if (r.target_url) href = websitePath(r.target_url);
      else if (r.target_type === 'category' && r.target_id && catSlug.has(r.target_id)) href = `/category/${catSlug.get(r.target_id)}`;
      else if (r.target_type === 'product' && r.target_id && prodSlug.has(r.target_id)) href = `/product/${prodSlug.get(r.target_id)}`;
      return {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle?.trim() ?? '',
        eyebrow: r.eyebrow?.trim() ?? '',
        imageUrl: r.image_url.trim(),
        ctaLabel: r.cta_label?.trim() || 'Shop now',
        href,
        dark: r.theme === 'dark',
      };
    });
}

async function readOffers(): Promise<Offer[]> {
  const now = new Date().toISOString();
  const { data, error } = await publicClient().from('offers').select('*').eq('is_active', true).lte('start_at', now).or(`end_at.is.null,end_at.gte.${now}`).order('sort_order');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; title: string; subtitle: string | null; image_url: string; cta_label: string | null; category: string }[])
    .filter((r) => r.image_url?.trim() && !mentionsCouponCode(`${r.title} ${r.subtitle ?? ''}`))
    .map((r) => ({ id: r.id, title: r.title, subtitle: r.subtitle?.trim() ?? '', imageUrl: r.image_url.trim(), ctaLabel: r.cta_label?.trim() || 'View offer', category: r.category }));
}

/** Active branches only (Sanjay Place is switched off and must never appear). Phone numbers are deliberately not read: the ones on file are placeholders. */
async function readStores(): Promise<StoreInfo[]> {
  const { data, error } = await publicClient().from('stores').select('id, name, address_line, city, opening_time, closing_time, is_accepting_orders, latitude, longitude').eq('is_active', true).order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; address_line: string; city: string; opening_time: string; closing_time: string; is_accepting_orders: boolean; latitude: number; longitude: number }[]).map((s) => ({
    id: s.id,
    name: s.name.replace(/^Govind Pansari\s*[—–-]\s*/i, ''),
    area: s.address_line,
    city: s.city,
    opensAt: s.opening_time.slice(0, 5),
    closesAt: s.closing_time.slice(0, 5),
    acceptingOrders: s.is_accepting_orders,
    latitude: Number(s.latitude),
    longitude: Number(s.longitude),
  }));
}

export interface DeliveryTerms {
  /** Lowest and highest delivery charge across the zones of the shops that are open for orders. */
  feeMin: number;
  feeMax: number;
  minimumOrder: number;
  /** Order value above which delivery is free; null when no zone offers free delivery. */
  freeDeliveryAbove: number | null;
  minutes: number;
  /** How far from a shop we deliver, as the server itself reports it (check_serviceability); null if it could not be read. */
  radiusKm: number | null;
}

/**
 * What delivery costs, read from the delivery zones of the ACTIVE shops (the numbers the owner edits under Delivery & Pricing). A zone whose
 * shop is switched off (Sanjay Place) is ignored. Returns null if nothing can be read — pages then say nothing rather than guess.
 */
async function readDeliveryTerms(): Promise<DeliveryTerms | null> {
  const db = publicClient();
  const [stores, links, zones] = await Promise.all([
    db.from('stores').select('id, latitude, longitude').eq('is_active', true),
    db.from('store_delivery_zones').select('store_id, delivery_zone_id'),
    db.from('delivery_zones').select('id, delivery_fee, minimum_order_value, free_delivery_threshold, estimated_delivery_minutes').eq('is_active', true),
  ]);
  if (stores.error || links.error || zones.error) return null;
  const activeStores = new Set((stores.data ?? []).map((s) => s.id as string));
  // the delivery radius is not a table column the public can read, but the server states it in every serviceability answer
  const first = (stores.data ?? [])[0] as { latitude: number; longitude: number } | undefined;
  const probe = first ? await db.rpc('check_serviceability', { p_lat: first.latitude, p_lng: first.longitude }) : null;
  const radius = Number((probe?.data as { maxRadiusKm?: number } | null)?.maxRadiusKm);
  const zoneIds = new Set((links.data ?? []).filter((l) => activeStores.has(l.store_id as string)).map((l) => l.delivery_zone_id as string));
  const rows = (zones.data ?? []).filter((z) => zoneIds.has(z.id as string));
  if (rows.length === 0) return null;
  const fees = rows.map((z) => Number(z.delivery_fee));
  const free = rows.map((z) => (z.free_delivery_threshold == null ? null : Number(z.free_delivery_threshold)));
  return {
    feeMin: Math.min(...fees),
    feeMax: Math.max(...fees),
    minimumOrder: Math.max(...rows.map((z) => Number(z.minimum_order_value))),
    // only promise free delivery if EVERY zone offers it, at the highest of their levels
    freeDeliveryAbove: free.every((v) => v !== null) ? Math.max(...(free as number[])) : null,
    minutes: Math.max(...rows.map((z) => Number(z.estimated_delivery_minutes))),
    radiusKm: Number.isFinite(radius) && radius > 0 ? radius : null,
  };
}

export const getBanners = unstable_cache(readBanners, ['banners-v1'], { tags: ['banners'], revalidate: 60 });
export const getOffers = unstable_cache(readOffers, ['offers-v1'], { tags: ['offers'], revalidate: 60 });
export const getStores = unstable_cache(readStores, ['stores-v1'], { tags: ['stores'], revalidate: 60 });
export const getDeliveryTerms = unstable_cache(readDeliveryTerms, ['delivery-terms-v1'], { tags: ['delivery'], revalidate: 60 });

/** "9:00 AM" from "09:00". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
