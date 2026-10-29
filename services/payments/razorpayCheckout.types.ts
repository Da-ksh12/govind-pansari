/** Kept dependency-free (no react-native-razorpay import) so razorpayCheckout.web.ts never pulls in the native-only module — same split pattern as LiveTrackingMap/FleetMap. */
export interface RazorpayCheckoutParams {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  orderNumber: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface RazorpayCheckoutResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export class RazorpayCheckoutCancelledError extends Error {
  constructor() {
    super('Payment was cancelled.');
    this.name = 'RazorpayCheckoutCancelledError';
  }
}

/**
 * The gateway reported a successful payment but the server could not be reached
 * to verify it (network drop, server error). The outcome is UNKNOWN, not
 * failed: the money may well have been taken. The order must not be cancelled
 * and the customer must not be asked to pay again — the Razorpay webhook (or a
 * later verification) settles it.
 */
export class PaymentVerificationUnavailableError extends Error {
  constructor() {
    super('Payment verification is temporarily unavailable.');
    this.name = 'PaymentVerificationUnavailableError';
  }
}

/**
 * The gateway or SDK refused or failed the payment. `raw` is the gateway's own
 * payload, kept only so it can be classified (services/payments/paymentErrors)
 * and logged as diagnostics — it is never shown to the customer, and the
 * message is a fixed, safe string precisely so nothing can leak by accident.
 */
export class RazorpayCheckoutFailedError extends Error {
  readonly raw: unknown;
  constructor(raw: unknown) {
    super('The payment could not be completed.');
    this.name = 'RazorpayCheckoutFailedError';
    this.raw = raw;
  }
}
