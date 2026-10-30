import { Gift, Leaf, MapPin, ShieldCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Seal } from '@/components/brand/Logo';
import { ProductImage } from '@/components/ui/ProductImage';
import { PageHeader } from '@/components/ui/PageHeader';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { STORY_PRODUCT_SLUG } from '@/lib/collections';
import { getCatalogue } from '@/lib/data/catalogue';
import { clockLabel, getStores } from '@/lib/data/storefront';
import { BRAND } from '@/lib/site';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Our Story',
  description: 'Govind Pansari has been part of Agra’s everyday life since 1950 — three generations of the same family, picking every batch and grinding every spice.',
  alternates: { canonical: '/about' },
};
export const revalidate = 300;

const OFFERINGS = [
  { icon: Leaf, title: 'Dry fruits', text: 'Almonds, cashews, pistachios, walnuts, raisins and more, handpicked.' },
  { icon: ShieldCheck, title: 'Spices & masalas', text: 'Pure, freshly ground everyday spices.' },
  { icon: Gift, title: 'Gift hampers', text: 'Curated boxes for every occasion.' },
];

export default async function AboutPage() {
  const [{ products }, stores] = await Promise.all([getCatalogue(), getStores()]);
  const photo = products.find((p) => p.slug === STORY_PRODUCT_SLUG)?.images[0] ?? null;

  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'Our story', url: absoluteUrl('/about'), about: { '@type': 'Organization', name: BRAND.name, foundingDate: String(BRAND.since) } }} />
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Our story' }]} eyebrow="Since 1950 · Agra" title="Rooted in Agra. Inspired by a Finer Taste." />

      <section className="section-pad container-x grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative mx-auto w-full max-w-md">
          <div className="arch relative aspect-[3/4] border-2 border-gold/50 bg-maroon shadow-lift"><ProductImage src={photo} alt="A bowl of black raisins on a wooden board" sizes="(min-width: 1024px) 28rem, 90vw" /></div>
          <div className="absolute -bottom-6 -right-2 rounded-full bg-ivory p-1.5 shadow-lift ring-1 ring-gold/40 sm:-right-8"><Seal size={96} /></div>
        </Reveal>
        <div className="space-y-6 text-lg leading-relaxed text-espresso/80">
          <Reveal><p className="font-display text-3xl leading-snug text-maroon">Three generations. One counter that became a name Agra trusts.</p></Reveal>
          <Reveal delay={0.05}><p>Govind Pansari has been part of Agra’s everyday life since 1950 — three generations of the same family, still picking every batch of dry fruits and grinding every spice the way it was done when the shop first opened.</p></Reveal>
          <Reveal delay={0.1}><p>What started as a single counter has grown into a trusted name across the city, but the promise hasn’t changed: real quality, fair prices, and the kind of care you’d expect from a shopkeeper who knows your family by name.</p></Reveal>
          <Reveal delay={0.15}><p>This website brings that same shop — and that same trust — to your screen, with the same products and the same people, delivered to your door.</p></Reveal>
        </div>
      </section>

      <section className="bg-sand py-16 sm:py-24" aria-labelledby="offer-title">
        <div className="container-x">
          <Reveal><SectionHeading eyebrow="What we offer" title={<span id="offer-title">From the shelves of the shop</span>} /></Reveal>
          <ul className="mt-12 grid gap-5 md:grid-cols-3">
            {OFFERINGS.map((o, i) => (
              <li key={o.title}>
                <Reveal delay={i * 0.08} className="h-full">
                  <div className="h-full rounded-3xl bg-ivory p-7 shadow-soft">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-maroon-tint text-maroon"><o.icon size={26} aria-hidden /></span>
                    <h3 className="mt-5 font-display text-2xl font-semibold text-maroon">{o.title}</h3>
                    <p className="mt-2 text-taupe">{o.text}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-pad container-x" aria-labelledby="shops-title">
        <Reveal><SectionHeading eyebrow="Visit us" title={<span id="shops-title">Our shops in Agra</span>} intro="Your order is packed at the nearest of these shops that has everything in it." /></Reveal>
        <ul className="mt-10 grid gap-5 md:grid-cols-2">
          {stores.map((s) => (
            <li key={s.id} className="flex gap-4 rounded-3xl border border-line-strong bg-paper p-6">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-maroon-tint text-maroon"><MapPin size={22} aria-hidden /></span>
              <div>
                <h3 className="font-display text-xl font-semibold text-maroon">{s.name}</h3>
                <p className="text-taupe">{s.area}</p>
                <p className="mt-1 text-sm font-semibold text-espresso">Open {clockLabel(s.opensAt)} to {clockLabel(s.closesAt)}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link href="/shop" className="btn btn-primary">Shop now</Link>
          <p className="flex items-center gap-2 text-sm text-taupe"><Users size={17} aria-hidden /> Questions? <Link href="/contact" className="font-semibold text-maroon underline">Get in touch</Link></p>
        </div>
      </section>
    </>
  );
}
