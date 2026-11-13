import type { Metadata } from 'next';
import { AflixSection } from '@/components/app-landing/AflixSection';
import { AppFooter } from '@/components/app-landing/AppFooter';
import { Benefits } from '@/components/app-landing/Benefits';
import { Hero } from '@/components/app-landing/Hero';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-links';

const DESCRIPTION = 'Download the official Govind Pansari app for Android and iPhone: premium dry fruits and spices from Agra’s family shop, trusted since 1950, delivered to your door.';

export const metadata: Metadata = {
  title: { absolute: 'Download the Govind Pansari App — Your Favourite Store, Now in Your Pocket' },
  description: DESCRIPTION,
  alternates: { canonical: '/app' },
  openGraph: {
    type: 'website',
    url: '/app',
    siteName: 'Govind Pansari',
    locale: 'en_IN',
    title: 'The Govind Pansari App — Your Favourite Store. Now in Your Pocket.',
    description: DESCRIPTION,
    images: [{ url: '/app/og-app.jpg', width: 1200, height: 630, alt: 'Govind Pansari — Dry Fruits & Spices' }],
  },
  twitter: { card: 'summary_large_image', images: ['/app/og-app.jpg'] },
};

// A single light page: no shop header, cart or accounts (those belong to the shop pages, see app/(site)/layout.tsx).
export default function AppDownloadPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // only facts that are true and public: the app's name, its two stores and that it is free
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'MobileApplication',
            name: 'Govind Pansari',
            applicationCategory: 'ShoppingApplication',
            operatingSystem: 'Android, iOS',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
            installUrl: [PLAY_STORE_URL, APP_STORE_URL],
          }).replace(/</g, '\\u003c'),
        }}
      />
      <main>
        {/* one warm gradient runs behind the hero and the benefits card, as in the reference */}
        <div className="bg-[linear-gradient(180deg,#fbf3e6_0%,#f8e6cf_55%,#f4dcc2_100%)] pb-16">
          <Hero />
          <Benefits />
        </div>
        <AflixSection />
      </main>
      <AppFooter />
    </>
  );
}
