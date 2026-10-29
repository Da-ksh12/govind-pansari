import RazorpayCheckout from 'react-native-razorpay';
import { colors } from '../../theme';
import { RazorpayCheckoutCancelledError, RazorpayCheckoutFailedError, type RazorpayCheckoutParams, type RazorpayCheckoutResult } from './razorpayCheckout.types';
import { classifyPaymentFailure } from './paymentErrors';

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
      throw new RazorpayCheckoutFailedError({ description: 'incomplete gateway response' });
    }
    return {
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    };
  } catch (e: unknown) {
    if (e instanceof RazorpayCheckoutFailedError) throw e;
    // RazorpayCheckout.open() rejects with a PaymentErrorData object
    // (code/description/reason) — sometimes with the whole gateway JSON
    // as `description` — not an Error. Whatever it is stays in `raw`,
    // where paymentErrors.classifyPaymentFailure turns it into a safe
    // message; it is never used as user-facing text. The SDK's cancel
    // codes aren't documented, so cancellation is also recognised there
    // from the description text rather than from an unverified number.
    const failure = classifyPaymentFailure(e);
    if (failure.kind === 'cancelled') throw new RazorpayCheckoutCancelledError();
    throw new RazorpayCheckoutFailedError(e);
  }
}
