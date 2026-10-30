import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { CartDrawer } from '@/components/layout/CartDrawer';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { CartProvider } from '@/components/providers/CartProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { WishlistProvider } from '@/components/providers/WishlistProvider';
import { siteUrl } from '@/lib/env';
import { BRAND, contactInfo } from '@/lib/site';

// The same two typefaces as the mobile app: Playfair Display for headings, Plus Jakarta Sans for everything else.
const display = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap', style: ['normal', 'italic'] });
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: { type: 'website', siteName: BRAND.name, locale: 'en_IN', title: `${BRAND.name} — ${BRAND.tagline}`, description: BRAND.description },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#6e1423',
  width: 'device-width',
  initialScale: 1,
};

// Switches the welcome splash on for the first page of a visit only, and never for people who prefer reduced motion. Runs before first paint.
const splashScript = `try{if(!sessionStorage.getItem('gp.splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('data-splash','on')}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const contact = contactInfo();
  return (
    <html lang="en-IN" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashScript }} />
      </head>
      <body className="min-h-dvh">
        <SplashScreen />
        <RouteProgress />
        <a href="#main" className="fixed left-4 top-4 z-[110] -translate-y-24 rounded-full bg-maroon px-5 py-3 text-sm font-bold text-ivory focus:translate-y-0">
          Skip to content
        </a>
        <ToastProvider>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <Header supportPhone={contact.phone} />
                <main id="main" tabIndex={-1} className="outline-none">{children}</main>
                <Footer />
                <CartDrawer />
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
