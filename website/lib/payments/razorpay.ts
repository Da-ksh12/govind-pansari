'use client';

// Razorpay Checkout (their hosted payment sheet) for the browser. This file only OPENS the sheet and reports what the customer did. It never
// decides that an order is paid: the signature Razorpay returns is sent to the server (verify-razorpay-payment), which checks it with the
// secret key the browser never sees. A customer who closes the tab after paying is settled by the Razorpay webhook, not by this code.

export class RazorpayCancelledError extends Error {
  constructor() {
    super('Payment was cancelled.');
    this.name = 'RazorpayCancelledError';
  }
}

/** The sheet reported a failed payment (declined, bank refused, ...). `raw` goes to the classifier and the logs, never to the customer. */
export class RazorpayFailedError extends Error {
  readonly raw: unknown;
  constructor(raw: unknown) {
    super('The payment could not be completed.');
    this.name = 'RazorpayFailedError';
    this.raw = raw;
  }
}

/** The bank said "paid" but the server could not be asked to confirm it. The money may have been taken: this is "unknown", never "failed". */
export class PaymentVerificationUnavailableError extends Error {
  constructor() {
    super('Payment verification is temporarily unavailable.');
    this.name = 'PaymentVerificationUnavailableError';
  }
}

export interface RazorpayParams {
  keyId: string;
  razorpayOrderId: string;
  /** In paise, exactly as the server's own order returned it. */
  amount: number;
  currency: string;
  orderNumber: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface RazorpayResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: { error?: unknown }) => void) => void;
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<RazorpayConstructor> | null = null;

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not start')));
    script.onerror = () => {
      loading = null; // allow a later retry
      reject(new Error('Could not load the payment sheet (network)'));
    };
    document.head.append(script);
  });
  return loading;
}

export async function openRazorpayCheckout(params: RazorpayParams): Promise<RazorpayResult> {
  const Razorpay = await loadRazorpay();
  return new Promise<RazorpayResult>((resolve, reject) => {
    let lastFailure: unknown = null;
    const sheet = new Razorpay({
      key: params.keyId,
      order_id: params.razorpayOrderId,
      amount: params.amount,
      currency: params.currency,
      name: 'Govind Pansari',
      description: `Order ${params.orderNumber}`,
      image: `${window.location.origin}/brand/seal.webp`,
      prefill: { name: params.customerName, email: params.customerEmail, contact: params.customerPhone },
      theme: { color: '#6e1423' },
      retry: { enabled: true },
      handler: (response: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }) => {
        if (response.razorpay_order_id && response.razorpay_payment_id && response.razorpay_signature) {
          resolve({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature });
        } else {
          reject(new RazorpayFailedError({ description: 'incomplete payment response' }));
        }
      },
      // Closing the sheet after a failed attempt is a failure the customer should hear about; closing it untouched is a quiet cancel.
      modal: { ondismiss: () => reject(lastFailure ? new RazorpayFailedError(lastFailure) : new RazorpayCancelledError()) },
    });
    // The sheet lets the customer retry inside it, so a failure is remembered, not final; a later success still resolves.
    sheet.on('payment.failed', (response) => {
      lastFailure = response.error ?? response;
    });
    sheet.open();
  });
}
