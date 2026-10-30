import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '../brand/Logo';
import { FacebookIcon, InstagramIcon } from '../brand/Social';
import { getStores, clockLabel } from '@/lib/data/storefront';
import { BRAND, FOOTER_LINKS, contactInfo, dialable } from '@/lib/site';

function Column({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="eyebrow !text-gold">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-ivory/80 transition hover:text-gold">{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function Footer() {
  const contact = contactInfo();
  const stores = await getStores().catch(() => []);
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 bg-maroon-darker text-ivory">
      <div className="rule-gold" />
      <div className="container-x grid gap-12 py-16 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <Link href="/" className="inline-block"><Wordmark light /></Link>
          <p className="max-w-sm text-sm leading-relaxed text-ivory/75">
            Premium dry fruits, spices and gifts from a family shop that has served Agra since {BRAND.since}. Packed fresh at our shops and delivered to your door.
          </p>
          {(contact.instagram || contact.facebook || contact.whatsapp) && (
            <ul className="flex gap-3" aria-label="Follow us">
              {contact.instagram && <li><a href={contact.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="grid h-10 w-10 place-items-center rounded-full border border-ivory/25 hover:border-gold hover:text-gold"><InstagramIcon /></a></li>}
              {contact.facebook && <li><a href={contact.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="grid h-10 w-10 place-items-center rounded-full border border-ivory/25 hover:border-gold hover:text-gold"><FacebookIcon /></a></li>}
              {contact.whatsapp && <li><a href={`https://wa.me/${dialable(contact.whatsapp).replace('+', '')}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="grid h-10 w-10 place-items-center rounded-full border border-ivory/25 hover:border-gold hover:text-gold"><MessageCircle size={18} aria-hidden /></a></li>}
            </ul>
          )}
        </div>
        <Column title="Shop" links={FOOTER_LINKS.shop} />
        <Column title="Help" links={FOOTER_LINKS.help} />
        <div className="space-y-8">
          <Column title="Company" links={FOOTER_LINKS.company} />
        </div>
      </div>

      <div className="border-t border-ivory/10">
        <div className="container-x grid gap-8 py-10 md:grid-cols-2">
          <div>
            <h2 className="eyebrow !text-gold">Our shops in Agra</h2>
            {stores.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {stores.map((s) => (
                  <li key={s.id} className="flex gap-3 text-sm text-ivory/80">
                    <MapPin size={17} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                    <span><strong className="font-semibold text-ivory">{s.name}</strong> — {s.area}. Open {clockLabel(s.opensAt)} to {clockLabel(s.closesAt)}.</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ivory/70">Agra, Uttar Pradesh.</p>
            )}
          </div>
          {(contact.phone || contact.email) && (
            <div>
              <h2 className="eyebrow !text-gold">Talk to us</h2>
              <ul className="mt-4 space-y-3 text-sm text-ivory/80">
                {contact.phone && <li className="flex items-center gap-3"><Phone size={17} className="text-gold" aria-hidden /><a href={`tel:${dialable(contact.phone)}`} className="hover:text-gold">{contact.phone}</a></li>}
                {contact.email && <li className="flex items-center gap-3"><Mail size={17} className="text-gold" aria-hidden /><a href={`mailto:${contact.email}`} className="hover:text-gold">{contact.email}</a></li>}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-ivory/10">
        <div className="container-x flex flex-col items-center justify-between gap-2 py-6 text-xs text-ivory/60 sm:flex-row">
          <p>© {year} {BRAND.name}, {BRAND.city}. All rights reserved.</p>
          <p>Secure online payments are processed by Razorpay.</p>
        </div>
      </div>
    </footer>
  );
}
