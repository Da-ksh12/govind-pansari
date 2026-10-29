
// Creates a real Razorpay Order for an internal order already placed
// via create_order_from_cart() with a gateway payment method (never
// COD — nothing to pay online there). The amount comes from the
// SERVER's own record of the order total (get_order_for_payment,
// RLS-scoped to the caller), never from anything the client sends —
// a client could otherwise ask Razorpay to create an order for any
// amount it likes. The Key Secret is used here, server-side, only;
// only the public Key ID and the created razorpay_order_id go back
// to the client.
//
// Which Razorpay account an order belongs to is decided entirely by the
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET secrets of this project. The Key ID is
// recorded on the payment row (payments.gateway_key_id) so orders can always be
// reconciled with the merchant account that created them.
import { rupeesToPaise } from '../_shared/razorpay.ts';

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
}

Deno.serve(async (req) => {
  const corsHeaders = { 'Content-Type': 'application/json' };
  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('create-razorpay-order: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
      return new Response(JSON.stringify({ error: 'online payments are not available right now' }), { status: 503, headers: corsHeaders });
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401, headers: corsHeaders });
    }

    const { order_id: orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'order_id is required' }), { status: 400, headers: corsHeaders });
    }

    // Per-customer budget for creating gateway orders (enforce_rate_limit, migration 20260826000104).
    const limitRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/enforce_rate_limit`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: 'razorpay_order' }),
    });
    if (!limitRes.ok && (await limitRes.text()).includes('rate_limit_exceeded')) {
      return new Response(JSON.stringify({ error: 'too many payment attempts — please wait a moment' }), { status: 429, headers: corsHeaders });
    }

    // RLS-scoped as the caller (get_order_for_payment filters by
    // auth.uid() internally) — an order that isn't theirs, or doesn't
    // exist, comes back as a plain error, not a bypass.
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_for_payment`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_order_id: orderId }),
    });
    if (!orderRes.ok) {
      return new Response(JSON.stringify({ error: "order not found, or it isn't yours" }), { status: 404, headers: corsHeaders });
    }
    const order = (await orderRes.json()) as OrderForPayment;

    if (order.paymentMethod === 'cod') {
      return new Response(JSON.stringify({ error: 'this order is cash on delivery — no gateway payment to create' }), { status: 400, headers: corsHeaders });
    }
    if (order.paymentStatus !== 'pending') {
      return new Response(JSON.stringify({ error: `this order's payment is already ${order.paymentStatus}` }), { status: 409, headers: corsHeaders });
    }

    const amountPaise = rupeesToPaise(order.total);
    const razorpayRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.orderNumber,
        notes: { internal_order_id: order.orderId },
      }),
    });

    if (!razorpayRes.ok) {
      // Status only: the body can echo request details.
      console.error('Razorpay order creation failed with status', razorpayRes.status);
      return new Response(JSON.stringify({ error: "couldn't start the payment. Please try again." }), { status: 502, headers: corsHeaders });
    }
    const razorpayOrder = await razorpayRes.json();

    // Bind this razorpay_order_id to this internal order NOW, before handing it to
    // the client — and only from here, with the service role. The binding used to
    // be a function any signed-in customer could call with an id of their choosing
    // (set_payment_gateway_order, now revoked), which let a payment made for one
    // order be attached to another. The caller's ownership of the order was
    // checked above through get_order_for_payment.
    const bindRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bind_payment_gateway_order`, {
      method: 'POST',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_order_id: order.orderId, p_gateway_order_id: razorpayOrder.id, p_gateway_key_id: RAZORPAY_KEY_ID }),
    });
    if (!bindRes.ok) {
      console.error('bind_payment_gateway_order failed with status', bindRes.status);
      return new Response(JSON.stringify({ error: "couldn't start the payment. Please try again." }), { status: 500, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({
        razorpayOrderId: razorpayOrder.id,
        keyId: RAZORPAY_KEY_ID,
        amount: amountPaise,
        currency: 'INR',
        orderNumber: order.orderNumber,
      }),
      { headers: corsHeaders },
    );
  } catch {
    return new Response(JSON.stringify({ error: "couldn't start the payment. Please try again." }), { status: 500, headers: corsHeaders });
  }
});
