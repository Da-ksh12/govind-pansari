import { siteUrl } from './env';

// Facts about the business that appear on more than one page. Contact details come from the environment (website/.env.local) and are shown
// ONLY when the owner has filled them in: the numbers inside the mobile app are placeholders, and publishing a placeholder number as if it
// were a customer-care line would send real customers to a stranger.

export const BRAND = {
  name: 'Govind Pansari',
  tagline: 'A Finer Taste of Nature.',
  since: 1950,
  city: 'Agra',
  description: 'Premium dry fruits, spices, tea and gift hampers from Govind Pansari, Agra — serving the city since 1950. Order online for delivery from our shops.',
} as const;

export interface ContactInfo {
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
}

const clean = (value: string | undefined): string | null => {
  const v = value?.trim();
  return v ? v : null;
};

/** Phone numbers are shown as typed by the owner but dialled/linked as digits with an optional leading +. */
export const dialable = (phone: string): string => phone.replace(/[^\d+]/g, '');

export function contactInfo(): ContactInfo {
  const https = (v: string | null) => (v && /^https:\/\//i.test(v) ? v : null);
  return {
    phone: clean(process.env.NEXT_PUBLIC_SUPPORT_PHONE),
    email: clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
    whatsapp: clean(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER),
    instagram: https(clean(process.env.NEXT_PUBLIC_INSTAGRAM_URL)),
    facebook: https(clean(process.env.NEXT_PUBLIC_FACEBOOK_URL)),
  };
}

export const NAV = [
  { href: '/shop', label: 'Shop' },
  { href: '/collections', label: 'Collections' },
  { href: '/gift-hampers', label: 'Gift Hampers' },
  { href: '/offers', label: 'Offers' },
  { href: '/about', label: 'Our Story' },
] as const;

export const FOOTER_LINKS = {
  shop: [
    { href: '/shop', label: 'All products' },
    { href: '/bestsellers', label: 'Bestsellers' },
    { href: '/collections', label: 'Collections' },
    { href: '/gift-hampers', label: 'Gift hampers' },
    { href: '/offers', label: 'Offers' },
  ],
  help: [
    { href: '/contact', label: 'Contact us' },
    { href: '/faq', label: 'FAQs' },
    { href: '/shipping', label: 'Shipping & delivery' },
    { href: '/refunds', label: 'Cancellation & refund' },
    { href: '/account/orders', label: 'Track an order' },
  ],
  company: [
    { href: '/about', label: 'Our story' },
    { href: '/privacy', label: 'Privacy policy' },
    { href: '/terms', label: 'Terms of service' },
  ],
} as const;

export const absoluteUrl = (path = '/'): string => `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
