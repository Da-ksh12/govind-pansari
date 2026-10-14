import RazorpayCheckout from 'react-native-razorpay';
import { colors } from '../../theme';
import { RazorpayCheckoutCancelledError, type RazorpayCheckoutParams, type RazorpayCheckoutResult } from './razorpayCheckout.types';

/** Real native Razorpay Checkout — iOS/Android only (see razorpayCheckout.web.ts for the browser Checkout.js counterpart). */
export async function openRazorpayCheckout(params: RazorpayCheckoutParams): Promise<RazorpayCheckoutResult> {
  try {
    const result = await RazorpayCheckout.open({
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
    });
    if (!result.razorpay_order_id || !result.razorpay_signature) {
      throw new Error('Payment completed but the gateway response was incomplete.');
    }
    return {
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    };
  } catch (e: unknown) {
    // RazorpayCheckout.open() rejects with a PaymentErrorData object
    // (code/description/reason), not an Error. The SDK's own error
    // codes for "user dismissed the checkout" aren't documented in
    // the package README, so this matches on the description text
    // Razorpay's SDK is known to use rather than trusting an
    // unverified numeric code.
    const err = e as { code?: number; description?: string } | undefined;
    if (err?.description?.toLowerCase().includes('cancel')) throw new RazorpayCheckoutCancelledError();
    throw new Error(err?.description || 'The payment could not be completed. Please try again.');
  }
}
