import Link from 'next/link';
import { Reveal } from '../ui/Reveal';
import { ProductImage } from '../ui/ProductImage';
import { Seal } from '../brand/Logo';
import { SectionHeading } from '../ui/SectionHeading';

/**
 * The brand story, in the owner's own words (taken from the About screen of the mobile app). The picture is a real product photograph from the
 * catalogue; photographs of the shop and the family belong here as soon as the owner supplies them.
 */
export function BrandStory({ image }: { image: string | null }) {
  return (
    <section className="section-pad relative overflow-hidden bg-sand" aria-labelledby="story-title">
      <div className="jaali pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="container-x relative grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative mx-auto w-full max-w-md">
          <div className="arch relative aspect-[3/4] border-2 border-gold/50 bg-maroon shadow-lift">
            <ProductImage src={image} alt="A selection from the Govind Pansari shelves" sizes="(min-width: 1024px) 28rem, 90vw" />
          </div>
          <div className="absolute -bottom-6 -right-2 rounded-full bg-ivory p-1.5 shadow-lift ring-1 ring-gold/40 sm:-right-8"><Seal size={96} /></div>
        </Reveal>

        <div>
          <Reveal>
            <SectionHeading eyebrow="Our story" title={<span id="story-title">Rooted in Agra. Inspired by a finer taste.</span>} />
          </Reveal>
          <Reveal delay={0.1} className="mt-8 space-y-5 text-lg leading-relaxed text-espresso/80">
            <p>
              Govind Pansari has been part of Agra’s everyday life since 1950 — three generations of the same family, still picking every batch of dry fruits and grinding every spice the way it was done when the shop first opened.
            </p>
            <p>
              What started as a single counter has grown into a trusted name across the city, but the promise hasn’t changed: real quality, fair prices, and the care you’d expect from a shopkeeper who knows your family by name.
            </p>
          </Reveal>
          <Reveal delay={0.2} className="mt-9">
            <Link href="/about" className="btn btn-primary">Read our story</Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
