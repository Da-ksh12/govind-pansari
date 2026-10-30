import Image from 'next/image';
import Link from 'next/link';
import type { CollectionCard } from '@/lib/collections';
import { pluralize } from '@/lib/format';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from '../ui/SectionHeading';

export function CollectionsRail({ collections }: { collections: CollectionCard[] }) {
  if (collections.length === 0) return null;
  return (
    <section className="section-pad" aria-labelledby="collections-title">
      <div className="container-x">
        <Reveal>
          <SectionHeading eyebrow="Curated for you" title={<span id="collections-title">Collections</span>} intro="Hand-grouped by occasion and need, so the right thing is easy to find." link={{ href: '/collections', label: 'All collections' }} />
        </Reveal>
      </div>
      <ul className="rail container-x mt-10 pb-6 md:grid md:grid-cols-4 md:gap-x-6 md:gap-y-10 md:overflow-visible">
        {collections.slice(0, 8).map((c, i) => (
          <li key={c.slug} className="w-[72%] sm:w-[44%] md:w-auto">
            <Reveal delay={Math.min(i, 3) * 0.08}>
              <Link href={`/collections/${c.slug}`} className="group block">
                <span className="arch relative block aspect-[3/4] border border-line-strong bg-sand">
                  {c.image && <Image src={c.image} alt="" fill sizes="(min-width: 768px) 22vw, 70vw" className="object-cover transition duration-[1.2s] ease-[var(--ease-premium)] group-hover:scale-110" />}
                  <span className="absolute inset-0 bg-gradient-to-t from-maroon-darker/70 to-transparent" aria-hidden />
                </span>
                <span className="mt-4 block font-display text-xl font-semibold text-maroon">{c.label}</span>
                <span className="block text-sm text-taupe">{pluralize(c.count, 'product')}</span>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
