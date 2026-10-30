'use client';

import { browserClient } from '../supabase/browser';
import { PaymentVerificationUnavailableError } from '../payments/razorpay';

// The checkout calls, one for one with the mobile app's checkoutRepository: the SAME server functions, so an order placed on the website is
// priced, reserved and paid exactly like one placed in the app. Every price, stock and delivery decision is the server's; this file only asks.

export type PaymentMethod = 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet';

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

export interface RazorpayOrderInfo {
  razorpayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  orderNumber: string;
}

/** One key per checkout ATTEMPT: reused when the same attempt is retried (double tap, timeout and resend), replaced only when the customer starts over. */
export function newIdempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `web-${Date.now().toString(36)}-${random}`;
}

export async function getCheckoutSummary(addressId: string): Promise<CheckoutSummaryResult> {
  const { data, error } = await browserClient().rpc('get_checkout_summary', { p_address_id: addressId });
  if (error) throw new Error(error.message);
  return data as CheckoutSummaryResult;
}

export async function placeOrder(addressId: string, idempotencyKey: string, paymentMethod: PaymentMethod): Promise<PlaceOrderResult> {
  const { data, error } = await browserClient().rpc('create_order_from_cart', {
    p_address_id: addressId,
    p_idempotency_key: idempotencyKey,
    p_payment_method: paymentMethod,
  });
  if (error) throw new Error(error.message);
  return data as PlaceOrderResult;
}

/** Creates the real Razorpay order on the server; the amount is the server's own order total, never anything the browser sends. */
export async function createRazorpayOrder(orderId: string): Promise<RazorpayOrderInfo> {
  // via this site's own server (/api/payments/...): the payment functions are not callable from a browser directly (no CORS), see lib/server/edge.ts
  const response = await fetch('/api/payments/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) }).catch(() => null);
  if (!response?.ok) throw new Error("Couldn't start the payment. Please try again.");
  return (await response.json()) as RazorpayOrderInfo;
}

/**
 * The only place a payment is marked paid: the server verifies Razorpay's signature before it confirms anything.
 *  - success true: verified (or already confirmed by the webhook a moment earlier).
 *  - success false: the server looked at it and refused (a real "no").
 *  - throws PaymentVerificationUnavailableError: no answer (network, 5xx). The money may have been taken: the caller must NOT cancel anything.
 */
export async function verifyRazorpayPayment(input: { orderId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }): Promise<{ success: boolean }> {
  let response: Response;
  try {
    response = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: input.orderId,
        razorpay_order_id: input.razorpayOrderId,
        razorpay_payment_id: input.razorpayPaymentId,
        razorpay_signature: input.razorpaySignature,
      }),
    });
  } catch {
    throw new PaymentVerificationUnavailableError(); // no answer at all: the money may have been taken
  }
  if (response.ok) return (await response.json().catch(() => ({ success: false }))) as { success: boolean };
  // a 4xx is the server looking at this payment and refusing it (or finding it already confirmed, e.g. by the webhook a moment earlier)
  if (response.status >= 400 && response.status < 500) {
    if (response.status === 409) {
      const detail = await response.clone().json().catch(() => null);
      if (typeof detail?.error === 'string' && /already paid/i.test(detail.error)) return { success: true };
    }
    return { success: false };
  }
  throw new PaymentVerificationUnavailableError(); // 5xx / unreachable: unknown, never "failed"
}

/** After a cancelled or failed payment: gives the customer their cart back and releases the reserved stock. Best effort; a 15-minute server sweep is the backstop. */
export async function restoreCartAfterFailedPayment(orderId: string): Promise<void> {
  const { error } = await browserClient().rpc('restore_cart_after_failed_payment', { p_order_id: orderId });
  if (error) throw new Error(error.message);
}
