import { NextResponse } from 'next/server';
import { getCatalogue } from '@/lib/data/catalogue';
import { startingPrice } from '@/lib/catalog/model';
import { suggest } from '@/lib/catalog/query';

// Typeahead for the search overlay. Reads the same cached catalogue as the pages, so it is fast and adds no database load per keystroke.
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80);
  try {
    const { products, categories } = await getCatalogue();
    const found = suggest(products, categories, q);
    return NextResponse.json(
      {
        products: found.products.map((p) => ({
          slug: p.slug,
          name: p.name,
          image: p.images[0] ?? null,
          category: p.categoryName,
          price: startingPrice(p),
        })),
        categories: found.categories.map((c) => ({ name: c.name, slug: c.slug })),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch {
    return NextResponse.json({ products: [], categories: [], error: 'Search is unavailable right now.' }, { status: 503 });
  }
}
