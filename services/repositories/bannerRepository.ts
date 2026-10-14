import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toBanner } from '../supabase/mappers';
import type { Banner } from '../../types/models';
import type { BannerRow } from '../../types/supabase';

const FALLBACK_ROUTE = '/(tabs)/categories';

/** Resolves target_type/target_id (+ target_url) into an in-app route, batching the category/product slug lookups. */
async function resolveDeepLinks(rows: BannerRow[]): Promise<Map<string, string>> {
  const categoryIds = rows.filter((r) => r.target_type === 'category' && r.target_id).map((r) => r.target_id!);
  const productIds = rows.filter((r) => r.target_type === 'product' && r.target_id).map((r) => r.target_id!);

  const [categorySlugs, productSlugs] = await Promise.all([
    categoryIds.length
      ? supabase.from('categories').select('id, slug').in('id', categoryIds).then(({ data }) => new Map((data ?? []).map((c) => [c.id, c.slug])))
      : Promise.resolve(new Map<string, string>()),
    productIds.length
      ? supabase.from('products').select('id, slug').in('id', productIds).then(({ data }) => new Map((data ?? []).map((p) => [p.id, p.slug])))
      : Promise.resolve(new Map<string, string>()),
  ]);

  const links = new Map<string, string>();
  for (const row of rows) {
    if (row.target_url) {
      links.set(row.id, row.target_url);
    } else if (row.target_type === 'category' && row.target_id && categorySlugs.has(row.target_id)) {
      links.set(row.id, `/category/${categorySlugs.get(row.target_id)}`);
    } else if (row.target_type === 'product' && row.target_id && productSlugs.has(row.target_id)) {
      links.set(row.id, `/product/${productSlugs.get(row.target_id)}`);
    } else {
      links.set(row.id, FALLBACK_ROUTE);
    }
  }
  return links;
}

export const bannerRepository = {
  async list(): Promise<Banner[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .eq('is_active', true)
      .lte('start_at', nowIso)
      .or(`end_at.is.null,end_at.gte.${nowIso}`)
      .order('sort_order');
    if (error) throw toCatalogueError(error);

    const rows = data as BannerRow[];
    const links = await resolveDeepLinks(rows);
    return rows.map((row) => toBanner(row, links.get(row.id) ?? FALLBACK_ROUTE));
  },
};
