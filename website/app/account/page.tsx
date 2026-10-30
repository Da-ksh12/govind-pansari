import { ArrowRight, Heart, MapPin, Package } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OrderCard } from '@/components/account/OrderCard';
import { listMyOrders } from '@/lib/orders/data';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account');

  const [{ data: profile }, orders, addresses] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', auth.user.id).maybeSingle(),
    listMyOrders(supabase).catch(() => null),
    supabase.from('addresses').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id),
  ]);
  if (!profile?.full_name?.trim()) redirect('/account/profile');
  const first = profile.full_name.trim().split(/\s+/)[0];

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">My account</p>
        <h1 className="mt-2 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold leading-tight text-maroon">Namaste, {first}.</h1>
        <p className="mt-2 text-taupe">{auth.user.phone ? `+${auth.user.phone}` : profile.email}</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-3">
        {[
          { href: '/account/orders', icon: Package, title: 'My orders', text: orders ? `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}` : 'View your orders' },
          { href: '/account/addresses', icon: MapPin, title: 'Addresses', text: `${addresses.count ?? 0} saved` },
          { href: '/account/wishlist', icon: Heart, title: 'Wishlist', text: 'Things you like' },
        ].map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="group flex h-full items-center gap-4 rounded-2xl border border-line-strong bg-paper p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-maroon-tint text-maroon"><c.icon size={22} aria-hidden /></span>
              <span><span className="block font-display text-lg font-semibold text-espresso">{c.title}</span><span className="text-sm text-taupe">{c.text}</span></span>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="recent">
        <div className="flex items-end justify-between">
          <h2 id="recent" className="font-display text-2xl font-semibold text-maroon">Recent orders</h2>
          <Link href="/account/orders" className="flex items-center gap-1.5 text-sm font-bold text-maroon">All orders <ArrowRight size={15} aria-hidden /></Link>
        </div>
        {orders === null ? (
          <p className="mt-5 rounded-2xl bg-sand p-5 text-sm text-taupe">We couldn’t load your orders just now. Please refresh in a moment.</p>
        ) : orders.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-line-strong p-8 text-center">
            <p className="font-display text-xl text-maroon">No orders yet</p>
            <p className="mt-1 text-sm text-taupe">Your first order will show up here with live tracking.</p>
            <Link href="/shop" className="btn btn-primary mt-5">Start shopping</Link>
          </div>
        ) : (
          <ul className="mt-5 space-y-4">{orders.slice(0, 3).map((o) => <li key={o.id}><OrderCard order={o} /></li>)}</ul>
        )}
      </section>
    </div>
  );
}
