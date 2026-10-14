// react-native-razorpay ships no .d.ts (confirmed: no declaration file
// anywhere in the package as of v3.0.0) — this mirrors its real JS API
// (RazorpayCheckout.js) and documented option/result shapes (README).
declare module 'react-native-razorpay' {
  export interface RazorpayOptions {
    key: string;
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string; hide_topbar?: boolean };
    [key: string]: unknown;
  }

  export interface PaymentSuccessData {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
    [key: string]: unknown;
  }

  export interface PaymentErrorData {
    code: number;
    description: string;
    source: string;
    step: string;
    reason: string;
    metadata: { order_id?: string; payment_id?: string; [key: string]: unknown };
  }

  export default class RazorpayCheckout {
    static open(options: RazorpayOptions): Promise<PaymentSuccessData>;
    static onExternalWalletSelection(callback: (data: { external_wallet: string }) => void): void;
  }
}
