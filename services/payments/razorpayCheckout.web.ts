import { colors } from '../../theme';
import { RazorpayCheckoutCancelledError, type RazorpayCheckoutParams, type RazorpayCheckoutResult } from './razorpayCheckout.types';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loadPromise: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay checkout is only available in a browser.'));
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error("Couldn't load the payment gateway. Check your connection and try again.")));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the payment gateway. Check your connection and try again."));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Razorpay's own Checkout.js — web only (see razorpayCheckout.ts for the native SDK counterpart). Same file-split pattern as LiveTrackingMap/FleetMap. */
export async function openRazorpayCheckout(params: RazorpayCheckoutParams): Promise<RazorpayCheckoutResult> {
  await loadCheckoutScript();
  if (!window.Razorpay) throw new Error("Couldn't load the payment gateway. Please try again.");

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: params.keyId,
      order_id: params.razorpayOrderId,
      amount: params.amount,
      currency: params.currency,
      name: 'Govind Pansari',
      description: `Order #${params.orderNumber}`,
      prefill: {
        name: params.customerName,
        email: params.customerEmail,
        contact: params.customerPhone,
      },
      theme: { color: colors.primary },
      handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        resolve({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
      },
      modal: {
        ondismiss: () => reject(new RazorpayCheckoutCancelledError()),
      },
    });
    rzp.open();
  });
}
