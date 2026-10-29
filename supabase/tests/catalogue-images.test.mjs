#!/usr/bin/env node
/**
 * Catalogue image integrity suite. READ-ONLY: checks the data every customer
 * screen draws images from — Home, Categories, Search, Product Details and
 * Cart all render products' / categories' stored URLs; Orders renders each
 * order line's frozen snapshot with the product's current photo as fallback.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     node supabase/tests/catalogue-images.test.mjs
 *
 * The order-line section signs in as the QA super admin
 * (+919000000301 / OTP 123456, same as admin-dashboard-consistency.test.mjs).
 * Products that genuinely have no photo yet are reported, not failed: the app
 * shows its neutral Govind Pansari tile for them by design.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const MAX_BYTES = 5 * 1024 * 1024;
const anon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    failed++;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const get = async (path, headers = anon) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> ${res.status}`);
  return res.json();
};

const probes = new Map();
/** One GET per distinct URL: status, content type, size and cache lifetime. */
function probe(url) {
  if (!probes.has(url)) {
    probes.set(
      url,
      fetch(url).then(async (res) => {
        const bytes = (await res.arrayBuffer()).byteLength;
        return { ok: res.ok && /^image\//.test(res.headers.get('content-type') ?? ''), status: res.status, bytes, cache: res.headers.get('cache-control') ?? '' };
      }).catch(() => ({ ok: false, status: 0, bytes: 0, cache: '' })),
    );
  }
  return probes.get(url);
}

console.log(`Running against ${URL}\n`);

const products = await get('products?select=id,name,image,gallery,is_active&limit=1000');
const categories = await get('categories?select=id,name,image_url&limit=500');
const productUrls = products.flatMap((p) => [p.image, ...(p.gallery ?? [])].filter(Boolean).map((url) => ({ owner: p.name, url })));

await check('every category has an image that loads (Categories tab, Home rail, category pages)', async () => {
  const missing = categories.filter((c) => !c.image_url).map((c) => c.name);
  assert(missing.length === 0, `categories without an image: ${missing.join(', ')}`);
  const broken = [];
  for (const c of categories) if (!(await probe(c.image_url)).ok) broken.push(c.name);
  assert(broken.length === 0, `categories whose image does not load: ${broken.join(', ')}`);
});

await check('no product points at a file that no longer exists (the cause of blank product photos)', async () => {
  const broken = [];
  for (const { owner, url } of productUrls) {
    const r = await probe(url);
    if (!r.ok) broken.push(`${owner} (${r.status}) ${url.split('/').pop()}`);
  }
  assert(broken.length === 0, `dead image references:\n        ${broken.join('\n        ')}`);
});

await check('every stored image is within the bucket limit (5 MB) and is an image type', async () => {
  const tooBig = [];
  for (const { owner, url } of productUrls) {
    const r = await probe(url);
    if (r.bytes > MAX_BYTES) tooBig.push(owner);
  }
  assert(tooBig.length === 0, `oversized: ${tooBig.join(', ')}`);
});

await check('catalogue images added by the stock-photo pass are cached for a year', async () => {
  const added = [...categories.map((c) => c.image_url), ...productUrls.map((p) => p.url)].filter((u) => u?.includes('/catalogue/'));
  assert(added.length > 0, 'no /catalogue/ images found');
  for (const url of added) {
    const r = await probe(url);
    assert(/max-age=31536000/.test(r.cache), `${url.split('/').pop()} cache-control is "${r.cache}"`);
  }
});

await check('different products do not share one picture (no generic stand-in)', () => {
  const byUrl = new Map();
  for (const p of products) {
    const primary = p.image ?? p.gallery?.[0];
    if (!primary) continue;
    byUrl.set(primary, [...(byUrl.get(primary) ?? []), p.name]);
  }
  // A real photo reused by two listings of the same item is legitimate; the same URL on many unrelated names is not.
  const shared = [...byUrl.entries()].filter(([, names]) => names.length > 2);
  assert(shared.length === 0, `one image on 3+ products: ${shared.map(([u, n]) => `${u.split('/').pop()} -> ${n.join(', ')}`).join('; ')}`);
});

// ---- Orders: needs an admin session to read every customer's order lines.
const base = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
await fetch(`${URL}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone: '+919000000301' }) });
const session = await (await fetch(`${URL}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone: '+919000000301', token: '123456' }) })).json();
if (!session.access_token) {
  console.error('QA admin login failed — skipping the order-line checks.');
} else {
  const admin = { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` };
  const lines = await get('order_items?select=product_id,product_name_snapshot,image_snapshot,products(image)&limit=5000', admin);
  let withPhoto = 0;
  const stillTile = new Map();
  for (const line of lines) {
    const candidates = [line.image_snapshot, line.products?.image].filter(Boolean);
    let shown = false;
    for (const url of [...new Set(candidates)]) {
      if ((await probe(url)).ok) { shown = true; break; } // AppImage tries the snapshot, then the product photo
    }
    if (shown) withPhoto++;
    else stillTile.set(line.product_name_snapshot, (stillTile.get(line.product_name_snapshot) ?? 0) + 1);
  }
  await check('every order line whose product has a photo shows it (Orders list, order details, notifications)', () => {
    const productsWithPhoto = new Set(products.filter((p) => p.image || (p.gallery ?? []).length).map((p) => p.name));
    const blankDespitePhoto = [...stillTile.keys()].filter((n) => productsWithPhoto.has(n));
    assert(blankDespitePhoto.length === 0, `blank although the product has a photo: ${blankDespitePhoto.join(', ')}`);
  });
  console.log(`\n  order lines: ${lines.length}, showing a real photo: ${withPhoto}, showing the neutral tile: ${lines.length - withPhoto}`);
  if (stillTile.size) console.log(`  neutral tile because the product has no photo yet: ${[...stillTile.keys()].join(', ')}`);
}

const without = products.filter((p) => !p.image && !(p.gallery ?? []).length).map((p) => p.name);
console.log(`\n  products without a photo (neutral tile by design): ${without.length} of ${products.length}`);
if (without.length) console.log(`  ${without.join(' | ')}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
