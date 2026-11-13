import Image from 'next/image';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Reveal } from '@/components/ui/Reveal';
import { collectionCards } from '@/lib/collections';
import { getCatalogue } from '@/lib/data/catalogue';
import { pluralize } from '@/lib/format';

export const metadata: Metadata = { title: 'Collections', description: 'Shop Govind Pansari by occasion and need: gifting, premium picks, healthy snacking, cooking essentials and more.', alternates: { canonical: '/collections' } };
export const revalidate = 60;

export default async function CollectionsPage() {
  const cards = collectionCards((await getCatalogue()).products);
  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Collections' }]} title="Collections" intro="Hand-grouped by occasion and need, so the right thing is easy to find." />
      <div className="container-x py-12 sm:py-16">
        {cards.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong p-12 text-center text-taupe">Collections are being put together. In the meantime, <Link href="/shop" className="font-semibold text-maroon underline">browse the whole shop</Link>.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {cards.map((c, i) => (
              <li key={c.slug}>
                <Reveal delay={Math.min(i, 3) * 0.07}>
                  <Link href={`/collections/${c.slug}`} className="group block">
                    <span className="arch relative block aspect-[3/4] border border-line-strong bg-sand">
                      {c.image && <Image src={c.image} alt="" fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-cover transition duration-[1.2s] ease-[var(--ease-premium)] group-hover:scale-110" />}
                      <span className="absolute inset-0 bg-gradient-to-t from-maroon-darker/60 to-transparent" aria-hidden />
                    </span>
                    <span className="mt-4 block font-display text-xl font-semibold text-maroon">{c.label}</span>
                    <span className="block text-sm text-taupe">{c.blurb}</span>
                    <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-gold-dark">{pluralize(c.count, 'product')}</span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
