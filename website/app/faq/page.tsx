import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/seo/JsonLd';
import { PageHeader } from '@/components/ui/PageHeader';
import { clockLabel, getDeliveryTerms, getStores } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';

export const metadata: Metadata = { title: 'FAQs', description: 'Answers about delivery, payment, returns and ordering from Govind Pansari.', alternates: { canonical: '/faq' } };
export const revalidate = 60;

// Answers that quote a number (delivery time, charge, minimum) read it from the live delivery settings. Plain text only, so the same words
// can feed the page and its structured data.
export default async function FaqPage() {
  const [terms, stores] = await Promise.all([getDeliveryTerms(), getStores()]);
  const open = stores.find((s) => s.acceptingOrders);

  const faqs: { q: string; a: string }[] = [
    {
      q: 'Where do you deliver, and how long does it take?',
      a: `We deliver across Agra from our ${stores.length > 1 ? 'shops' : 'shop'}${terms?.radiusKm ? `, to addresses within ${terms.radiusKm} km of a shop that can fulfil your order` : ''}. ${terms ? `Orders are usually delivered in about ${terms.minutes} minutes` : 'Delivery times are shown at checkout'}${open ? `, between ${clockLabel(open.opensAt)} and ${clockLabel(open.closesAt)}` : ''}. This is an estimate, not a guarantee.`,
    },
    {
      q: 'What does delivery cost?',
      a: terms ? `Delivery is ${terms.feeMin === terms.feeMax ? formatINR(terms.feeMin) : `${formatINR(terms.feeMin)} to ${formatINR(terms.feeMax)}`}${terms.freeDeliveryAbove !== null ? ` and free on orders of ${formatINR(terms.freeDeliveryAbove)} or more` : ''}. The minimum order is ${formatINR(terms.minimumOrder)}.` : 'Delivery charges and the minimum order value are shown in your cart and at checkout before you pay.',
    },
    { q: 'How can I pay?', a: 'You can pay online by UPI, credit or debit card, net banking or wallet — processed securely by Razorpay — or choose cash on delivery. An online order is confirmed only after your payment is verified.' },
    { q: 'Can I cancel an order?', a: 'Yes, free of charge, any time before the store starts packing it: open the order in My orders and choose Cancel order. After packing has started, please contact us.' },
    { q: 'What is your return policy?', a: 'We accept returns within 7 days for unopened, unused products. If something arrives damaged, spoiled or different from what you ordered, contact us with photos and we will arrange a replacement or refund.' },
    { q: 'Can I use a coupon code?', a: 'Promo codes are not available yet. Your cart and checkout always show the exact amount you will pay, including delivery.' },
    { q: 'What if an item is out of stock?', a: 'Checkout tells you before you pay, and shows which items need to change. We never substitute an item without asking.' },
    { q: 'Do you split an order between shops?', a: 'No. Your whole order is packed at the nearest shop that has every item in it.' },
    { q: 'How do I track my order?', a: 'Open My orders after signing in. Every step — confirmed, packing, out for delivery, delivered — is shown, and the page updates by itself.' },
  ];

  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }} />
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'FAQs' }]} title="Frequently asked questions" />
      <div className="container-x max-w-4xl py-12 sm:py-16">
        <ul className="divide-y divide-line rounded-3xl border border-line-strong bg-paper">
          {faqs.map((f, i) => (
            <li key={f.q}>
              <details className="group px-6 py-5" {...(i === 0 ? { open: true } : {})}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-xl font-semibold text-maroon">
                  {f.q}
                  <ChevronDown size={22} className="shrink-0 transition group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 leading-relaxed text-espresso/80">{f.a}</p>
              </details>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-taupe">Didn’t find your answer? <Link href="/contact" className="font-semibold text-maroon underline">Contact us</Link>.</p>
      </div>
    </>
  );
}
