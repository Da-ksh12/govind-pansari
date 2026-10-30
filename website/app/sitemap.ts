import type { MetadataRoute } from 'next';
import { COLLECTIONS } from '@/lib/collections';
import { getCatalogue } from '@/lib/data/catalogue';
import { absoluteUrl } from '@/lib/site';

// Every public page a search engine should know about. Product and category pages come from the live catalogue; the account, cart, checkout and
// sign-in pages are private and are deliberately left out (and disallowed in robots.ts).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const fixed = ['/', '/shop', '/collections', '/gift-hampers', '/offers', '/bestsellers', '/about', '/contact', '/faq', '/shipping', '/refunds', '/privacy', '/terms'];
  const entries: MetadataRoute.Sitemap = fixed.map((path) => ({ url: absoluteUrl(path), lastModified: now, changeFrequency: path === '/' ? 'daily' : 'weekly', priority: path === '/' ? 1 : 0.6 }));

  try {
    const { products, categories } = await getCatalogue();
    for (const c of categories) entries.push({ url: absoluteUrl(`/category/${c.slug}`), lastModified: now, changeFrequency: 'weekly', priority: 0.8 });
    for (const def of COLLECTIONS) if (products.some((p) => p.tags.includes(def.slug))) entries.push({ url: absoluteUrl(`/collections/${def.slug}`), lastModified: now, changeFrequency: 'weekly', priority: 0.6 });
    for (const p of products) entries.push({ url: absoluteUrl(`/product/${p.slug}`), lastModified: new Date(p.createdAt), changeFrequency: 'weekly', priority: 0.7 });
  } catch {
    // if the catalogue cannot be read the fixed pages are still listed; the next regeneration adds the rest
  }
  return entries;
}
