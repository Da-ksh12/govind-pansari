import { NextResponse } from 'next/server';
import { getCatalogue } from '@/lib/data/catalogue';
import type { VariantDetail } from '@/lib/cart/types';

// Turns the variant ids in a visitor's cart into names, pictures and CURRENT prices from the cached catalogue. The browser never stores prices.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 60;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json([] satisfies VariantDetail[]);

  try {
    const { products } = await getCatalogue();
    const wanted = new Set(ids);
    const out: VariantDetail[] = [];
    for (const product of products) {
      for (const v of product.variants) {
        if (!wanted.has(v.id)) continue;
        out.push({
          variantId: v.id,
          productId: product.id,
          productSlug: product.slug,
          name: product.name,
          image: product.images[0] ?? null,
          label: v.label,
          sku: v.sku,
          price: v.price,
          mrp: v.mrp,
          stock: v.stock,
        });
      }
    }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  } catch {
    return NextResponse.json({ error: 'The catalogue is unavailable right now.' }, { status: 503 });
  }
}
