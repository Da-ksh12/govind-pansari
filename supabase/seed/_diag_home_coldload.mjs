// Measures the REAL request count + wall-clock latency of the Home
// screen's cold-load data fetch, replicating the exact Supabase query
// shapes used by productRepository / categoryRepository / bannerRepository
// (read directly from source — not re-implemented business logic, just
// the same calls, so request count/shape here is faithful to the app).
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

let requestCount = 0;
const timings = [];

async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  timings.push({ label, ms });
  return result;
}

const PRODUCT_SELECT = '*, product_variants(*)';

async function fetchRatings(productIds) {
  if (productIds.length === 0) return new Map();
  requestCount++;
  const { data } = await supabase.from('product_ratings').select('*').in('product_id', productIds);
  return new Map((data ?? []).map((r) => [r.product_id, r]));
}

async function listProducts(opts) {
  requestCount++;
  let query = supabase.from('products').select(PRODUCT_SELECT, { count: 'exact' }).eq('is_active', true);
  if (opts.categoryId) query = query.eq('category_id', opts.categoryId);
  if (opts.featured) query = query.eq('is_featured', true);
  if (opts.bestseller) query = query.eq('is_bestseller', true);
  if (opts.tag) query = query.contains('tags', [opts.tag]);
  if (opts.sort === 'newest') query = query.order('created_at', { ascending: false });
  else if (opts.sort === 'bestseller') query = query.order('is_bestseller', { ascending: false }).order('created_at', { ascending: false });
  else query = query.order('is_featured', { ascending: false }).order('is_bestseller', { ascending: false }).order('created_at', { ascending: false });
  query = query.range(0, (opts.pageSize ?? 20) - 1);
  const { data, count, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const ratings = await fetchRatings(rows.map((r) => r.id));
  return { items: rows, total: count ?? rows.length, ratingsCount: ratings.size };
}

async function fetchProductCounts(categoryIds) {
  if (categoryIds.length === 0) return new Map();
  const counts = await Promise.all(
    categoryIds.map(async (id) => {
      requestCount++;
      const { count } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('category_id', id).eq('is_active', true);
      return [id, count ?? 0];
    }),
  );
  return new Map(counts);
}

async function listTopLevelCategories() {
  requestCount++;
  const { data, error } = await supabase.from('categories').select('*').eq('is_active', true).is('parent_id', null).order('sort_order');
  if (error) throw error;
  const rows = data ?? [];
  const counts = await fetchProductCounts(rows.map((r) => r.id));
  return { rows, counts };
}

async function listGiftHampers() {
  requestCount++;
  const { data } = await supabase.from('categories').select('id').eq('slug', 'gift-hampers').maybeSingle();
  if (!data) return { items: [] };
  return listProducts({ categoryId: data.id, pageSize: 20 });
}

async function listBanners() {
  requestCount++;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .eq('is_active', true)
    .lte('start_at', nowIso)
    .or(`end_at.is.null,end_at.gte.${nowIso}`)
    .order('sort_order');
  if (error) throw error;
  const rows = data ?? [];
  const categoryIds = rows.filter((r) => r.target_type === 'category' && r.target_id).map((r) => r.target_id);
  const productIds = rows.filter((r) => r.target_type === 'product' && r.target_id).map((r) => r.target_id);
  if (categoryIds.length) { requestCount++; await supabase.from('categories').select('id, slug').in('id', categoryIds); }
  if (productIds.length) { requestCount++; await supabase.from('products').select('id, slug').in('id', productIds); }
  return { rows };
}

console.log('--- Home cold-load diagnostic (real Supabase calls, anon key) ---\n');

const overallStart = performance.now();

const [categories, bestsellers, premium, newArrivals, giftHampers, healthyPicks, banners] = await Promise.all([
  timed('categories.listTopLevel (incl. per-category count N+1)', () => listTopLevelCategories()),
  timed('products.listBestsellers', () => listProducts({ bestseller: true, sort: 'bestseller', pageSize: 10 })),
  timed('products.listPremium', () => listProducts({ featured: true, pageSize: 10 })),
  timed('products.listNewArrivals', () => listProducts({ sort: 'newest', pageSize: 10 })),
  timed('products.listGiftHampers', () => listGiftHampers()),
  timed('products.listByTag(healthy-snacking)', () => listProducts({ tag: 'healthy-snacking', pageSize: 30 })),
  timed('banners.list', () => listBanners()),
]);

const overallMs = performance.now() - overallStart;

console.log(`Top-level categories found: ${categories.rows.length} (each contributes 1 extra count query)\n`);

for (const t of timings.sort((a, b) => b.ms - a.ms)) {
  console.log(`${t.ms.toFixed(0)}ms  ${t.label}`);
}

console.log(`\nTotal distinct Supabase requests fired: ${requestCount}`);
console.log(`Wall-clock time for the full parallel cold-load (Promise.all): ${overallMs.toFixed(0)}ms`);
console.log(`\nResult sizes — categories: ${categories.rows.length}, bestsellers: ${bestsellers.items.length}, premium: ${premium.items.length}, newArrivals: ${newArrivals.items.length}, giftHampers: ${giftHampers.items?.length ?? 0}, healthyPicks: ${healthyPicks.items.length}, banners: ${banners.rows.length}`);
