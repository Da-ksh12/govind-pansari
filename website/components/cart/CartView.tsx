'use client';

import { AlertTriangle, Minus, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { DEFAULT_MAX_QUANTITY, quoteDelivery } from '@/lib/cart/model';
import type { DeliveryTerms } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';
import { useCart } from '../providers/CartProvider';

export function CartView({ terms }: { terms: DeliveryTerms | null }) {
  const cart = useCart();

  if (cart.loading && cart.lines.length > 0) {
    return <div className="space-y-4" aria-busy="true" aria-label="Loading your cart">{cart.lines.slice(0, 3).map((l) => <div key={l.variantId} className="skeleton h-32" />)}</div>;
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
        <span className="grid h-24 w-24 place-items-center rounded-full bg-sand text-maroon"><ShoppingBag size={40} aria-hidden /></span>
        <p className="mt-6 font-display text-3xl text-maroon">Your cart is empty</p>
        <p className="mt-2 text-taupe">Fresh dry fruits, spices and gift boxes are a few taps away.</p>
        <Link href="/shop" className="btn btn-primary mt-8">Start shopping</Link>
      </div>
    );
  }

  const soldOut = cart.items.filter((i) => i.detail.stock === 'out_of_stock');
  const rule = terms ? { deliveryFee: terms.feeMax, minimumOrderValue: terms.minimumOrder, freeDeliveryThreshold: terms.freeDeliveryAbove } : null;
  const delivery = rule ? quoteDelivery(cart.subtotal, rule) : null;
  const belowMinimum = terms ? cart.subtotal < terms.minimumOrder : false;
  const blocked = soldOut.length > 0 || cart.unavailable.length > 0 || cart.items.length === 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-14">
      <div>
        {(soldOut.length > 0 || cart.unavailable.length > 0) && (
          <div role="alert" className="mb-6 flex gap-3 rounded-2xl bg-terracotta-tint p-4 text-sm text-danger">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
            <p><strong>Some items can’t be ordered right now.</strong> Remove them to continue to checkout.</p>
          </div>
        )}
        <ul className="divide-y divide-line rounded-3xl border border-line-strong bg-paper px-4 sm:px-6">
          {cart.items.map((item) => {
            const out = item.detail.stock === 'out_of_stock';
            return (
              <li key={item.variantId} className="flex gap-4 py-5 sm:gap-6">
                <Link href={`/product/${item.detail.productSlug}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-sand sm:h-28 sm:w-28">
                  {item.detail.image && <Image src={item.detail.image} alt="" fill sizes="112px" className={`object-cover ${out ? 'opacity-50 grayscale' : ''}`} />}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/product/${item.detail.productSlug}`} className="block truncate font-display text-lg font-semibold text-espresso hover:text-maroon">{item.detail.name}</Link>
                      <p className="text-sm text-taupe">{item.detail.label} · {formatINR(item.detail.price)} each</p>
                      {item.detail.mrp > item.detail.price && <p className="text-xs text-forest">MRP <s>{formatINR(item.detail.mrp)}</s></p>}
                      {out && <p className="mt-1 text-sm font-bold text-danger">Sold out</p>}
                    </div>
                    <button type="button" onClick={() => void cart.remove(item.variantId)} aria-label={`Remove ${item.detail.name} from cart`} className="rounded-full p-2 text-taupe hover:bg-sand hover:text-danger"><Trash2 size={18} aria-hidden /></button>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="flex items-center rounded-full border-2 border-line-strong bg-ivory" role="group" aria-label={`Quantity of ${item.detail.name}`}>
                      <button type="button" onClick={() => void cart.setQty(item.variantId, item.quantity - 1)} aria-label="Decrease quantity" className="grid h-10 w-10 place-items-center rounded-full text-maroon hover:bg-sand"><Minus size={16} aria-hidden /></button>
                      <output className="w-9 text-center text-sm font-extrabold tabular-nums" aria-live="polite">{item.quantity}</output>
                      <button type="button" onClick={() => void cart.setQty(item.variantId, item.quantity + 1)} disabled={item.quantity >= DEFAULT_MAX_QUANTITY} aria-label="Increase quantity" className="grid h-10 w-10 place-items-center rounded-full text-maroon hover:bg-sand disabled:opacity-35"><Plus size={16} aria-hidden /></button>
                    </div>
                    <p className="font-display text-xl font-semibold text-maroon">{formatINR(item.lineTotal)}</p>
                  </div>
                </div>
              </li>
            );
          })}
          {cart.unavailable.map((line) => (
            <li key={line.variantId} className="flex items-center justify-between gap-4 py-5 text-sm text-taupe">
              <span>An item in your cart is no longer sold.</span>
              <button type="button" onClick={() => void cart.remove(line.variantId)} className="font-bold text-maroon underline">Remove</button>
            </li>
          ))}
        </ul>
        <Link href="/shop" className="mt-6 inline-block text-sm font-bold text-maroon underline">← Continue shopping</Link>
      </div>

      <aside aria-labelledby="cart-summary" className="lg:sticky lg:top-28 lg:self-start">
        <div className="rounded-3xl border border-line-strong bg-paper p-6 shadow-soft">
          <h2 id="cart-summary" className="font-display text-2xl font-semibold text-maroon">Cart summary</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-taupe">Subtotal ({cart.count} {cart.count === 1 ? 'item' : 'items'})</dt><dd className="font-semibold">{formatINR(cart.subtotal)}</dd></div>
            {cart.savings > 0 && <div className="flex justify-between text-forest"><dt>You save on MRP</dt><dd className="font-semibold">{formatINR(cart.savings)}</dd></div>}
            <div className="flex justify-between"><dt className="text-taupe">Delivery</dt><dd className="font-semibold">{delivery ? (delivery.fee === 0 ? 'Free' : `${formatINR(delivery.fee)}`) : 'At checkout'}</dd></div>
            <div className="flex items-baseline justify-between border-t border-line pt-4"><dt className="font-bold">Estimated total</dt><dd className="font-display text-3xl font-semibold text-maroon">{formatINR(cart.subtotal + (delivery?.fee ?? 0))}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-taupe">The final total is confirmed by our server at checkout, using today’s prices and your address.</p>

          {delivery?.hasFreeDelivery && delivery.amountToFree > 0 && (
            <div className="mt-5 rounded-2xl bg-gold-tint p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-gold-dark"><Truck size={17} aria-hidden /> Add {formatINR(delivery.amountToFree)} more for free delivery</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={Math.round(delivery.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free delivery">
                <div className="h-full rounded-full bg-gold transition-[width] duration-700 ease-[var(--ease-premium)]" style={{ width: `${delivery.progress * 100}%` }} />
              </div>
            </div>
          )}
          {delivery?.hasFreeDelivery && delivery.amountToFree === 0 && <p className="mt-5 rounded-2xl bg-forest-tint p-4 text-sm font-bold text-forest">You’ve unlocked free delivery.</p>}
          {belowMinimum && terms && <p className="mt-4 text-sm font-semibold text-terracotta">Add {formatINR(terms.minimumOrder - cart.subtotal)} more to reach the {formatINR(terms.minimumOrder)} minimum order.</p>}

          {blocked ? (
            <button type="button" disabled className="btn btn-primary mt-6 w-full">Checkout</button>
          ) : (
            <Link href="/checkout" className="btn btn-primary mt-6 w-full">Proceed to checkout</Link>
          )}
        </div>
      </aside>
    </div>
  );
}
