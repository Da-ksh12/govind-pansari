// Live check (not part of `npm test`): reads the real catalogue as an anonymous visitor, exactly as the website does.
// Run:  node --no-warnings --import ./tests/register-ts-resolver.mjs tests/live-catalogue.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { loadCatalogue } from '../lib/data/catalogue-source.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const started = Date.now();
const cat = await loadCatalogue(db);
console.log(`loaded in ${Date.now() - started} ms`);
console.log('products:', cat.products.length, '| categories:', cat.categories.length);
console.log('categories:', cat.categories.map((c) => `${c.name}(${c.productCount})${c.image ? '' : ' [no image]'}`).join(', '));
const noImage = cat.products.filter((p) => p.images.length === 0);
console.log('products without image:', noImage.map((p) => p.name));
const noCat = cat.products.filter((p) => !p.categoryId);
console.log('products without category:', noCat.map((p) => p.name));
const out = cat.products.filter((p) => p.variants.every((v) => v.stock === 'out_of_stock'));
console.log('fully out of stock:', out.length);
console.log('bestsellers:', cat.products.filter((p) => p.badges.includes('bestseller')).map((p) => p.name));
console.log('sample:', JSON.stringify(cat.products[0], null, 1).slice(0, 900));
