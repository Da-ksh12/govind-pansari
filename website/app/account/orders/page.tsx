import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LiveRefresh } from '@/components/account/LiveRefresh';
import { OrderCard } from '@/components/account/OrderCard';
import { listMyOrders } from '@/lib/orders/data';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'My orders' };

export default async function OrdersPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account/orders');
  const orders = await listMyOrders(supabase).catch(() => null);

  return (
    <div>
      <LiveRefresh table="orders" filter={`user_id=eq.${auth.user.id}`} />
      <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">My orders</h1>
      <p className="mt-2 text-taupe">Status updates appear here by themselves — no need to refresh.</p>
      {orders === null ? (
        <p role="alert" className="mt-8 rounded-2xl bg-terracotta-tint p-5 text-sm font-semibold text-danger">We couldn’t load your orders just now. Please refresh the page in a moment.</p>
      ) : orders.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-line-strong p-12 text-center">
          <p className="font-display text-2xl text-maroon">No orders yet</p>
          <p className="mt-2 text-taupe">When you place an order you can follow it here, step by step.</p>
          <Link href="/shop" className="btn btn-primary mt-6">Start shopping</Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">{orders.map((o) => <li key={o.id}><OrderCard order={o} /></li>)}</ul>
      )}
    </div>
  );
}
