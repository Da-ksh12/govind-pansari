import { Gift, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { getDeliveryTerms, getOffers } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';

export const metadata: Metadata = { title: 'Offers', description: 'Current savings and delivery offers from Govind Pansari.', alternates: { canonical: '/offers' } };
export const revalidate = 60;

// Only offers that are real today: the free-delivery line is the delivery setting itself, and the featured offers are the ones the owner has
// switched on under Banners & Offers. Coupon codes are not offered anywhere because the checkout does not apply them. Savings against MRP are
// shown on each product card; they are not promoted here, because they are only as good as the MRPs entered in the catalogue.
export default async function OffersPage() {
  const [terms, offers] = await Promise.all([getDeliveryTerms(), getOffers().catch(() => [])]);

  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Offers' }]} eyebrow="Savings" title="Offers" intro="What’s genuinely on offer right now — no codes, no small print." />
      <div className="container-x space-y-16 py-12 sm:py-16">
        <ul className="grid gap-5 md:grid-cols-2">
          {terms?.freeDeliveryAbove != null && (
            <li className="flex gap-5 rounded-3xl bg-maroon p-7 text-ivory">
              <Truck size={34} className="shrink-0 text-gold" aria-hidden />
              <div><h2 className="font-display text-2xl font-semibold">Free delivery above {formatINR(terms.freeDeliveryAbove)}</h2><p className="mt-1 text-ivory/80">Otherwise delivery is {terms.feeMin === terms.feeMax ? formatINR(terms.feeMin) : `${formatINR(terms.feeMin)}–${formatINR(terms.feeMax)}`}. Minimum order {formatINR(terms.minimumOrder)}.</p></div>
            </li>
          )}
          <li className="flex gap-5 rounded-3xl bg-sand p-7">
            <Gift size={34} className="shrink-0 text-gold-dark" aria-hidden />
            <div><h2 className="font-display text-2xl font-semibold text-maroon">Gift hampers</h2><p className="mt-1 text-taupe">Boxes and packs ready to give. <Link href="/gift-hampers" className="font-semibold text-maroon underline">See the hampers</Link></p></div>
          </li>
        </ul>

        {offers.length > 0 && (
          <section aria-labelledby="featured-offers">
            <SectionHeading eyebrow="From the shop" title={<span id="featured-offers">Featured offers</span>} />
            <ul className="mt-8 grid gap-5 md:grid-cols-2">
              {offers.map((o) => (
                <li key={o.id} className="relative isolate flex min-h-52 items-end overflow-hidden rounded-3xl bg-maroon">
                  <Image src={o.imageUrl} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="-z-10 object-cover" />
                  <span className="absolute inset-0 -z-10 bg-gradient-to-t from-maroon-darker/90 via-maroon-darker/40 to-transparent" aria-hidden />
                  <div className="p-6 text-ivory"><h3 className="font-display text-2xl font-semibold">{o.title}</h3>{o.subtitle && <p className="mt-1 text-ivory/80">{o.subtitle}</p>}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="more" className="rounded-3xl bg-sand p-8 text-center sm:p-12">
          <h2 id="more" className="font-display text-3xl font-semibold text-maroon">Looking for something specific?</h2>
          <p className="mx-auto mt-2 max-w-xl text-taupe">Every price on the website is the price you pay, and each pack shows how far it is below its printed MRP.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/bestsellers" className="btn btn-primary">See bestsellers</Link>
            <Link href="/shop" className="btn btn-ghost">Browse everything</Link>
          </div>
        </section>
      </div>
    </>
  );
}
