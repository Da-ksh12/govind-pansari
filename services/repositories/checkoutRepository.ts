import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { PaymentVerificationUnavailableError } from '../payments/razorpayCheckout.types';

export interface CheckoutSummaryItem {
  cartItemId: string;
  productId: string;
  productVariantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  mrp: number;
  lineTotal: number;
  priceChanged: boolean;
}

export interface CheckoutWarning {
  code: 'PRICE_CHANGED';
  productName: string;
  oldPrice: number;
  newPrice: number;
}

export type CheckoutErrorCode =
  | 'CART_EMPTY'
  | 'ADDRESS_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  // Serviceability reasons — the same codes (and wording, via services/serviceability) as the address screens.
  | 'OUTSIDE_SERVICE_AREA'
  | 'STORE_CLOSED'
  | 'STORES_NOT_ACCEPTING_ORDERS'
  | 'NO_ACTIVE_STORES'
  | 'INVALID_COORDINATES'
  | 'CART_NOT_FULFILLABLE'
  | 'BELOW_MINIMUM_ORDER'
  | 'OUT_OF_STOCK'
  | 'CHECKOUT_ALREADY_PROCESSED';

export interface CheckoutFailure {
  success: false;
  code: CheckoutErrorCode;
  message: string;
  unavailableItems?: string[];
  minimumOrderValue?: number;
  amountToMinimumOrder?: number;
  /** Present for the serviceability reasons. */
  opensAt?: string;
  closesAt?: string;
  maxRadiusKm?: number;
  nearestStore?: { storeId: string; storeName: string; distanceMeters: number };
}

export interface CheckoutSummarySuccess {
  success: true;
  storeId: string;
  storeName: string;
  deliveryZoneId: string;
  items: CheckoutSummaryItem[];
  subtotal: number;
  mrpTotal: number;
  discount: number;
  deliveryFee: number;
  minimumOrderValue: number;
  meetsMinimumOrder: boolean;
  amountToMinimumOrder: number;
  estimatedDeliveryMinutes: number;
  total: number;
  warnings: CheckoutWarning[];
}

export type CheckoutSummaryResult = CheckoutSummarySuccess | CheckoutFailure;

export interface PlaceOrderSuccess {
  success: true;
  idempotent: boolean;
  orderId: string;
  orderNumber: string;
  status: string;
  total: number;
  paymentMethod?: PaymentMethod;
  estimatedDeliveryMinutes: number;
}

export type PlaceOrderResult = PlaceOrderSuccess | CheckoutFailure;

export type PaymentMethod = 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet';

export interface RazorpayOrderInfo {
  razorpayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  orderNumber: string;
}

/**
 * Errors thrown from here are transport/auth failures only (section 43)
 * — every *expected* business outcome (empty cart, outside service
 * area, out of stock, below minimum order) comes back as a typed
 * {success:false, code} value instead, same convention as
 * storeRepository.checkServiceability. The Checkout screen renders
 * `code` directly rather than catching an exception for these.
 */
export const checkoutRepository = {
  /** One key per checkout *attempt* — reused across retries of that same attempt (double-tap, timeout+resend), regenerated only when the customer starts over. */
  newIdempotencyKey(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  },

  async getSummary(addressId: string): Promise<CheckoutSummaryResult> {
    const { data, error } = await supabase.rpc('get_checkout_summary', { p_address_id: addressId });
    if (error) throw toCatalogueError(error);
    return data as CheckoutSummaryResult;
  },

  async placeOrder(addressId: string, idempotencyKey: string, paymentMethod: PaymentMethod = 'cod'): Promise<PlaceOrderResult> {
    const { data, error } = await supabase.rpc('create_order_from_cart', {
      p_address_id: addressId,
      p_idempotency_key: idempotencyKey,
      p_payment_method: paymentMethod,
    });
    if (error) throw toCatalogueError(error);
    return data as PlaceOrderResult;
  },

  /** Creates the real Razorpay order server-side (amount comes from the server's own order total, never the client) — call once an order exists with a gateway payment method. */
  async createRazorpayOrder(orderId: string): Promise<RazorpayOrderInfo> {
    const { data, error } = await supabase.functions.invoke('create-razorpay-order', { body: { order_id: orderId } });
    if (error) throw new Error(error.message || "Couldn't start the payment. Please try again.");
    return data as RazorpayOrderInfo;
  },

  /** The only place a payment is marked paid — verifies Razorpay's own signature server-side before confirm_payment() ever runs. */
  async verifyRazorpayPayment(params: {
    orderId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Promise<{ success: boolean }> {
    const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
      body: {
        order_id: params.orderId,
        razorpay_order_id: params.razorpayOrderId,
        razorpay_payment_id: params.razorpayPaymentId,
        razorpay_signature: params.razorpaySignature,
      },
    });
    if (error) {
      // Tell a definitive server answer apart from "we never got an answer":
      //  * 4xx — the server looked at this payment and refused it (signature
      //    mismatch, wrong order) or found it already confirmed (409 "already
      //    paid", e.g. the webhook got there first). Both are real outcomes.
      //  * anything else (network failure, 5xx) — unknown. The money may have
      //    been taken, so this must NOT read as a failed payment.
      const response = (error as { context?: Response }).context;
      const status = typeof response?.status === 'number' ? response.status : undefined;
      if (status !== undefined && status >= 400 && status < 500) {
        if (status === 409) {
          const detail = await response?.clone().json().catch(() => null);
          if (typeof detail?.error === 'string' && /already paid/i.test(detail.error)) return { success: true };
        }
        return { success: false };
      }
      throw new PaymentVerificationUnavailableError();
    }
    return data as { success: boolean };
  },
};
