import { Mail, MapPin, MessageCircle, Package, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { clockLabel, getStores } from '@/lib/data/storefront';
import { contactInfo, dialable } from '@/lib/site';

export const metadata: Metadata = { title: 'Contact us', description: 'Visit, call or message Govind Pansari in Agra.', alternates: { canonical: '/contact' } };
export const revalidate = 300;

// Phone, email and WhatsApp appear ONLY when the owner has put real ones in the website's settings. The numbers inside the mobile app are
// placeholders, so they are deliberately not reused here.
export default async function ContactPage() {
  const contact = contactInfo();
  const stores = await getStores().catch(() => []);
  const channels = [
    contact.phone && { icon: Phone, title: 'Call us', text: contact.phone, href: `tel:${dialable(contact.phone)}` },
    contact.whatsapp && { icon: MessageCircle, title: 'WhatsApp', text: contact.whatsapp, href: `https://wa.me/${dialable(contact.whatsapp).replace('+', '')}` },
    contact.email && { icon: Mail, title: 'Email', text: contact.email, href: `mailto:${contact.email}` },
  ].filter((c): c is { icon: typeof Phone; title: string; text: string; href: string } => !!c);

  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Contact' }]} title="We’d love to hear from you" intro="Questions about an order, a product or a gift box? Reach the shop directly." />
      <div className="container-x grid gap-12 py-12 sm:py-16 lg:grid-cols-2">
        <section aria-labelledby="reach">
          <h2 id="reach" className="font-display text-3xl font-semibold text-maroon">Get in touch</h2>
          {channels.length > 0 ? (
            <ul className="mt-6 space-y-4">
              {channels.map((c) => (
                <li key={c.title}>
                  <a href={c.href} className="flex items-center gap-4 rounded-2xl border border-line-strong bg-paper p-5 transition hover:shadow-soft" {...(c.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-maroon-tint text-maroon"><c.icon size={22} aria-hidden /></span>
                    <span><span className="block text-xs font-bold uppercase tracking-wider text-taupe">{c.title}</span><span className="block font-display text-xl font-semibold text-espresso">{c.text}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-2xl bg-sand p-6 text-taupe">The quickest way to reach us is to visit one of our shops, or to open your order under <Link href="/account/orders" className="font-semibold text-maroon underline">My orders</Link> for its latest status.</p>
          )}
          <p className="mt-6 flex gap-3 text-sm text-taupe"><Package size={18} className="mt-0.5 shrink-0 text-maroon" aria-hidden /> Have an order number? Please keep it ready — it helps us find your order at once.</p>
          <p className="mt-4 text-sm text-taupe">See also <Link href="/faq" className="font-semibold text-maroon underline">FAQs</Link>, <Link href="/shipping" className="font-semibold text-maroon underline">Shipping & delivery</Link> and <Link href="/refunds" className="font-semibold text-maroon underline">Cancellation & refund</Link>.</p>
        </section>

        <section aria-labelledby="visit">
          <h2 id="visit" className="font-display text-3xl font-semibold text-maroon">Visit us</h2>
          <ul className="mt-6 space-y-4">
            {stores.map((s) => (
              <li key={s.id} className="flex gap-4 rounded-2xl border border-line-strong bg-paper p-5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-maroon-tint text-maroon"><MapPin size={22} aria-hidden /></span>
                <div>
                  <h3 className="font-display text-xl font-semibold text-maroon">{s.name}</h3>
                  <p className="text-taupe">{s.area}</p>
                  <p className="mt-1 text-sm font-semibold text-espresso">Open {clockLabel(s.opensAt)} to {clockLabel(s.closesAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
