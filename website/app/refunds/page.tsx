import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/content/LegalPage';
import { contactInfo } from '@/lib/site';

export const metadata: Metadata = { title: 'Cancellation & Refund Policy', description: 'How to cancel a Govind Pansari order, and how returns and refunds work.', alternates: { canonical: '/refunds' } };

export default function RefundsPage() {
  const contact = contactInfo();
  const sections: LegalSection[] = [
    { title: 'Cancelling an order', body: <p>You can cancel an order yourself, free of charge, any time before the store starts packing it. Open the order in <Link href="/account/orders" className="font-semibold text-maroon underline">My orders</Link> and choose “Cancel order”. Once packing has started, the button is no longer shown — please contact us and we will do our best to help.</p> },
    { title: 'Returns', body: <p>We accept returns within 7 days for unopened, unused products. Contact us to start a return.</p> },
    { title: 'Damaged, spoiled or wrong items', body: <p>If an item arrives damaged, spoiled or different from what you ordered, contact us with photos and your order number. We will arrange a replacement or a refund.</p> },
    {
      title: 'How refunds are paid',
      body: (
        <>
          <p><strong>Online payments</strong> (UPI, card, net banking, wallet) are refunded to the method you paid with. The time it takes to show in your account depends on your bank or wallet.</p>
          <p><strong>Cash on delivery</strong> orders have no online payment to reverse, so a refund is settled directly with you (for example against your next order, or by another way we agree with you).</p>
          <p>If a payment was deducted but the order was not confirmed, the amount is returned to you automatically.</p>
        </>
      ),
    },
    {
      title: 'Contact us',
      body: <p>{contact.phone ? <>Call <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="font-semibold text-maroon underline">{contact.phone}</a>, </> : null}{contact.email ? <>write to <a href={`mailto:${contact.email}`} className="font-semibold text-maroon underline">{contact.email}</a>, or </> : null}see our <Link href="/contact" className="font-semibold text-maroon underline">Contact</Link> page. Please have your order number ready.</p>,
    },
  ];
  return <LegalPage trail="Cancellation & Refund" title="Cancellation & Refund Policy" updated="October 2026" sections={sections} />;
}
