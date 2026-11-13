import type { ReactNode } from 'react';
import { CartDrawer } from '@/components/layout/CartDrawer';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { CartProvider } from '@/components/providers/CartProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { WishlistProvider } from '@/components/providers/WishlistProvider';
import { contactInfo } from '@/lib/site';

// Everything that makes the online shop a shop: welcome splash, header, cart, wishlist, sign-in state and footer. The URLs are unchanged: a
// folder in parentheses only groups pages, it is not part of the address.
export default function SiteLayout({ children }: { children: ReactNode }) {
  const contact = contactInfo();
  return (
    <>
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
    </>
  );
}
