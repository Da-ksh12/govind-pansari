// Creates a real Razorpay Order for an internal order already placed
// via create_order_from_cart() with a gateway payment method (never
// COD — nothing to pay online there). The amount comes from the
// SERVER's own record of the order total (get_order_for_payment,
// RLS-scoped to the caller), never from anything the client sends —
// a client could otherwise ask Razorpay to create an order for any
// amount it likes. The Key Secret is used here, server-side, only;
// only the public Key ID and the created razorpay_order_id go back
// to the client.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!;
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401, headers: corsHeaders });
    }

    const { order_id: orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'order_id is required' }), { status: 400, headers: corsHeaders });
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

    const amountPaise = Math.round(order.total * 100);
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
      const detail = await razorpayRes.text();
      console.error('Razorpay order creation failed:', detail);
      return new Response(JSON.stringify({ error: "couldn't start the payment. Please try again." }), { status: 502, headers: corsHeaders });
    }
    const razorpayOrder = await razorpayRes.json();

    // Bind this razorpay_order_id to this internal order NOW, before
    // handing it to the client. Without this, verify-razorpay-payment
    // has no record of which gateway order belongs to which internal
    // order, and a genuine signed payment for a different order of the
    // same customer's could be replayed here (found in security audit,
    // fixed together with the check in verify-razorpay-payment).
    const bindRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_payment_gateway_order`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_order_id: order.orderId, p_gateway_order_id: razorpayOrder.id }),
    });
    if (!bindRes.ok) {
      console.error('set_payment_gateway_order failed:', await bindRes.text());
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
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown error' }), { status: 500, headers: corsHeaders });
  }
});
