import { MapPin, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import type { DeliveryTerms } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';
import { Reveal } from '../ui/Reveal';

/**
 * Only things that are true and checkable: the shop's history (from the owner's About text) and the delivery terms read live from the
 * delivery settings. No certifications, awards or review counts are claimed — none have been supplied.
 */
export function TrustStrip({ terms, shops }: { terms: DeliveryTerms | null; shops: number }) {
  const items = [
    { icon: ShieldCheck, title: 'Since 1950', text: 'Three generations of the same family, still choosing every batch.' },
    { icon: MapPin, title: shops > 1 ? `${shops} shops in Agra` : 'Made in Agra', text: 'Your order is packed at the nearest shop that has everything in it.' },
    {
      icon: Truck,
      title: terms?.freeDeliveryAbove ? `Free delivery above ${formatINR(terms.freeDeliveryAbove)}` : 'Delivered to your door',
      text: terms ? `Delivery from ${formatINR(terms.feeMin)}${terms.feeMax !== terms.feeMin ? ` to ${formatINR(terms.feeMax)}` : ''} on smaller orders. Minimum order ${formatINR(terms.minimumOrder)}.` : 'Delivery within our service area in Agra.',
    },
    { icon: PackageCheck, title: 'Secure payment', text: 'Pay by UPI, card, net banking or wallet through Razorpay — or in cash on delivery.' },
  ];
  return (
    <section className="container-x pb-4" aria-label="Why shop with us">
      <ul className="grid gap-px overflow-hidden rounded-3xl border border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <li key={item.title} className="bg-ivory p-7">
            <Reveal delay={i * 0.07}>
              <item.icon size={26} className="text-gold-dark" strokeWidth={1.6} aria-hidden />
              <h3 className="mt-4 font-display text-xl font-semibold text-maroon">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-taupe">{item.text}</p>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
