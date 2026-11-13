import type { Metadata } from 'next';
import { CartView } from '@/components/cart/CartView';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDeliveryTerms } from '@/lib/data/storefront';

export const metadata: Metadata = { title: 'Your cart', robots: { index: false, follow: true }, alternates: { canonical: '/cart' } };
export const revalidate = 60;

export default async function CartPage() {
  const terms = await getDeliveryTerms();
  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Cart' }]} title="Your cart" />
      <div className="container-x py-10 sm:py-14">
        <CartView terms={terms} />
      </div>
    </>
  );
}
