import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/content/LegalPage';
import { getDeliveryTerms } from '@/lib/data/storefront';
import { contactInfo } from '@/lib/site';

export const metadata: Metadata = { title: 'Terms of Service', description: 'The terms that apply when you shop with Govind Pansari.', alternates: { canonical: '/terms' } };
export const revalidate = 300;

export default async function TermsPage() {
  const terms = await getDeliveryTerms();
  const contact = contactInfo();
  const sections: LegalSection[] = [
    { title: '1. Agreement', body: <p>By creating an account or placing an order with Govind Pansari, you agree to these terms. If you don’t agree, please don’t use the website or app.</p> },
    { title: '2. Who can order', body: <p>You must be able to enter a legally binding contract under Indian law to place an order. Orders are delivered only to addresses within our current delivery area in Agra — the website will tell you if an address isn’t serviceable.</p> },
    { title: '3. Products, pricing & availability', body: <p>We aim to keep product listings, prices, weights and photos accurate, but occasional errors can happen. If a product is out of stock or a price was listed incorrectly, we’ll tell you before the order is confirmed rather than silently substitute or overcharge. The total shown at checkout is the amount you pay.</p> },
    { title: '4. Orders & payment', body: <p>An order is confirmed once the store accepts it, not just once you press “Place order”. You can pay online (UPI, cards, net banking or wallets — processed securely by Razorpay, a licensed payment gateway) or choose cash on delivery. An online order is confirmed only after the payment has been verified.</p> },
    {
      title: '5. Delivery',
      body: (
        <p>
          Delivery times shown{terms ? ` (about ${terms.minutes} minutes within our delivery area)` : ''} are estimates, not guarantees — traffic, weather and order volume can affect them. You’re responsible for giving an accurate delivery address and being reachable on the number on the order. If a delivery genuinely can’t be completed after reasonable attempts, we’ll contact you to resolve it. See <Link href="/shipping" className="font-semibold text-maroon underline">Shipping & delivery</Link> for charges and areas.
        </p>
      ),
    },
    { title: '6. Cancellations', body: <p>You can cancel an order yourself, free of charge, any time before the store starts packing it, from the order’s details page. Once packing has started, online cancellation isn’t available — contact us and we’ll do our best to help. See <Link href="/refunds" className="font-semibold text-maroon underline">Cancellation & refund</Link>.</p> },
    { title: '7. Returns & refunds', body: <p>We accept returns within 7 days for unopened, unused products. If an item arrives damaged, spoiled or different from what you ordered, contact us with photos and we’ll arrange a replacement or refund. Details are on the <Link href="/refunds" className="font-semibold text-maroon underline">Cancellation & refund</Link> page.</p> },
    { title: '8. Your conduct', body: <p>Please don’t place fraudulent orders, provide false delivery details, or be abusive toward our store or delivery staff — we reserve the right to refuse service or cancel orders in cases of genuine misuse.</p> },
    { title: '9. Reviews', body: <p>You may leave a rating and review for products from orders you’ve actually received. Reviews should be honest and relevant to the product — we may remove reviews that are abusive, fake, or unrelated to the product.</p> },
    { title: '10. Limitation of liability', body: <p>We work to fulfil every order accurately and on time, but to the extent permitted by law, our liability for any issue with an order is limited to the value of that order (replacement, refund, or store credit) rather than any indirect or consequential loss.</p> },
    { title: '11. Changes to these terms', body: <p>We may update these terms as the business changes. Continuing to use the website or app after an update means you accept the revised terms.</p> },
    {
      title: '12. Contact us',
      body: <p>Questions about these terms? {contact.phone ? <>Call us on <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="font-semibold text-maroon underline">{contact.phone}</a> or </> : null}{contact.email ? <>write to <a href={`mailto:${contact.email}`} className="font-semibold text-maroon underline">{contact.email}</a> or </> : null}visit our <Link href="/contact" className="font-semibold text-maroon underline">Contact</Link> page.</p>,
    },
  ];
  return <LegalPage trail="Terms of Service" title="Terms of Service" updated="October 2026" sections={sections} />;
}
