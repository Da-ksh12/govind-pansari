'use client';

import { Heart, Menu, Package, Phone, Search, ShoppingBag, User, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { NAV } from '@/lib/site';
import { useDialog } from '@/lib/hooks/useDialog';
import { Wordmark } from '../brand/Logo';
import { useAuth } from '../providers/AuthProvider';
import { useCart } from '../providers/CartProvider';
import { SearchOverlay } from './SearchOverlay';

export function Header({ supportPhone }: { supportPhone: string | null }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const cart = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menu = useDialog(menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // a new page closes whatever was open
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setMenuOpen(false);
    setSearchOpen(false);
  }

  // "/" opens search, like most shops, unless the person is typing in a field
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const typing = el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const iconButton = 'relative grid h-11 w-11 place-items-center rounded-full text-maroon transition hover:bg-maroon/10 active:scale-90';

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:px-5 sm:pt-4">
        <div
          className={`flex w-full max-w-6xl items-center justify-between gap-2 rounded-full border px-3 py-2 backdrop-blur-xl transition-all duration-500 ease-[var(--ease-premium)] sm:px-5 ${
            scrolled ? 'border-line-strong bg-ivory/95 shadow-pill' : 'border-white/60 bg-ivory/90'
          }`}
        >
          <Link href="/" className="shrink-0 rounded-full">
            <Wordmark compact={scrolled} />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${active(item.href) ? 'bg-maroon text-ivory' : 'text-espresso hover:bg-maroon/10 hover:text-maroon'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center">
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search products" className={iconButton}>
              <Search size={20} aria-hidden />
            </button>
            <Link href="/account/wishlist" aria-label="Wishlist" className={`${iconButton} hidden sm:grid`}>
              <Heart size={20} aria-hidden />
            </Link>
            <Link href={user ? '/account' : '/login'} aria-label={user ? 'My account' : 'Sign in'} className={`${iconButton} hidden sm:grid`}>
              <User size={20} aria-hidden />
            </Link>
            <button type="button" onClick={cart.openDrawer} aria-label={`Open cart, ${cart.count} ${cart.count === 1 ? 'item' : 'items'}`} className={iconButton} data-cart-target>
              <ShoppingBag size={20} aria-hidden />
              <AnimatePresence>
                {cart.count > 0 && (
                  <motion.span
                    key={cart.count}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[0.68rem] font-extrabold leading-5 text-maroon-darker"
                    aria-hidden
                  >
                    {cart.count > 99 ? '99+' : cart.count}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} className={`${iconButton} lg:hidden`}>
              <Menu size={22} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="fixed inset-0 z-[70] bg-maroon-darker/60 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setMenuOpen(false)}
          >
            <motion.div
              ref={menu}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              tabIndex={-1}
              className="flex h-full w-[min(22rem,88vw)] flex-col bg-ivory p-6 shadow-lift"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-6 flex items-center justify-between">
                <Wordmark />
                <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-full p-2 text-taupe hover:bg-sand">
                  <X size={22} aria-hidden />
                </button>
              </div>
              <nav aria-label="Menu" className="flex flex-col">
                {[{ href: '/', label: 'Home' }, ...NAV, { href: '/bestsellers', label: 'Bestsellers' }].map((item) => (
                  <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className="border-b border-line py-3.5 font-display text-2xl text-espresso aria-[current=page]:text-maroon">
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto space-y-1 pt-6 text-sm font-semibold text-maroon">
                <Link href={user ? '/account' : '/login'} className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><User size={18} aria-hidden /> {user ? 'My account' : 'Sign in / Register'}</Link>
                <Link href="/account/orders" className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><Package size={18} aria-hidden /> Track an order</Link>
                <Link href="/account/wishlist" className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><Heart size={18} aria-hidden /> Wishlist</Link>
                {supportPhone && <a href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><Phone size={18} aria-hidden /> {supportPhone}</a>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
