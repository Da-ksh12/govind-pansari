#!/usr/bin/env node
/**
 * Does every tile a customer sees have a real picture that loads? READ-ONLY, anonymous (the same view a customer has).
 *
 *   * every category the app shows (it hides empty ones) has an image — its own, or a photo of a product it contains
 *   * every category and product image URL actually loads as an image (a 200 with an image content type)
 *   * no two different products share one image
 *   * products with no photo are reported (WARN, not a failure: they are old test rows the photo rule cannot fix retroactively)
 *
 *   node --env-file=.env --no-warnings --import ./tests/unit/register-ts-resolver.mjs supabase/tests/storefront-images.test.mjs
 */
import { hasImage, isBrowsable, pickRepresentativeImages, selfAndDescendants } from '../../services/categoryDisplay.ts';

const U = process.env.EXPO_PUBLIC_SUPABASE_URL;
const K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!U || !K) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const headers = { apikey: K, Authorization: `Bearer ${K}` };
const get = async (path) => {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? passed++ : failed++;
};

const categories = await get('categories?select=id,name,slug,image_url,parent_id,is_active,sort_order&is_active=eq.true&order=sort_order');
const products = await get('products?select=id,name,slug,image,gallery,category_id,created_at&is_active=eq.true&order=created_at&limit=1000');

// The same decisions the app makes (services/repositories/categoryRepository.ts), from the same pure module.
const lite = categories.map((c) => ({ id: c.id, parentId: c.parent_id }));
const ownCounts = new Map(categories.map((c) => [c.id, products.filter((p) => p.category_id === c.id).length]));
const shown = categories.filter((c) => isBrowsable(lite, ownCounts, c.id));
const missing = shown.filter((c) => !hasImage(c.image_url)).map((c) => c.id);
const lookIn = new Set(missing.flatMap((id) => selfAndDescendants(lite, id)));
const photos = products.filter((p) => lookIn.has(p.category_id) && hasImage(p.image)).map((p) => ({ categoryId: p.category_id, image: p.image }));
const borrowed = pickRepresentativeImages(lite, missing, photos);

const hidden = categories.filter((c) => !shown.includes(c));
console.log(`${categories.length} active categories: ${shown.length} shown to customers, ${hidden.length} hidden because they hold no products${hidden.length ? ` (${hidden.map((c) => c.name).join(', ')})` : ''}`);
console.log(`${products.length} active products\n`);

const noPicture = shown.filter((c) => !hasImage(c.image_url) && !borrowed.has(c.id));
check('every category a customer sees has a picture (its own, or a photo of a product inside it)', noPicture.length === 0, `no picture: ${noPicture.map((c) => c.name).join(', ')}`);
const usingBorrowed = shown.filter((c) => !hasImage(c.image_url) && borrowed.has(c.id));
if (usingBorrowed.length) console.log(`      (${usingBorrowed.length} borrow a product photo: ${usingBorrowed.map((c) => c.name).join(', ')})`);

const urls = new Map();
const add = (url, label) => hasImage(url) && urls.set(url, [...(urls.get(url) ?? []), label]);
for (const c of categories) add(c.image_url, `category ${c.name}`);
for (const p of products) {
  add(p.image, `product ${p.name}`);
  for (const g of p.gallery ?? []) add(g, `gallery of ${p.name}`);
}
const queue = [...urls.keys()];
const results = [];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 25000);
        let r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
        if (r.status === 405 || r.status === 403) r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: ctl.signal });
        clearTimeout(timer);
        results.push({ url, status: r.status, type: r.headers.get('content-type') ?? '' });
      } catch (e) {
        results.push({ url, status: 0, type: String(e.name) });
      }
    }
  }),
);
const broken = results.filter((r) => r.status < 200 || r.status >= 300 || !/^image\//i.test(r.type));
check(`all ${results.length} category / product / gallery image URLs load as images`, broken.length === 0, broken.map((b) => `${b.status} ${b.url} ← ${urls.get(b.url)[0]}`).join('\n        '));

const shared = [...urls.entries()].filter(([, labels]) => new Set(labels.filter((l) => l.startsWith('product '))).size > 1);
check('no two different products share one primary image', shared.length === 0, shared.map(([u, l]) => `${u} ← ${l.join(', ')}`).join('\n        '));

const noPhoto = products.filter((p) => !hasImage(p.image));
console.log(noPhoto.length ? `\n  WARN ${noPhoto.length} active product(s) have no photo and show the neutral GP tile: ${noPhoto.map((p) => `${p.name} (${p.slug})`).join(', ')}` : '\n  every active product has a photo');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
