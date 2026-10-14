#!/usr/bin/env node
/**
 * Adds 15 additional realistic Govind Pansari products (variants +
 * per-store inventory) through the real admin path — admin_create_product_full,
 * the same RPC the Admin Products screen calls — rather than a raw SQL
 * INSERT, so every RLS/permission/validation rule the app itself is
 * bound by also applies here.
 *
 * Deliberately a script, not a SQL migration: admin_create_product_full
 * requires an authenticated session with products.create (checked via
 * has_permission()), which only exists in an Auth-issued JWT — a
 * migration runs as the Postgres role and has no auth.uid(). Uses the
 * same test-OTP idiom every test suite in supabase/tests/ already uses
 * to get one, briefly promotes that account to admin/inventory_manager
 * (the same role catalogue-management.test.mjs uses for these exact
 * RPCs), and restores its original role when done — it is not left
 * behind as a live admin account.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/03_seed_demo_products.mjs
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function otpLogin(phone) {
  await fetch(`${AUTH}/otp`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ phone }) });
  const res = await fetch(`${AUTH}/verify`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) });
  const json = await res.json();
  if (!json.user) throw new Error(`OTP login failed for ${phone}: ${JSON.stringify(json)}`);
  return json;
}
function authed(token) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function rpc(headers, name, body) {
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`${name} failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

// Real category ids (supabase/migrations/20260826000016 fixed seed ids — see 01_catalogue_and_stores).
const CAT = {
  almonds: '00000000-0000-0000-0000-000000000211',
  cashews: '00000000-0000-0000-0000-000000000212',
  pistachios: '00000000-0000-0000-0000-000000000213',
  walnuts: '00000000-0000-0000-0000-000000000214',
  raisins: '00000000-0000-0000-0000-000000000215',
  dates: '00000000-0000-0000-0000-000000000216',
  dryFruits: '00000000-0000-0000-0000-000000000201',
  spices: '00000000-0000-0000-0000-000000000202',
  healthyFoods: '00000000-0000-0000-0000-000000000203',
  giftHampers: '00000000-0000-0000-0000-000000000205',
};
const STORE = {
  sanjayPlace: '00000000-0000-0000-0000-000000000101',
  vijayNagar: '00000000-0000-0000-0000-000000000102',
  awasVikas: '00000000-0000-0000-0000-000000000103',
};

// [store, quantity, reorderLevel, isAvailable] rows applied per variant_index.
function stock(sanjay, vijay, awas) {
  return [
    { store_id: STORE.sanjayPlace, quantity: sanjay, reorder_level: Math.max(3, Math.round(sanjay * 0.15)), is_available: sanjay > 0 },
    { store_id: STORE.vijayNagar, quantity: vijay, reorder_level: Math.max(3, Math.round(vijay * 0.15)), is_available: vijay > 0 },
    { store_id: STORE.awasVikas, quantity: awas, reorder_level: Math.max(3, Math.round(awas * 0.15)), is_available: awas > 0 },
  ];
}

const PRODUCTS = [
  {
    name: 'Mamra Almonds',
    slug: 'mamra-almonds',
    category_id: CAT.almonds,
    short_description: 'Rare Kashmiri Mamra almonds — smaller, denser and naturally sweeter than regular almonds.',
    description: 'Mamra almonds are grown in the Kashmir valley and are prized for their rich, sweet flavour and firm bite — a different variety from the common Californian almond, and considerably rarer. Hand-sorted for size and freshness at our Agra store, unblanched with skin on for maximum nutrition.',
    tags: ['premium-collection', 'immunity', 'gifting'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-MAM-100', weight_value: 100, weight_unit: 'g', price: 289, mrp: 339, stock: stock(30, 18, 10) },
      { sku: 'GP-MAM-250', weight_value: 250, weight_unit: 'g', price: 679, mrp: 799, stock: stock(24, 14, 8) },
      { sku: 'GP-MAM-500', weight_value: 500, weight_unit: 'g', price: 1299, mrp: 1499, stock: stock(12, 6, 4) },
    ],
  },
  {
    name: 'Jumbo Cashews W180',
    slug: 'jumbo-cashews-w180',
    category_id: CAT.cashews,
    short_description: 'The largest, whitest cashew grade — W180 counts roughly 180 kernels per pound.',
    description: 'W180 is the largest and most sought-after whole cashew grade, prized for its size, colour and creamy bite. Sourced and graded for our Agra stores, sold raw and unroasted so you can prepare them however you like.',
    tags: ['healthy-snacking', 'protein-rich', 'daily-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-JCW-250', weight_value: 250, weight_unit: 'g', price: 549, mrp: 649, stock: stock(28, 20, 12) },
      { sku: 'GP-JCW-500', weight_value: 500, weight_unit: 'g', price: 1049, mrp: 1199, stock: stock(18, 12, 6) },
      { sku: 'GP-JCW-1000', weight_value: 1, weight_unit: 'kg', price: 1999, mrp: 2299, stock: stock(8, 5, 2) },
    ],
  },
  {
    name: 'Iranian Pistachios',
    slug: 'iranian-pistachios',
    category_id: CAT.pistachios,
    short_description: 'Naturally split, roasted Iranian pistachios — bigger kernels, richer flavour.',
    description: 'Iranian (Akbari) pistachios are naturally larger and more richly flavoured than most other varieties, with a satisfying natural split that makes them easy to shell. Lightly roasted, unsalted, no additives.',
    tags: ['premium-collection', 'gifting'],
    is_bestseller: true, is_featured: false,
    variants: [
      { sku: 'GP-IPI-250', weight_value: 250, weight_unit: 'g', price: 649, mrp: 749, stock: stock(26, 16, 9) },
      { sku: 'GP-IPI-500', weight_value: 500, weight_unit: 'g', price: 1249, mrp: 1449, stock: stock(14, 9, 4) },
      { sku: 'GP-IPI-1000', weight_value: 1, weight_unit: 'kg', price: 2399, mrp: 2749, stock: stock(6, 3, 0) },
    ],
  },
  {
    name: 'Kashmiri Walnut Halves',
    slug: 'kashmiri-walnut-halves',
    category_id: CAT.walnuts,
    short_description: 'Light-coloured, extra-large walnut halves from Kashmir — mild, never bitter.',
    description: 'Kashmiri walnuts are known for their light kernel colour and mild, non-bitter taste compared to other walnut-growing regions. Sold as clean halves and large pieces — ideal for snacking, baking, and festive sweets.',
    tags: ['healthy-snacking', 'immunity', 'cooking-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-KWH-250', weight_value: 250, weight_unit: 'g', price: 579, mrp: 679, stock: stock(25, 15, 8) },
      { sku: 'GP-KWH-500', weight_value: 500, weight_unit: 'g', price: 1099, mrp: 1249, stock: stock(15, 9, 5) },
      { sku: 'GP-KWH-1000', weight_value: 1, weight_unit: 'kg', price: 2099, mrp: 2399, stock: stock(7, 4, 2) },
    ],
  },
  {
    name: 'Afghani Black Raisins',
    slug: 'afghani-black-raisins',
    category_id: CAT.raisins,
    short_description: 'Sun-dried seedless black raisins from Afghanistan — dense, chewy, naturally sweet.',
    description: 'A darker, denser cousin of the everyday golden raisin, Afghani black raisins are sun-dried on the vine for a deep, concentrated sweetness. A favourite for winter snacking and traditional remedies.',
    tags: ['daily-essentials', 'healthy-snacking'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-ABR-250', weight_value: 250, weight_unit: 'g', price: 219, mrp: 249, stock: stock(35, 22, 14) },
      { sku: 'GP-ABR-500', weight_value: 500, weight_unit: 'g', price: 419, mrp: 469, stock: stock(20, 13, 7) },
      { sku: 'GP-ABR-1000', weight_value: 1, weight_unit: 'kg', price: 799, mrp: 899, stock: stock(10, 6, 3) },
    ],
  },
  {
    name: 'Green Seedless Raisins',
    slug: 'green-seedless-raisins',
    category_id: CAT.raisins,
    short_description: 'Long, tangy-sweet green seedless raisins — a kids favourite.',
    description: 'Lighter and slightly tangier than the classic golden raisin, our green seedless raisins are a favourite for lunchboxes and everyday snacking. Cleaned and hand-sorted, no added sugar or preservatives.',
    tags: ['kids', 'daily-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-GSR-250', weight_value: 250, weight_unit: 'g', price: 209, mrp: 239, stock: stock(30, 20, 12) },
      { sku: 'GP-GSR-500', weight_value: 500, weight_unit: 'g', price: 399, mrp: 449, stock: stock(16, 10, 6) },
    ],
  },
  {
    name: 'Turkish Dried Figs (Anjeer)',
    slug: 'turkish-dried-figs-anjeer',
    category_id: CAT.dryFruits,
    short_description: 'Soft, naturally sweet Turkish anjeer — no added sugar, no preservatives.',
    description: 'Turkish figs are sun-dried at peak ripeness for a soft, chewy texture and natural honey-like sweetness. A traditional favourite for immunity and digestion, and a popular festive gifting item across North India.',
    tags: ['healthy-snacking', 'immunity', 'premium-collection'],
    is_bestseller: false, is_featured: true,
    variants: [
      { sku: 'GP-FIG-250', weight_value: 250, weight_unit: 'g', price: 449, mrp: 529, stock: stock(22, 14, 8) },
      { sku: 'GP-FIG-500', weight_value: 500, weight_unit: 'g', price: 849, mrp: 999, stock: stock(12, 7, 4) },
    ],
  },
  {
    name: 'Iranian Mabroom Dates',
    slug: 'iranian-mabroom-dates',
    category_id: CAT.dates,
    short_description: 'Soft, caramel-toned Mabroom dates — a rich, everyday alternative to Medjool.',
    description: 'Mabroom dates have an elongated shape, deep caramel colour and a firmer, chewier bite than Medjool — an everyday favourite across the Middle East and increasingly in India. Naturally sweet, no added syrup.',
    tags: ['healthy-snacking', 'daily-essentials', 'immunity'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-MBD-250', weight_value: 250, weight_unit: 'g', price: 329, mrp: 379, stock: stock(28, 18, 10) },
      { sku: 'GP-MBD-500', weight_value: 500, weight_unit: 'g', price: 629, mrp: 719, stock: stock(16, 10, 5) },
      { sku: 'GP-MBD-1000', weight_value: 1, weight_unit: 'kg', price: 1199, mrp: 1379, stock: stock(8, 4, 2) },
    ],
  },
  {
    name: 'Premium Pumpkin Seeds',
    slug: 'premium-pumpkin-seeds',
    category_id: CAT.healthyFoods,
    short_description: 'Hulled, roasted pumpkin seeds — a light, protein-rich everyday snack.',
    description: 'Hulled and lightly roasted with no added oil, these pumpkin seeds (kaddu ke beej) are a favourite for salads, trail mixes and everyday snacking — naturally rich in magnesium and zinc.',
    tags: ['healthy-snacking', 'protein-rich', 'cooking-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-PUS-100', weight_value: 100, weight_unit: 'g', price: 179, mrp: 209, stock: stock(24, 15, 9) },
      { sku: 'GP-PUS-250', weight_value: 250, weight_unit: 'g', price: 399, mrp: 459, stock: stock(14, 8, 5) },
    ],
  },
  {
    name: 'Roasted Sunflower Seeds',
    slug: 'roasted-sunflower-seeds',
    category_id: CAT.healthyFoods,
    short_description: 'Lightly roasted, unsalted sunflower seeds — a crunchy, budget-friendly daily snack.',
    description: 'Roasted in small batches with no added salt or oil, these sunflower seeds are a light, everyday snacking option and a common addition to homemade trail mixes and granola.',
    tags: ['healthy-snacking', 'protein-rich', 'daily-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-SFS-100', weight_value: 100, weight_unit: 'g', price: 129, mrp: 149, stock: stock(30, 20, 12) },
      { sku: 'GP-SFS-250', weight_value: 250, weight_unit: 'g', price: 289, mrp: 329, stock: stock(16, 10, 6) },
    ],
  },
  {
    name: 'Premium Dry Fruit Trail Mix',
    slug: 'premium-dry-fruit-trail-mix',
    category_id: CAT.dryFruits,
    short_description: 'Our house blend — almonds, cashews, raisins, pistachios and berries in one pack.',
    description: "Our most popular everyday mix: California almonds, whole cashews, golden raisins, pistachios and dried berries in one resealable pack. No added sugar or oil — exactly what's in the name and nothing else.",
    tags: ['healthy-snacking', 'protein-rich', 'gifting', 'kids'],
    is_bestseller: true, is_featured: true,
    variants: [
      { sku: 'GP-TRM-250', weight_value: 250, weight_unit: 'g', price: 449, mrp: 529, stock: stock(32, 22, 14) },
      { sku: 'GP-TRM-500', weight_value: 500, weight_unit: 'g', price: 849, mrp: 989, stock: stock(18, 12, 7) },
    ],
  },
  {
    name: 'Roasted & Salted Cashews',
    slug: 'roasted-salted-cashews',
    category_id: CAT.cashews,
    short_description: 'Whole cashews, roasted and lightly salted — ready to eat, no prep needed.',
    description: 'The same whole cashew kernels as our raw range, roasted in small batches and finished with a light dusting of salt. A ready-to-eat everyday snack, no soaking or roasting needed at home.',
    tags: ['healthy-snacking', 'daily-essentials'],
    is_bestseller: false, is_featured: false,
    variants: [
      { sku: 'GP-RSC-250', weight_value: 250, weight_unit: 'g', price: 519, mrp: 599, stock: stock(24, 16, 9) },
      { sku: 'GP-RSC-500', weight_value: 500, weight_unit: 'g', price: 989, mrp: 1149, stock: stock(14, 8, 4) },
      { sku: 'GP-RSC-1000', weight_value: 1, weight_unit: 'kg', price: 1879, mrp: 2199, stock: stock(6, 3, 0) },
    ],
  },
  {
    name: 'Kashmiri Saffron (Kesar)',
    slug: 'kashmiri-saffron-kesar',
    category_id: CAT.spices,
    short_description: 'Deep red Kashmiri Mongra saffron threads — sold by the gram.',
    description: "Genuine Kashmiri Mongra saffron — deep crimson threads with a strong aroma and colour release, the grade traditionally used in biryani, kheer and festive sweets. Sold by the gram, exactly as it's weighed in-store.",
    tags: ['premium-collection', 'cooking-essentials', 'gifting'],
    is_bestseller: false, is_featured: true,
    variants: [
      { sku: 'GP-SAF-1', weight_value: 1, weight_unit: 'g', price: 349, mrp: 399, stock: stock(20, 12, 6) },
      { sku: 'GP-SAF-2', weight_value: 2, weight_unit: 'g', price: 649, mrp: 749, stock: stock(14, 8, 4) },
      { sku: 'GP-SAF-5', weight_value: 5, weight_unit: 'g', price: 1499, mrp: 1749, stock: stock(6, 3, 1) },
    ],
  },
  {
    name: 'Royal Dry Fruit Gift Box',
    slug: 'royal-dry-fruit-gift-box',
    category_id: CAT.giftHampers,
    short_description: 'A curated wooden gift box of almonds, cashews, pistachios and dates.',
    description: 'An assortment of our best-selling almonds, cashews, pistachios and dates, packed in a reusable wooden gift box with a ribbon finish. A popular choice for weddings, corporate gifting and festive occasions.',
    tags: ['gifting', 'premium-collection'],
    is_bestseller: false, is_featured: true,
    variants: [
      { sku: 'GP-RGB-600', weight_value: 600, weight_unit: 'g', price: 1099, mrp: 1299, stock: stock(15, 9, 5) },
      { sku: 'GP-RGB-1000', weight_value: 1, weight_unit: 'kg', price: 1799, mrp: 2099, stock: stock(8, 5, 2) },
    ],
  },
  {
    name: 'Diwali Festival Gift Hamper',
    slug: 'diwali-festival-gift-hamper',
    category_id: CAT.giftHampers,
    short_description: 'Our largest festive hamper — dry fruits, saffron and traditional sweets in one box.',
    description: 'Our most complete festive hamper: a mix of dry fruits, Kashmiri saffron and traditional sweets, packed in decorative festive packaging. Popular for Diwali, weddings and corporate gifting through the season.',
    tags: ['gifting', 'premium-collection'],
    is_bestseller: true, is_featured: true,
    variants: [
      { sku: 'GP-DFH-800', weight_value: 800, weight_unit: 'g', price: 1399, mrp: 1649, stock: stock(18, 11, 6) },
      { sku: 'GP-DFH-1500', weight_value: 1.5, weight_unit: 'kg', price: 2399, mrp: 2799, stock: stock(9, 5, 2) },
    ],
  },
];

async function main() {
  console.log(`Running against ${URL}`);

  // The live project's test-OTP config only recognizes already-registered
  // numbers (confirmed live — a brand-new number gets otp_expired), so
  // this reuses the seeded demo customer account exactly the way
  // catalogue-management.test.mjs reuses demo.manager2's number for its
  // own temporary delivery_manager promotion: briefly promoted to
  // inventory_manager (products.create/edit + inventory.manage — the
  // exact scope that suite uses for these same RPCs), then restored.
  const login = await otpLogin('+919000000201');
  const userId = login.user.id;
  const originalProfile = await fetch(`${REST}/profiles?id=eq.${userId}&select=role,admin_role`, { headers: svcHeaders }).then((r) => r.json());
  await fetch(`${REST}/profiles?id=eq.${userId}`, {
    method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', admin_role: 'inventory_manager' }),
  });
  const adminHeaders = authed(login.access_token);

  const created = [];
  const failedProducts = [];
  try {
    for (const p of PRODUCTS) {
      try {
        const result = await rpc(adminHeaders, 'admin_create_product_full', {
          p_product: {
            category_id: p.category_id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            short_description: p.short_description,
            tags: p.tags,
            is_featured: p.is_featured,
            is_bestseller: p.is_bestseller,
          },
          p_variants: p.variants.map((v) => ({ sku: v.sku, weight_value: v.weight_value, weight_unit: v.weight_unit, price: v.price, mrp: v.mrp })),
          p_inventory: p.variants.flatMap((v, variantIndex) => v.stock.map((s) => ({ ...s, variant_index: variantIndex }))),
        });
        created.push({ name: p.name, productId: result.productId, variantIds: result.variantIds });
        console.log(`  ok  ${p.name} (${p.variants.length} variants, ${p.variants.length * 3} inventory rows)`);
      } catch (e) {
        failedProducts.push({ name: p.name, error: e.message });
        console.log(`FAIL  ${p.name}\n      ${e.message}`);
      }
    }
  } finally {
    // Always restore the account's original role, whether or not every product succeeded.
    await fetch(`${REST}/profiles?id=eq.${userId}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify(originalProfile[0]) });
  }

  console.log(`\n${created.length} products created, ${failedProducts.length} failed.`);
  if (failedProducts.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
