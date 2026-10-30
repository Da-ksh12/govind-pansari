import Image from 'next/image';
import Link from 'next/link';
import type { OrderView } from '@/lib/orders/data';
import { formatDateTimeIST, formatINR, pluralize } from '@/lib/format';
import { StatusChip } from './OrderParts';

export function OrderCard({ order }: { order: OrderView }) {
  const thumbs = order.items.filter((i) => i.image).slice(0, 4);
  const units = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Link href={`/account/orders/${order.id}`} className="block rounded-2xl border border-line-strong bg-paper p-5 transition hover:shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-espresso">Order {order.orderNumber}</p>
          <p className="text-sm text-taupe">{formatDateTimeIST(order.placedAt)}</p>
        </div>
        <StatusChip status={order.status} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex -space-x-3">
          {thumbs.map((i) => (
            <span key={i.id} className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-paper bg-sand">{i.image && <Image src={i.image} alt="" fill sizes="48px" className="object-cover" />}</span>
          ))}
          {order.items.length > thumbs.length && <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-paper bg-sand text-xs font-bold text-taupe">+{order.items.length - thumbs.length}</span>}
        </div>
        <p className="text-right text-sm text-taupe">{pluralize(units, 'item')}<span className="block font-display text-xl font-semibold text-maroon">{formatINR(order.total)}</span></p>
      </div>
    </Link>
  );
}
