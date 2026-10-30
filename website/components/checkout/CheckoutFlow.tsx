'use client';

import { AlertTriangle, Banknote, Building2, CheckCircle2, CreditCard, MapPin, Plus, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AddressForm } from '../account/AddressForm';
import { Spinner } from '../brand/NutLoader';
import { useCart } from '../providers/CartProvider';
import { useToast } from '../providers/ToastProvider';
import { addressOneLine, toSavedAddress, type SavedAddress } from '@/lib/address';
import {
  createRazorpayOrder, getCheckoutSummary, newIdempotencyKey, placeOrder, restoreCartAfterFailedPayment, verifyRazorpayPayment,
  type CheckoutSummaryResult, type PaymentMethod,
} from '@/lib/checkout/api';
import { evaluatePlaceOrder, type SummaryState } from '@/lib/checkout/gate';
import type { DeliveryTerms } from '@/lib/data/storefront';
import { formatINR } from '@/lib/format';
import { classifyPaymentFailure, verificationFailureMessage } from '@/lib/payments/errors';
import { PaymentVerificationUnavailableError, RazorpayCancelledError, RazorpayFailedError, openRazorpayCheckout } from '@/lib/payments/razorpay';
import { shortStoreName } from '@/lib/serviceability';
import { browserClient } from '@/lib/supabase/browser';

interface Props {
  userId: string;
  name: string;
  phone: string;
  email: string;
  terms: DeliveryTerms | null;
}

const METHODS: { key: PaymentMethod; label: string; hint: string; icon: typeof Smartphone; recommended?: boolean }[] = [
  { key: 'upi', label: 'UPI', hint: 'Google Pay, PhonePe, Paytm, BHIM…', icon: Smartphone, recommended: true },
  { key: 'card', label: 'Credit / debit card', hint: 'Visa, Mastercard, RuPay', icon: CreditCard },
  { key: 'netbanking', label: 'Net banking', hint: 'All major banks', icon: Building2 },
  { key: 'wallet', label: 'Wallets', hint: 'Paytm, Mobikwik and more', icon: Wallet },
  { key: 'cod', label: 'Cash on delivery', hint: 'Pay when it arrives', icon: Banknote },
];

type Outcome = 'paid' | 'failed' | 'unknown';

export function CheckoutFlow({ userId, name, phone, email, terms }: Props) {
  const router = useRouter();
  const cart = useCart();
  const toast = useToast();

  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  // The server's last answer, tagged with the cart+address it was computed for. result null = that request failed. Whether we are "loading" is
  // derived (the tag no longer matches the current cart/address), so nothing sets state synchronously inside an effect.
  const [fetched, setFetched] = useState<{ key: string; result: CheckoutSummaryResult | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newIdempotencyKey());

  // 1) saved addresses
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await browserClient().from('addresses').select('*').eq('user_id', userId).order('is_default', { ascending: false }).order('created_at', { ascending: false });
      if (!alive) return;
      const list = error ? [] : (data ?? []).map(toSavedAddress);
      setAddresses(list);
      setSelectedId((list.find((a) => a.isDefault) ?? list[0])?.id ?? null);
      if (list.length === 0) setAdding(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // 2) the server's own total for this cart and address — recomputed whenever either changes
  const { settled } = cart;
  const cartLines = cart.lines.length;
  const cartLoading = cart.loading;
  const signature = cart.lines.map((l) => `${l.variantId}:${l.quantity}`).sort().join('|');
  const summaryKey = selectedId ? `${selectedId}|${signature}|${retry}` : '';

  useEffect(() => {
    if (!selectedId || placing || cartLoading || cartLines === 0) return;
    let alive = true;
    void (async () => {
      try {
        await settled(); // every cart change the customer made has reached the server
        const result = await getCheckoutSummary(selectedId);
        if (alive) setFetched({ key: summaryKey, result });
      } catch {
        if (alive) setFetched({ key: summaryKey, result: null });
      }
    })();
    return () => {
      alive = false; // a newer cart or address supersedes this answer
    };
  }, [summaryKey, selectedId, placing, cartLoading, cartLines, settled]);

  const summary = fetched?.result ?? null; // the last answer stays on screen (dimmed) while a newer one loads
  const summaryState: 'none' | 'loading' | 'ready' | 'failed' = !selectedId ? 'none' : fetched?.key !== summaryKey ? 'loading' : fetched.result ? 'ready' : 'failed';
  const summaryError = "We couldn't update your total. Check your connection and try again.";
  const success = summary?.success ? summary : null;
  const failure = summary && !summary.success ? summary : null;

  const gateSummary: SummaryState =
    summaryState === 'none' ? { status: 'none' }
    : summaryState === 'loading' ? { status: 'loading' }
    : summaryState === 'failed' ? { status: 'failed', message: summaryError }
    : success ? { status: 'ready', meetsMinimumOrder: success.meetsMinimumOrder, amountToMinimumOrder: success.amountToMinimumOrder, minimumOrderValue: success.minimumOrderValue }
    : { status: 'failed', message: failure?.message ?? "We can't deliver this order right now." };
  const gate = evaluatePlaceOrder({ hasAddress: !!selectedId, paymentMethod: method, summary: gateSummary, placing });

  /** 'paid' only when the SERVER has verified the signature. 'unknown' = the bank said yes but the server could not be asked: nothing is cancelled. */
  async function completeGatewayPayment(orderId: string, orderNumber: string): Promise<Outcome> {
    try {
      const order = await createRazorpayOrder(orderId);
      const paid = await openRazorpayCheckout({
        keyId: order.keyId,
        razorpayOrderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        orderNumber,
        customerName: name || undefined,
        customerEmail: email || undefined,
        customerPhone: phone ? `+${phone.replace(/\D/g, '')}` : undefined,
      });
      const verified = await verifyRazorpayPayment({ orderId, ...paid });
      if (!verified.success) {
        setProblem(verificationFailureMessage());
        return 'failed';
      }
      return 'paid';
    } catch (error) {
      if (error instanceof PaymentVerificationUnavailableError) return 'unknown';
      if (error instanceof RazorpayCancelledError) return 'failed'; // a quiet exit: no scary message
      const failed = classifyPaymentFailure(error instanceof RazorpayFailedError ? error.raw : error);
      console.warn('[checkout] payment failed:', failed.kind, failed.diagnostics);
      if (failed.showError) setProblem(failed.message);
      return 'failed';
    }
  }

  async function onPlaceOrder() {
    if (!gate.canPlace || !selectedId || !method) return;
    setPlacing(true);
    setProblem('');
    try {
      // Idempotent on (customer, key): retrying the same attempt resumes the SAME order and stock reservation, never a second order.
      const result = await placeOrder(selectedId, key.current, method);
      if (!result.success) {
        if (result.code === 'CHECKOUT_ALREADY_PROCESSED') {
          key.current = newIdempotencyKey();
          await cart.refresh();
          setProblem('Your previous payment attempt was closed. Please tap the button again.');
        } else {
          setFetched({ key: summaryKey, result }); // show the server's reason (out of stock, outside the area, ...)
          if (result.code === 'CART_EMPTY') await cart.refresh();
        }
        setPlacing(false);
        return;
      }

      if (method !== 'cod') {
        const outcome = await completeGatewayPayment(result.orderId, result.orderNumber);
        if (outcome === 'unknown') {
          toast.show("We're confirming your payment with the bank. Your order will appear in My Orders once it's confirmed — please don't pay again.", 'info');
          await cart.refresh();
          router.replace('/account/orders');
          return;
        }
        if (outcome === 'failed') {
          // the order and stock reservation exist already, and the cart was emptied: undo BOTH, or the cart vanishes for a purchase that never happened
          try {
            await restoreCartAfterFailedPayment(result.orderId);
          } catch {
            // best effort — the server's 15-minute sweep releases the reservation anyway
          } finally {
            await cart.refresh();
            key.current = newIdempotencyKey();
          }
          setPlacing(false);
          return;
        }
      }
      await cart.refresh();
      router.replace(`/account/orders/${result.orderId}?placed=1`);
    } catch {
      setPlacing(false);
      setProblem("We couldn't place your order. Please try again.");
    }
  }

  // ---- empty cart -----------------------------------------------------------------------------------------------------------
  if (!placing && !cart.loading && cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="font-display text-3xl text-maroon">Your cart is empty</p>
        <p className="mt-2 text-taupe">Add something you like, then come back to check out.</p>
        <Link href="/shop" className="btn btn-primary mt-6">Browse the shop</Link>
      </div>
    );
  }

  const online = method !== null && method !== 'cod';
  const buttonLabel = placing ? 'Placing your order…' : success ? (online ? `Pay ${formatINR(success.total)}` : `Place order · ${formatINR(success.total)}`) : online ? 'Pay now' : 'Place order';

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:gap-12">
      <div className="space-y-8">
        {/* 1 · address */}
        <section aria-labelledby="co-address" className="rounded-3xl border border-line-strong bg-paper p-5 sm:p-7">
          <h2 id="co-address" className="flex items-center gap-3 font-display text-2xl font-semibold text-maroon"><span className="grid h-8 w-8 place-items-center rounded-full bg-maroon text-sm text-ivory">1</span> Delivery address</h2>
          {addresses === null ? (
            <div className="mt-5 space-y-3" aria-busy="true"><div className="skeleton h-20" /><div className="skeleton h-20" /></div>
          ) : (
            <>
              {addresses.length > 0 && (
                <div role="radiogroup" aria-label="Saved addresses" className="mt-5 space-y-3">
                  {addresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedId === a.id}
                      onClick={() => { setSelectedId(a.id); setAdding(false); setProblem(''); }}
                      className={`flex w-full items-start gap-4 rounded-2xl border-2 p-4 text-left transition ${selectedId === a.id ? 'border-maroon bg-maroon-light' : 'border-line-strong hover:border-maroon/50'}`}
                    >
                      <MapPin size={20} className="mt-0.5 shrink-0 text-maroon" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-extrabold capitalize text-espresso">{a.label}{a.isDefault && <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-gold-dark">Default</span>}</span>
                        <span className="mt-1 block text-sm text-espresso/80">{a.receiverName} · {a.receiverPhone}</span>
                        <span className="mt-0.5 block text-sm text-taupe">{addressOneLine(a)}</span>
                      </span>
                      {selectedId === a.id && <CheckCircle2 size={20} className="shrink-0 text-maroon" aria-hidden />}
                    </button>
                  ))}
                </div>
              )}
              {adding ? (
                <div className="mt-6 border-t border-line pt-6">
                  <AddressForm
                    userId={userId}
                    defaultName={name}
                    defaultPhone={phone.replace(/\D/g, '').replace(/^91/, '')}
                    first={addresses.length === 0}
                    onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
                    onSaved={(saved) => { setAddresses((list) => [saved, ...(list ?? [])]); setSelectedId(saved.id); setAdding(false); }}
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-maroon"><Plus size={17} aria-hidden /> Add a new address</button>
              )}
            </>
          )}
        </section>

        {/* 2 · payment */}
        <section aria-labelledby="co-pay" className="rounded-3xl border border-line-strong bg-paper p-5 sm:p-7">
          <h2 id="co-pay" className="flex items-center gap-3 font-display text-2xl font-semibold text-maroon"><span className="grid h-8 w-8 place-items-center rounded-full bg-maroon text-sm text-ivory">2</span> Payment</h2>
          <div role="radiogroup" aria-label="Payment method" className="mt-5 grid gap-3 sm:grid-cols-2">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={method === m.key}
                onClick={() => { setMethod(m.key); setProblem(''); }}
                className={`relative flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition ${method === m.key ? 'border-maroon bg-maroon-light' : 'border-line-strong hover:border-maroon/50'}`}
              >
                <m.icon size={22} className={method === m.key ? 'text-maroon' : 'text-taupe'} aria-hidden />
                <span>
                  <span className="block text-sm font-extrabold text-espresso">{m.label}</span>
                  <span className="block text-xs text-taupe">{m.hint}</span>
                </span>
                {m.recommended && <span className="absolute right-3 top-3 rounded-full bg-gold-tint px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider text-gold-dark">Recommended</span>}
              </button>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 text-sm text-taupe"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-forest" aria-hidden />
            {online ? 'You will complete the payment in a secure Razorpay window. Your order is confirmed only after the payment is verified.' : method === 'cod' ? 'Pay in cash when your order arrives.' : 'Online payments are processed securely by Razorpay.'}
          </p>
        </section>

        {/* 3 · items */}
        <section aria-labelledby="co-items" className="rounded-3xl border border-line-strong bg-paper p-5 sm:p-7">
          <h2 id="co-items" className="flex items-center gap-3 font-display text-2xl font-semibold text-maroon"><span className="grid h-8 w-8 place-items-center rounded-full bg-maroon text-sm text-ivory">3</span> Review items</h2>
          {success ? (
            <ul className="mt-5 divide-y divide-line">
              {success.items.map((item) => (
                <li key={item.cartItemId} className="flex gap-4 py-4">
                  <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sand">{item.image && <Image src={item.image} alt="" fill sizes="64px" className="object-cover" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-semibold text-espresso">{item.productName}</span>
                    <span className="block text-xs text-taupe">{item.variantLabel} · Qty {item.quantity}</span>
                  </span>
                  <span className="font-display text-lg font-semibold text-maroon">{formatINR(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-5 space-y-3" aria-busy="true">
              {cart.items.map((i) => (
                <li key={i.variantId} className="flex justify-between gap-4 text-sm"><span className="truncate">{i.detail.name} · {i.detail.label} × {i.quantity}</span><span>{formatINR(i.lineTotal)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* summary */}
      <aside aria-labelledby="co-summary" className="lg:sticky lg:top-28 lg:self-start">
        <div className="rounded-3xl border border-line-strong bg-paper p-6 shadow-soft">
          <h2 id="co-summary" className="font-display text-2xl font-semibold text-maroon">Order summary</h2>
          {summaryState === 'loading' && !success && <div className="mt-5 space-y-3" aria-busy="true"><div className="skeleton h-5" /><div className="skeleton h-5" /><div className="skeleton h-8" /></div>}
          {success && (
            <dl className={`mt-5 space-y-3 text-sm transition-opacity ${summaryState === 'loading' ? 'opacity-50' : ''}`}>
              <div className="flex justify-between"><dt className="text-taupe">Items</dt><dd className="font-semibold">{formatINR(success.subtotal)}</dd></div>
              {success.mrpTotal > success.subtotal && <div className="flex justify-between text-forest"><dt>You save on MRP</dt><dd className="font-semibold">{formatINR(success.mrpTotal - success.subtotal)}</dd></div>}
              {success.discount > 0 && <div className="flex justify-between text-forest"><dt>Discount</dt><dd className="font-semibold">−{formatINR(success.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-taupe">Delivery</dt><dd className="font-semibold">{success.deliveryFee === 0 ? 'Free' : formatINR(success.deliveryFee)}</dd></div>
              <div className="flex items-baseline justify-between border-t border-line pt-4"><dt className="font-bold">Total</dt><dd className="font-display text-3xl font-semibold text-maroon">{formatINR(success.total)}</dd></div>
              <p className="text-xs text-taupe">Packed at our {shortStoreName(success.storeName)} shop · about {success.estimatedDeliveryMinutes} min to deliver</p>
              {terms?.freeDeliveryAbove && success.deliveryFee > 0 && success.subtotal < terms.freeDeliveryAbove && (
                <p className="rounded-xl bg-gold-tint p-3 text-xs font-semibold text-gold-dark">Add {formatINR(terms.freeDeliveryAbove - success.subtotal)} more for free delivery.</p>
              )}
              {success.warnings.map((w) => (
                <p key={w.productName} className="flex gap-2 rounded-xl bg-gold-tint p-3 text-xs font-semibold text-gold-dark"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> The price of {w.productName} changed from {formatINR(w.oldPrice)} to {formatINR(w.newPrice)}.</p>
              ))}
            </dl>
          )}
          {failure && (
            <div role="alert" className="mt-5 flex gap-3 rounded-xl bg-terracotta-tint p-4 text-sm text-danger">
              <AlertTriangle size={19} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="font-bold">{failure.message}</p>
                {failure.unavailableItems && failure.unavailableItems.length > 0 && <p className="mt-1">Not available right now: {failure.unavailableItems.join(', ')}.</p>}
                {(failure.code === 'OUT_OF_STOCK' || failure.code === 'PRODUCT_UNAVAILABLE' || failure.code === 'CART_NOT_FULFILLABLE') && <Link href="/cart" className="mt-2 inline-block font-bold underline">Edit your cart</Link>}
              </div>
            </div>
          )}
          {summaryState === 'failed' && (
            <div role="alert" className="mt-5 text-sm text-danger">{summaryError} <button type="button" onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Try again</button></div>
          )}

          {problem && <p role="alert" className="mt-5 rounded-xl bg-terracotta-tint p-3.5 text-sm font-semibold text-danger">{problem}</p>}
          {!gate.canPlace && gate.message && !failure && <p className="mt-5 text-sm text-taupe" aria-live="polite">{gate.message}</p>}

          <button type="button" onClick={() => void onPlaceOrder()} disabled={!gate.canPlace} className="btn btn-primary mt-6 w-full">
            {placing && <Spinner />} {buttonLabel}
          </button>
          <p className="mt-3 text-center text-xs text-taupe">By placing your order you agree to our <Link href="/terms" className="font-semibold underline">Terms</Link>, <Link href="/refunds" className="font-semibold underline">Cancellation &amp; Refund policy</Link>.</p>
        </div>
      </aside>
    </div>
  );
}
