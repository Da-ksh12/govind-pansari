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
