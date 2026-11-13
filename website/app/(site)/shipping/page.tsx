import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/content/LegalPage';
import { clockLabel, getDeliveryTerms, getStores } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';

export const metadata: Metadata = { title: 'Shipping & Delivery', description: 'Where Govind Pansari delivers, what delivery costs, how long it takes and how your order is packed.', alternates: { canonical: '/shipping' } };
export const revalidate = 60;

// Every number on this page is read from the live delivery settings (the ones the owner edits under Delivery & Pricing), so the page cannot drift
// out of date. If a number can't be read it is left out rather than guessed.
export default async function ShippingPage() {
  const [terms, stores] = await Promise.all([getDeliveryTerms(), getStores()]);
  const open = stores.filter((s) => s.acceptingOrders);
  const hours = open.length > 0 ? `${clockLabel(open[0]!.opensAt)} to ${clockLabel(open[0]!.closesAt)}` : null;

  const sections: LegalSection[] = [
    {
      title: 'Where we deliver',
      body: (
        <>
          <p>We deliver across Agra from our {stores.length > 1 ? `${stores.length} shops` : 'shop'}{stores.length > 0 ? ` (${stores.map((s) => s.name).join(' and ')})` : ''}.{terms?.radiusKm ? ` An address is deliverable when it is within ${terms.radiusKm} km of a shop that can fulfil your order.` : ''}</p>
          <p>Not sure about your address? Search your area on any product page, or while adding an address — the website checks it against our delivery area straight away.</p>
        </>
      ),
    },
    {
      title: 'Delivery charges',
      body: terms ? (
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Delivery charge: {terms.feeMin === terms.feeMax ? formatINR(terms.feeMin) : `${formatINR(terms.feeMin)} to ${formatINR(terms.feeMax)}`}.</li>
          {terms.freeDeliveryAbove !== null && <li>Delivery is free on orders of {formatINR(terms.freeDeliveryAbove)} or more.</li>}
          <li>Minimum order value: {formatINR(terms.minimumOrder)} (before delivery).</li>
        </ul>
      ) : <p>Delivery charges and the minimum order value are shown in your cart and at checkout before you pay.</p>,
    },
    {
      title: 'How long it takes',
      body: <p>{terms ? `Orders within our delivery area are usually delivered in about ${terms.minutes} minutes` : 'Delivery times are shown at checkout'}{hours ? `, between ${hours}` : ''}. This is an estimate — traffic, weather and order volume can affect it.</p>,
    },
    {
      title: 'How your order is packed',
      body: <p>Your whole order is packed at one shop: the nearest one that has every item in your cart in stock. We don’t split an order between shops. If no single shop can fulfil everything, checkout tells you which items to change.</p>,
    },
    {
      title: 'Tracking your order',
      body: <p>Follow every step — confirmed, packing, out for delivery, delivered — from <Link href="/account/orders" className="font-semibold text-maroon underline">My orders</Link>. The page updates by itself as the store and rider update your order.</p>,
    },
    {
      title: 'If something goes wrong',
      body: <p>If a delivery can’t be completed after reasonable attempts, we’ll contact you on the number on your order. If an item arrives damaged or isn’t what you ordered, see <Link href="/refunds" className="font-semibold text-maroon underline">Cancellation & refund</Link>.</p>,
    },
  ];
  return <LegalPage trail="Shipping & Delivery" title="Shipping & Delivery" updated="October 2026" sections={sections} />;
}
