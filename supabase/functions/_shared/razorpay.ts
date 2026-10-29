// Razorpay verification rules shared by create-razorpay-order,
// verify-razorpay-payment and razorpay-webhook, free of any runtime-specific
// API so they can be unit-tested (tests/unit/razorpay.test.mjs).
//
// A payment is only trusted when ALL of these hold — a valid signature alone
// is not enough, because a signature proves "Razorpay really took money for
// THIS razorpay_order_id", not that the money is for THIS application order or
// for the right amount:
//   1. the signature verifies with the server-held secret;
//   2. the application order's recorded gateway order id (set server-side) is
//      the one the payment belongs to;
//   3. Razorpay itself (fetched with our key, not taken from the client) says
//      the payment id, order id, amount and currency are what the application
//      order requires, and that the Razorpay order was created for this very
//      application order; and
//   4. the payment is captured (an authorized-only payment is not money yet).
import { hmacSha256Hex, timingSafeEqual } from './crypto.ts';

/** Checkout callback signature: HMAC-SHA256(`${order_id}|${payment_id}`) keyed with the API key SECRET. */
export async function verifyCheckoutSignature(secret: string, razorpayOrderId: string, razorpayPaymentId: string, signature: string): Promise<boolean> {
  if (!secret || !razorpayOrderId || !razorpayPaymentId || !signature) return false;
  return timingSafeEqual(await hmacSha256Hex(secret, `${razorpayOrderId}|${razorpayPaymentId}`), signature);
}

/** Webhook signature: HMAC-SHA256(raw body) keyed with the WEBHOOK secret (a different secret from the API key secret). */
export async function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string): Promise<boolean> {
  if (!webhookSecret || !signature) return false;
  return timingSafeEqual(await hmacSha256Hex(webhookSecret, rawBody), signature);
}

/** Rupees (a numeric from the database) to integer paise — the unit Razorpay uses. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export interface ExpectedPayment {
  internalOrderId: string;
  orderNumber: string;
  gatewayOrderId: string;
  razorpayPaymentId: string;
  amountPaise: number;
}

export interface RazorpayPayment {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
}

export interface RazorpayOrder {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  receipt?: unknown;
  notes?: unknown;
}

export type PaymentCheckFailure =
  | 'payment_id_mismatch'
  | 'order_id_mismatch'
  | 'order_binding_mismatch'
  | 'currency_mismatch'
  | 'amount_mismatch'
  | 'payment_failed'
  | 'not_captured';

export type PaymentCheck = { ok: true } | { ok: false; reason: PaymentCheckFailure; pending: boolean };

const bad = (reason: PaymentCheckFailure, pending = false): PaymentCheck => ({ ok: false, reason, pending });

export function checkPaymentAgainstOrder(expected: ExpectedPayment, payment: RazorpayPayment, gatewayOrder: RazorpayOrder): PaymentCheck {
  if (payment.id !== expected.razorpayPaymentId) return bad('payment_id_mismatch');
  if (payment.order_id !== expected.gatewayOrderId || gatewayOrder.id !== expected.gatewayOrderId) return bad('order_id_mismatch');

  // The Razorpay order must have been created for THIS application order (create-razorpay-order
  // puts internal_order_id in its notes and the order number in its receipt).
  const notes = gatewayOrder.notes && typeof gatewayOrder.notes === 'object' && !Array.isArray(gatewayOrder.notes) ? (gatewayOrder.notes as Record<string, unknown>) : {};
  const recordedOrder = notes.internal_order_id;
  const bound = typeof recordedOrder === 'string' ? recordedOrder === expected.internalOrderId : gatewayOrder.receipt === expected.orderNumber;
  if (!bound) return bad('order_binding_mismatch');

  if (payment.currency !== 'INR' || gatewayOrder.currency !== 'INR') return bad('currency_mismatch');
  if (payment.amount !== expected.amountPaise || gatewayOrder.amount !== expected.amountPaise) return bad('amount_mismatch');

  if (payment.status === 'captured') return { ok: true };
  if (payment.status === 'failed' || payment.status === 'refunded') return bad('payment_failed');
  // 'created' / 'authorized': not money in the account yet. Not a failure — the
  // webhook confirms the payment if and when it is captured.
  return bad('not_captured', true);
}

/**
 * Payments are recorded with the (public) Key ID of the merchant account that
 * created the Razorpay order. After the account is switched, an order started
 * under the previous merchant can no longer be verified with the new secret —
 * that is reported as a merchant change, never recorded as a failed payment.
 */
export function merchantMatches(recordedKeyId: string | null | undefined, currentKeyId: string): boolean {
  return Boolean(recordedKeyId) && recordedKeyId === currentKeyId;
}

/** Optional pin of webhook events to the client's own Razorpay account (the event's top-level account_id). */
export function webhookAccountAllowed(expectedAccountId: string | undefined, eventAccountId: unknown): boolean {
  if (!expectedAccountId) return true;
  return eventAccountId === expectedAccountId;
}
