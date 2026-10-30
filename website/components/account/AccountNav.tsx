'use client';

import { Heart, LogOut, MapPin, Package, User, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../providers/AuthProvider';

const ITEMS = [
  { href: '/account', label: 'Overview', icon: UserCircle, exact: true },
  { href: '/account/orders', label: 'My orders', icon: Package },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/wishlist', label: 'Wishlist', icon: Heart },
  { href: '/account/profile', label: 'Profile', icon: User },
] as const;

export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <nav aria-label="Account" className="lg:sticky lg:top-28 lg:self-start">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {ITEMS.map((item) => {
          const active = 'exact' in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0">
              <Link href={item.href} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-bold transition lg:rounded-2xl ${active ? 'bg-maroon text-ivory' : 'text-espresso hover:bg-sand'}`}>
                <item.icon size={18} aria-hidden /> {item.label}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0 lg:mt-4 lg:border-t lg:border-line lg:pt-4">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace('/');
              router.refresh();
            }}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-bold text-danger transition hover:bg-terracotta-tint lg:rounded-2xl"
          >
            <LogOut size={18} aria-hidden /> Sign out
          </button>
        </li>
      </ul>
    </nav>
  );
}
