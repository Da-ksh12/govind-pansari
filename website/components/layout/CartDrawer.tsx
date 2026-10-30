'use client';

import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useDialog } from '@/lib/hooks/useDialog';
import { formatINR } from '@/lib/format';
import { DEFAULT_MAX_QUANTITY } from '@/lib/cart/model';
import { useCart } from '../providers/CartProvider';

export function CartDrawer() {
  const cart = useCart();
  const panel = useDialog(cart.drawerOpen, cart.closeDrawer);

  return (
    <AnimatePresence>
      {cart.drawerOpen && (
        <motion.div
          className="fixed inset-0 z-[85] bg-maroon-darker/55 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onMouseDown={(e) => e.target === e.currentTarget && cart.closeDrawer()}
        >
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Your cart"
            tabIndex={-1}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-ivory shadow-lift"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-2xl font-semibold text-maroon">Your cart{cart.count > 0 && <span className="ml-2 text-base font-normal text-taupe">({cart.count})</span>}</h2>
              <button type="button" onClick={cart.closeDrawer} aria-label="Close cart" className="rounded-full p-2 text-taupe hover:bg-sand">
                <X size={22} aria-hidden />
              </button>
            </header>

            {cart.loading && cart.lines.length > 0 ? (
              <div className="flex-1 space-y-4 p-5" aria-busy="true">
                {cart.lines.slice(0, 3).map((l) => <div key={l.variantId} className="skeleton h-24" />)}
              </div>
            ) : cart.lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-sand text-maroon"><ShoppingBag size={34} aria-hidden /></span>
                <p className="font-display text-2xl text-maroon">Your cart is empty</p>
                <p className="text-sm text-taupe">Fresh dry fruits and spices are a few taps away.</p>
                <Link href="/shop" onClick={cart.closeDrawer} className="btn btn-primary">Start shopping</Link>
              </div>
            ) : (
              <>
                <ul className="flex-1 divide-y divide-line overflow-y-auto px-5">
                  <AnimatePresence initial={false}>
                    {cart.items.map((item) => (
                      <motion.li
                        key={item.variantId}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.28 }}
                        className="flex gap-4 py-4"
                      >
                        <Link href={`/product/${item.detail.productSlug}`} onClick={cart.closeDrawer} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-sand">
                          {item.detail.image && <Image src={item.detail.image} alt="" fill sizes="80px" className="object-cover" />}
                        </Link>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <Link href={`/product/${item.detail.productSlug}`} onClick={cart.closeDrawer} className="truncate font-display text-base font-semibold text-espresso">{item.detail.name}</Link>
                          <p className="text-xs text-taupe">{item.detail.label}</p>
                          <div className="mt-auto flex items-center justify-between pt-2">
                            <div className="flex items-center rounded-full border border-line-strong bg-paper">
                              <button type="button" onClick={() => void cart.setQty(item.variantId, item.quantity - 1)} aria-label={`Fewer ${item.detail.name}`} className="grid h-9 w-9 place-items-center rounded-full text-maroon hover:bg-sand">
                                {item.quantity === 1 ? <Trash2 size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
                              </button>
                              <span className="w-7 text-center text-sm font-bold tabular-nums" aria-live="polite">{item.quantity}</span>
                              <button type="button" onClick={() => void cart.setQty(item.variantId, item.quantity + 1)} disabled={item.quantity >= DEFAULT_MAX_QUANTITY} aria-label={`More ${item.detail.name}`} className="grid h-9 w-9 place-items-center rounded-full text-maroon hover:bg-sand disabled:opacity-40">
                                <Plus size={15} aria-hidden />
                              </button>
                            </div>
                            <span className="font-display text-lg font-semibold text-maroon">{formatINR(item.lineTotal)}</span>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  {cart.unavailable.map((line) => (
                    <li key={line.variantId} className="flex items-center justify-between gap-3 py-4 text-sm text-taupe">
                      <span>An item in your cart is no longer sold.</span>
                      <button type="button" onClick={() => void cart.remove(line.variantId)} className="font-semibold text-maroon underline">Remove</button>
                    </li>
                  ))}
                </ul>

                <footer className="space-y-3 border-t border-line bg-paper px-5 py-5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-taupe">Subtotal</span>
                    <span className="font-display text-2xl font-semibold text-maroon">{formatINR(cart.subtotal)}</span>
                  </div>
                  {cart.savings > 0 && <p className="text-sm font-semibold text-forest">You save {formatINR(cart.savings)} on MRP.</p>}
                  <p className="text-xs text-taupe">Delivery charge and the final total are confirmed at checkout.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Link href="/cart" onClick={cart.closeDrawer} className="btn btn-ghost">View cart</Link>
                    <Link href="/checkout" onClick={cart.closeDrawer} className="btn btn-primary">Checkout</Link>
                  </div>
                </footer>
              </>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
