import { CheckCircle2, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CancelOrder } from '@/components/account/CancelOrder';
import { LiveRefresh } from '@/components/account/LiveRefresh';
import { OrderTimeline, StatusChip } from '@/components/account/OrderParts';
import { formatDateTimeIST, formatINR } from '@/lib/format';
import { getMyOrder } from '@/lib/orders/data';
import { canCustomerCancel, paymentLabel } from '@/lib/orders/timeline';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Order details' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=/account/orders/${id}`);

  // row-level security returns nothing for someone else's order, so a guessed id is simply "not found"
  const found = await getMyOrder(supabase, id).catch(() => undefined);
  if (found === undefined) {
    return <p role="alert" className="rounded-2xl bg-terracotta-tint p-5 text-sm font-semibold text-danger">We couldn’t load this order just now. Please refresh the page in a moment.</p>;
  }
  if (!found) notFound();
  const { order, history } = found;
  const justPlaced = (await searchParams).placed === '1';
  const paid = order.payment.status === 'paid';

  return (
    <div className="space-y-8">
      <LiveRefresh table="orders" filter={`id=eq.${order.id}`} />
      <nav aria-label="Breadcrumb"><Link href="/account/orders" className="text-sm font-bold text-maroon">← All orders</Link></nav>

      {justPlaced && (
        <div role="status" className="flex gap-4 rounded-3xl bg-forest-tint p-6 text-forest">
          <CheckCircle2 size={28} className="shrink-0" aria-hidden />
          <div>
            <h2 className="font-display text-2xl font-semibold">Thank you — your order is placed.</h2>
            <p className="mt-1 text-sm">{order.payment.method === 'cod' ? 'Please keep the amount ready for when it arrives.' : paid ? 'Your payment is confirmed.' : 'We are confirming your payment with the bank; this page updates by itself.'}</p>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Order</p>
          <h1 className="mt-1 font-display text-4xl font-semibold text-maroon">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-taupe">Placed {formatDateTimeIST(order.placedAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <StatusChip status={order.status} />
          {canCustomerCancel(order.status) && <CancelOrder orderId={order.id} orderNumber={order.orderNumber} />}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="progress" className="rounded-3xl border border-line-strong bg-paper p-6">
          <h2 id="progress" className="mb-5 font-display text-2xl font-semibold text-maroon">Order progress</h2>
          <OrderTimeline status={order.status} history={history} placedAt={order.placedAt} />
          {order.etaMinutes && !['delivered', 'cancelled'].includes(order.status) && <p className="mt-6 text-xs text-taupe">Estimated delivery: about {order.etaMinutes} minutes from when the order was placed.</p>}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="delivery" className="rounded-3xl border border-line-strong bg-paper p-6">
            <h2 id="delivery" className="font-display text-2xl font-semibold text-maroon">Delivery address</h2>
            <p className="mt-3 flex gap-3 text-sm text-espresso/80"><MapPin size={18} className="mt-0.5 shrink-0 text-maroon" aria-hidden /><span><strong className="text-espresso">{order.address.name}</strong>{order.address.phone && ` · ${order.address.phone}`}<br />{order.address.text}</span></p>
          </section>
          <section aria-labelledby="payment" className="rounded-3xl border border-line-strong bg-paper p-6">
            <h2 id="payment" className="font-display text-2xl font-semibold text-maroon">Payment</h2>
            <p className="mt-3 text-sm font-semibold text-espresso">{paymentLabel(order.payment.method, order.payment.status)}</p>
          </section>
        </div>
      </div>

      <section aria-labelledby="items" className="rounded-3xl border border-line-strong bg-paper p-6">
        <h2 id="items" className="font-display text-2xl font-semibold text-maroon">Items</h2>
        <ul className="mt-4 divide-y divide-line">
          {order.items.map((i) => (
            <li key={i.id} className="flex gap-4 py-4">
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sand">{i.image && <Image src={i.image} alt="" fill sizes="64px" className="object-cover" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-display text-base font-semibold text-espresso">{i.name}</span><span className="text-xs text-taupe">{i.variantLabel} · Qty {i.quantity} · {formatINR(i.unitPrice)} each</span></span>
              <span className="font-display text-lg font-semibold text-maroon">{formatINR(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-taupe">Items</dt><dd className="font-semibold">{formatINR(order.subtotal)}</dd></div>
          {order.discount > 0 && <div className="flex justify-between text-forest"><dt>Discount</dt><dd className="font-semibold">−{formatINR(order.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-taupe">Delivery</dt><dd className="font-semibold">{order.deliveryFee === 0 ? 'Free' : formatINR(order.deliveryFee)}</dd></div>
          <div className="flex items-baseline justify-between pt-2"><dt className="font-bold">Total</dt><dd className="font-display text-2xl font-semibold text-maroon">{formatINR(order.total)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
