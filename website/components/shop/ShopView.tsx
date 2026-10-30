import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import type { Product } from '@/lib/catalog/model';
import { PAGE_SIZE, SORT_OPTIONS, applyShopQuery, priceBounds, shopQuery, type ShopParams } from '@/lib/catalog/query';
import type { Category } from '@/lib/data/catalogue-source';
import { formatINR, pluralize } from '@/lib/format';
import { ProductGrid } from '../commerce/ProductCard';
import { SortSelect } from './SortSelect';

interface Props {
  /** Where this list lives ("/shop", "/category/almonds"); filters and paging link back here. */
  basePath: string;
  /** The products this page is about, before the visitor's own filters (all products, one category, one collection, bestsellers...). */
  products: Product[];
  params: ShopParams;
  /** Category links for the sidebar; only the main shop passes these. */
  categories?: Category[];
  /** Shown when there is nothing at all (not merely nothing matching the filters). */
  emptyMessage?: string;
}

export function ShopView({ basePath, products, params, categories, emptyMessage }: Props) {
  const result = applyShopQuery(products, params);
  const bounds = priceBounds(products);
  const url = (over: Partial<ShopParams>) => `${basePath}${shopQuery({ ...params, page: 1, ...over })}`;

  const sortOptions = [...(params.q ? [{ key: 'relevance', label: 'Best match' }] : []), ...SORT_OPTIONS].map((o) => ({ ...o, href: url({ sort: o.key as ShopParams['sort'] }) }));

  const chips: { label: string; href: string }[] = [];
  if (params.q) chips.push({ label: `“${params.q}”`, href: url({ q: '', sort: 'featured' }) });
  if (params.category) chips.push({ label: categories?.find((c) => c.slug === params.category)?.name ?? params.category, href: url({ category: '' }) });
  if (params.minPrice !== null || params.maxPrice !== null) {
    const label = params.minPrice !== null && params.maxPrice !== null ? `${formatINR(params.minPrice)} – ${formatINR(params.maxPrice)}` : params.minPrice !== null ? `From ${formatINR(params.minPrice)}` : `Up to ${formatINR(params.maxPrice ?? 0)}`;
    chips.push({ label, href: url({ minPrice: null, maxPrice: null }) });
  }
  if (params.inStock) chips.push({ label: 'In stock only', href: url({ inStock: false }) });

  const filterPanel = (
    <div className="space-y-8">
      {categories && categories.length > 0 && (
        <nav aria-label="Categories">
          <h2 className="eyebrow">Category</h2>
          <ul className="mt-3 space-y-1">
            <li><Link href={url({ category: '' })} aria-current={!params.category ? 'true' : undefined} className="block rounded-xl px-3 py-2 text-sm font-semibold text-espresso hover:bg-sand aria-[current=true]:bg-maroon aria-[current=true]:text-ivory">All products</Link></li>
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={url({ category: c.slug })} aria-current={params.category === c.slug ? 'true' : undefined} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold hover:bg-sand aria-[current=true]:bg-maroon aria-[current=true]:text-ivory ${c.parentId ? 'pl-6 text-taupe' : 'text-espresso'}`}>
                  <span>{c.name}</span><span className="text-xs opacity-70">{c.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <form action={basePath} method="get" className="space-y-6">
        {params.q && <input type="hidden" name="q" value={params.q} />}
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.sort !== 'featured' && !(params.sort === 'relevance' && params.q) && <input type="hidden" name="sort" value={params.sort} />}
        <fieldset>
          <legend className="eyebrow">Price</legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-taupe">Min ₹
              <input name="min" inputMode="numeric" pattern="[0-9]*" defaultValue={params.minPrice ?? ''} placeholder={String(Math.floor(bounds.min))} className="field mt-1 !min-h-11" />
            </label>
            <label className="text-xs font-semibold text-taupe">Max ₹
              <input name="max" inputMode="numeric" pattern="[0-9]*" defaultValue={params.maxPrice ?? ''} placeholder={String(Math.ceil(bounds.max))} className="field mt-1 !min-h-11" />
            </label>
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-espresso">
          <input type="checkbox" name="stock" value="1" defaultChecked={params.inStock} className="h-5 w-5 accent-[var(--color-maroon)]" />
          In stock only
        </label>
        <button type="submit" className="btn btn-primary btn-sm w-full">Apply filters</button>
      </form>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
        <p className="text-sm text-taupe" aria-live="polite">
          {result.total === 0 ? 'No products' : <>Showing <strong className="text-espresso">{(result.page - 1) * PAGE_SIZE + 1}–{(result.page - 1) * PAGE_SIZE + result.items.length}</strong> of {pluralize(result.total, 'product')}</>}
        </p>
        <SortSelect value={params.sort} options={sortOptions} />
      </div>

      {chips.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.label}>
              <Link href={c.href} className="inline-flex items-center gap-1.5 rounded-full bg-maroon-tint px-3.5 py-1.5 text-sm font-semibold text-maroon hover:bg-maroon hover:text-ivory">
                {c.label} <X size={14} aria-label="Remove filter" />
              </Link>
            </li>
          ))}
          <li><Link href={basePath} className="inline-block px-2 py-1.5 text-sm font-semibold text-taupe underline">Clear all</Link></li>
        </ul>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="Filters">
          <details className="rounded-2xl border border-line-strong bg-paper p-4 lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between font-bold text-maroon">
              <span className="flex items-center gap-2"><SlidersHorizontal size={18} aria-hidden /> Filters{chips.length > 0 ? ` (${chips.length})` : ''}</span>
            </summary>
            <div className="mt-5">{filterPanel}</div>
          </details>
          <div className="sticky top-28 hidden lg:block">{filterPanel}</div>
        </aside>

        <div>
          {result.items.length > 0 ? (
            <>
              <ProductGrid products={result.items} headingLevel={2} />
              <Pagination page={result.page} pageCount={result.pageCount} href={(page) => `${basePath}${shopQuery({ ...params, page })}`} />
            </>
          ) : (
            <div className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-line-strong bg-paper/60 p-10 text-center">
              <div className="max-w-sm">
                <p className="font-display text-2xl text-maroon">{products.length === 0 ? 'Nothing here yet' : 'Nothing matches those filters'}</p>
                <p className="mt-2 text-sm text-taupe">
                  {products.length === 0 ? (emptyMessage ?? 'New products are added regularly. Please check back soon.') : 'Try widening the price range or removing a filter.'}
                </p>
                <Link href={products.length === 0 ? '/shop' : basePath} className="btn btn-primary mt-6">{products.length === 0 ? 'Browse the shop' : 'Clear filters'}</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  // first, last, and two either side of the current page, with gaps marked
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const numbers = [...wanted].sort((a, b) => a - b);
  const item = 'grid h-11 min-w-11 place-items-center rounded-full px-3 text-sm font-bold';
  return (
    <nav aria-label="Pagination" className="mt-12 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? <Link href={href(page - 1)} rel="prev" aria-label="Previous page" className={`${item} border border-line-strong text-maroon hover:bg-maroon hover:text-ivory`}><ChevronLeft size={18} aria-hidden /></Link> : null}
      {numbers.map((n, i) => (
        <span key={n} className="contents">
          {i > 0 && n - (numbers[i - 1] ?? 0) > 1 && <span className="px-1 text-stone" aria-hidden>…</span>}
          {n === page ? (
            <span aria-current="page" className={`${item} bg-maroon text-ivory`}>{n}</span>
          ) : (
            <Link href={href(n)} aria-label={`Page ${n}`} className={`${item} border border-line-strong text-maroon hover:bg-sand`}>{n}</Link>
          )}
        </span>
      ))}
      {page < pageCount ? <Link href={href(page + 1)} rel="next" aria-label="Next page" className={`${item} border border-line-strong text-maroon hover:bg-maroon hover:text-ivory`}><ChevronRight size={18} aria-hidden /></Link> : null}
    </nav>
  );
}
