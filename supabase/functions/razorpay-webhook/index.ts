// Razorpay -> Govind Pansari server-to-server payment notification.
//
// Why this exists: the app confirms a payment by calling
// verify-razorpay-payment after Razorpay's checkout closes. If the app is
// killed, loses signal or the phone dies between "the bank took the money"
// and that call, the order would sit unpaid until the 15-minute expiry sweep
// cancelled it — with the customer already charged. Razorpay's webhook is
// the authoritative, app-independent record that a payment was captured.
//
// Trust model:
//   * Nothing in the request body is trusted until the X-Razorpay-Signature
//     header (HMAC-SHA256 of the RAW body, keyed with the webhook secret from
//     the Razorpay dashboard — not the API key secret) has been verified.
//   * The order is found from the gateway order id that create-razorpay-order
//     bound to it server-side; the amount and currency must equal the order
//     total (confirm_payment_from_webhook checks that).
//   * Confirmation goes through the same idempotent confirm_payment() as the
//     app's own call, so duplicate / retried / racing deliveries are harmless.
//   * Only a captured payment is acted on. 'payment.failed' is deliberately
//     ignored: Razorpay fires it for each failed attempt, and the customer may
//     still succeed on a retry within the same Razorpay order.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by
// Supabase) and RAZORPAY_WEBHOOK_SECRET (set with `supabase secrets set`).
// Configure the webhook in the Razorpay dashboard with the events
// payment.captured and order.paid, pointing at this function's URL; deploy it
// with --no-verify-jwt because Razorpay does not send a Supabase JWT.
//
// Optional: RAZORPAY_ACCOUNT_ID (the client's "acc_..." id) pins accepted events to
// that merchant account — an event signed with the right webhook secret but from a
// different account is ignored.
import { verifyWebhookSignature, webhookAccountAllowed } from '../_shared/razorpay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
const EXPECTED_ACCOUNT_ID = Deno.env.get('RAZORPAY_ACCOUNT_ID');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface PaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!WEBHOOK_SECRET) {
    // Misconfiguration must be loud, not a silent accept-everything.
    console.error('razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not set; refusing all requests');
    return json({ error: 'webhook is not configured' }, 500);
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!(await verifyWebhookSignature(WEBHOOK_SECRET, rawBody, signature))) {
    console.warn('razorpay-webhook: rejected a request with an invalid signature');
    return json({ error: 'invalid signature' }, 400);
  }

  let event: { event?: string; account_id?: string; payload?: { payment?: { entity?: PaymentEntity } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (!webhookAccountAllowed(EXPECTED_ACCOUNT_ID, event.account_id)) {
    console.warn('razorpay-webhook: ignored an event from a different Razorpay account');
    return json({ received: true, ignored: 'different account' });
  }

  // order.paid and payment.captured both carry the captured payment entity.
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
    return json({ received: true, ignored: event.event ?? 'unknown' });
  }
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id || !payment.id) {
    return json({ received: true, ignored: 'no payment entity' });
  }
  if (payment.status && payment.status !== 'captured') {
    return json({ received: true, ignored: `payment status ${payment.status}` });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_payment_from_webhook`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_gateway_order_id: payment.order_id,
      p_payment_reference: payment.id,
      p_amount_paise: payment.amount,
      p_currency: payment.currency,
      p_provider_response: { razorpay_order_id: payment.order_id, razorpay_payment_id: payment.id, verified: true },
    }),
  });

  if (!res.ok) {
    // A database/transport failure: answer 5xx so Razorpay retries the delivery.
    console.error('razorpay-webhook: confirm_payment_from_webhook failed with status', res.status);
    return json({ error: 'could not record the payment' }, 500);
  }

  const result = (await res.json()) as { outcome?: string; orderId?: string };
  // Outcomes that need a human are logged with ids only (no customer data).
  if (result.outcome === 'amount_mismatch' || result.outcome === 'unknown_order' || result.outcome === 'late_payment_on_cancelled_order') {
    console.error('razorpay-webhook: payment needs manual reconciliation', {
      outcome: result.outcome,
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      orderId: result.orderId ?? null,
    });
  }
  return json({ received: true, outcome: result.outcome ?? 'unknown' });
});
