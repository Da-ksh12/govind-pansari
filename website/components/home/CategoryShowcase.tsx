import Image from 'next/image';
import Link from 'next/link';
import type { Category } from '@/lib/data/catalogue-source';
import { pluralize } from '@/lib/format';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from '../ui/SectionHeading';
import { Seal } from '../brand/Logo';

/**
 * Real categories from the database. The six with the most products get picture tiles (the first two larger) — the shelves a customer is most
 * likely to want; every other category is one tap away in the row of links underneath, so none is hidden.
 */
export function CategoryShowcase({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null;
  const ranked = [...categories].filter((c) => c.image).sort((a, b) => b.productCount - a.productCount || a.sortOrder - b.sortOrder);
  const tiles = ranked.slice(0, 6);
  const more = categories.filter((c) => !tiles.includes(c));
  return (
    <section id="categories" className="section-pad container-x scroll-mt-24" aria-labelledby="cat-title">
      <Reveal>
        <SectionHeading
          eyebrow="Shop by category"
          title={<span id="cat-title">From the heart of the pansari</span>}
          intro="Every shelf of the shop, in one place. Pick a category to see what is fresh today."
          link={{ href: '/shop', label: 'See everything' }}
        />
      </Reveal>
      <ul className="mt-12 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4 md:grid-rows-2">
        {tiles.map((c, i) => {
          const big = i < 2;
          return (
            <li key={c.id} className={big ? 'col-span-2 md:row-span-2' : ''}>
              <Reveal delay={Math.min(i, 5) * 0.07} className="h-full">
                <Link
                  href={`/category/${c.slug}`}
                  className={`group relative flex h-full w-full flex-col justify-end overflow-hidden rounded-3xl bg-maroon ${big ? 'min-h-72 md:min-h-[26rem]' : 'min-h-48 sm:min-h-56'}`}
                >
                  {c.image ? (
                    <Image src={c.image} alt="" fill sizes={big ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 50vw'} className="object-cover transition duration-[1.2s] ease-[var(--ease-premium)] group-hover:scale-110" />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-maroon to-maroon-darker"><Seal size={72} className="opacity-50" /></span>
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-maroon-darker/90 via-maroon-darker/25 to-transparent" aria-hidden />
                  <span className="relative p-5 sm:p-6">
                    <span className={`block font-display font-semibold leading-tight text-ivory ${big ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>{c.name}</span>
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.18em] text-gold">{pluralize(c.productCount, 'product')}</span>
                  </span>
                </Link>
              </Reveal>
            </li>
          );
        })}
      </ul>
      {more.length > 0 && (
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-2.5" aria-label="More categories">
          {more.map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.slug}`} className="inline-block rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-maroon transition hover:bg-maroon hover:text-ivory">
                {c.name} <span className="text-taupe">· {c.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
