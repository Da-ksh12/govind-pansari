import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { siteUrl } from '@/lib/env';
import { BRAND } from '@/lib/site';

// The same two typefaces as the mobile app: Playfair Display for headings, Plus Jakarta Sans for everything else.
const display = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap', style: ['normal', 'italic'] });
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  // the picture shown when a link to any page is shared (WhatsApp, Facebook, Google...); pages with their own picture (products) override it
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    locale: 'en_IN',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    images: [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: `${BRAND.name} — Dry Fruits & Spices` }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og-image.png'] },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#6e1423',
  width: 'device-width',
  initialScale: 1,
};

// Switches the welcome splash on for the first page of a visit only, and never for people who prefer reduced motion. Runs before first paint.
// The app-download page (/app) has no splash and no shop chrome, so it is left alone.
const splashScript = `try{if(location.pathname.replace(/\\/$/,'')!=='/app'&&!sessionStorage.getItem('gp.splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('data-splash','on')}}catch(e){}`;

// The shop's header, footer, cart and accounts live in app/(site)/layout.tsx; the app-download page (app/app) has its own light page.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
