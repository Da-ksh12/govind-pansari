// The ONLY place the app's own "checkout finished" callback can mark a payment
// paid (the Razorpay webhook is the other, app-independent path). A client saying
// "checkout succeeded" proves nothing by itself, so a payment is trusted only
// when ALL of this holds (rules in ../_shared/razorpay.ts):
//   * Razorpay's HMAC signature over `${order_id}|${payment_id}` verifies with the
//     server-held Key Secret;
//   * the application order's gateway order id — recorded server-side by
//     create-razorpay-order — is the order the payment belongs to, and was created
//     under the CURRENT merchant account;
//   * Razorpay itself (fetched here with our key, never taken from the client)
//     reports the same payment id, order id, currency INR and an amount equal to
//     the application order's total, for a Razorpay order created for this very
//     application order;
//   * the payment is captured.
// confirm_payment() is revoked from clients; only the service role used here
// (and in the webhook) can call it, and it is idempotent.
import { checkPaymentAgainstOrder, merchantMatches, rupeesToPaise, verifyCheckoutSignature } from '../_shared/razorpay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');

interface OrderForPayment {
  orderId: string;
  orderNumber: string;
  total: number;
  paymentStatus: string;
  paymentMethod: string;
  gatewayOrderId: string | null;
  gatewayKeyId: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function razorpayGet(path: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      headers: { Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}` },
      signal: controller.signal,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    clearTimeout(timer);
  }
}

async function recordPayment(orderId: string, status: 'paid' | 'failed', paymentId: string, response: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_payment`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_order_id: orderId, p_status: status, p_provider: 'razorpay', p_payment_reference: paymentId, p_provider_response: response }),
  });
  if (!res.ok) console.error('confirm_payment failed with status', res.status);
  return res.ok;
}

Deno.serve(async (req) => {
  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('verify-razorpay-payment: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
      return json({ success: false, error: 'payment verification is temporarily unavailable' }, 503);
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization' }, 401);

    const {
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = await req.json();

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return json({ error: 'order_id, razorpay_order_id, razorpay_payment_id and razorpay_signature are all required' }, 400);
    }

    // RLS-scoped ownership check, same as create-razorpay-order.
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_for_payment`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_order_id: orderId }),
    });
    if (!orderRes.ok) return json({ error: "order not found, or it isn't yours" }, 404);
    const order = (await orderRes.json()) as OrderForPayment;
    if (order.paymentStatus !== 'pending') return json({ error: `this order's payment is already ${order.paymentStatus}` }, 409);
    if (order.paymentMethod === 'cod') return json({ error: 'this order is cash on delivery' }, 400);

    // gatewayOrderId is set server-side by create-razorpay-order, never by the client.
    if (!order.gatewayOrderId || order.gatewayOrderId !== razorpayOrderId) {
      return json({ success: false, error: 'this payment does not belong to this order' }, 400);
    }

    // An order started under a previous merchant account cannot be verified with the
    // current secret. That is a change of merchant, not a failed payment: nothing is
    // recorded, so the order is not cancelled as "failed" while money may have moved.
    if (!merchantMatches(order.gatewayKeyId, RAZORPAY_KEY_ID)) {
      console.warn('verify-razorpay-payment: order was started under a different Razorpay merchant', { orderId });
      return json({ success: false, code: 'merchant_changed', error: 'This payment was started before our payment account changed. Please place the order again.' }, 409);
    }

    const signatureOk = await verifyCheckoutSignature(RAZORPAY_KEY_SECRET, razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!signatureOk) {
      // Ids only — never the signature or any card/UPI detail.
      console.warn('verify-razorpay-payment: signature mismatch', { orderId, razorpayOrderId });
      await recordPayment(order.orderId, 'failed', razorpayPaymentId, { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, verified: false, reason: 'signature_mismatch' });
      return json({ success: false, error: 'payment signature did not match' }, 400);
    }

    // Ask Razorpay itself about the payment and its order.
    const [paymentRes, gatewayOrderRes] = await Promise.all([
      razorpayGet(`/payments/${encodeURIComponent(razorpayPaymentId)}`),
      razorpayGet(`/orders/${encodeURIComponent(razorpayOrderId)}`),
    ]);
    if (paymentRes.status >= 500 || gatewayOrderRes.status >= 500 || paymentRes.status === 401 || gatewayOrderRes.status === 401) {
      // Razorpay (or our credentials) cannot answer right now: unknown, not failed. 503 tells
      // the app to treat the outcome as pending — the webhook settles it.
      console.error('verify-razorpay-payment: Razorpay lookup unavailable', { payment: paymentRes.status, order: gatewayOrderRes.status });
      return json({ success: false, code: 'verification_unavailable', error: 'payment verification is temporarily unavailable' }, 503);
    }
    if (!paymentRes.body || !gatewayOrderRes.body || paymentRes.status >= 400 || gatewayOrderRes.status >= 400) {
      console.warn('verify-razorpay-payment: Razorpay does not know this payment/order', { orderId });
      await recordPayment(order.orderId, 'failed', razorpayPaymentId, { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, verified: false, reason: 'unknown_to_razorpay' });
      return json({ success: false, error: 'payment could not be verified' }, 400);
    }

    const check = checkPaymentAgainstOrder(
      {
        internalOrderId: order.orderId,
        orderNumber: order.orderNumber,
        gatewayOrderId: razorpayOrderId,
        razorpayPaymentId,
        amountPaise: rupeesToPaise(order.total),
      },
      paymentRes.body,
      gatewayOrderRes.body,
    );

    if (!check.ok && check.pending) {
      // Authorized but not captured: not money yet, not a failure either.
      return json({ success: false, code: 'payment_pending', error: 'your payment is being confirmed' }, 503);
    }
    if (!check.ok) {
      console.warn('verify-razorpay-payment: payment rejected', { orderId, reason: check.reason });
      await recordPayment(order.orderId, 'failed', razorpayPaymentId, { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, verified: false, reason: check.reason });
      return json({ success: false, error: 'payment could not be verified' }, 400);
    }

    const recorded = await recordPayment(order.orderId, 'paid', razorpayPaymentId, {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      verified: true,
      source: 'app',
      amount_paise: paymentRes.body.amount,
      currency: paymentRes.body.currency,
      key_id: RAZORPAY_KEY_ID,
    });
    if (!recorded) return json({ error: 'payment was verified but could not be recorded — contact support' }, 500);
    return json({ success: true });
  } catch (e) {
    // The error text is not returned: it can carry internals. 503 = unknown outcome, never "failed".
    console.error('verify-razorpay-payment: unexpected error', (e as { name?: string } | null)?.name ?? 'error');
    return json({ success: false, code: 'verification_unavailable', error: 'payment verification is temporarily unavailable' }, 503);
  }
});
