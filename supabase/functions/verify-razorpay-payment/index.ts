// The ONLY place a payment is ever marked paid. A client reporting
// "checkout succeeded" proves nothing by itself — a modified/malicious
// client could fabricate that callback. This recomputes Razorpay's own
// HMAC-SHA256(order_id + "|" + payment_id) signature using the Key
// Secret (server-only) and compares it to what the client returned;
// only a match is trusted. confirm_payment() itself is revoked from
// anon/authenticated (see its migration comment) — it can only be
// called with the service role key, which is used here and nowhere
// else in this function's own request/response path.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;

interface OrderForPayment {
  orderId: string;
  orderNumber: string;
  total: number;
  paymentStatus: string;
  paymentMethod: string;
  gatewayOrderId: string | null;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Defense-in-depth: a fixed-length, constant-time-ish compare so a hex signature match can't leak timing information byte-by-byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const corsHeaders = { 'Content-Type': 'application/json' };
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401, headers: corsHeaders });
    }

    const {
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = await req.json();

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return new Response(JSON.stringify({ error: 'order_id, razorpay_order_id, razorpay_payment_id and razorpay_signature are all required' }), { status: 400, headers: corsHeaders });
    }

    // RLS-scoped ownership check, same as create-razorpay-order.
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_for_payment`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_order_id: orderId }),
    });
    if (!orderRes.ok) {
      return new Response(JSON.stringify({ error: "order not found, or it isn't yours" }), { status: 404, headers: corsHeaders });
    }
    const order = (await orderRes.json()) as OrderForPayment;
    if (order.paymentStatus !== 'pending') {
      return new Response(JSON.stringify({ error: `this order's payment is already ${order.paymentStatus}` }), { status: 409, headers: corsHeaders });
    }

    // CRITICAL: a genuinely-signed (razorpay_order_id, payment_id,
    // signature) triple proves a real payment happened for THAT
    // razorpay_order_id — nothing more. Without this check, a valid
    // payment for a different order of this same customer's could be
    // replayed here to mark THIS order paid for free. gatewayOrderId
    // is set server-side by create-razorpay-order, never by the
    // client, so this comparison can't be spoofed by sending a
    // matching order_id in the request body.
    if (!order.gatewayOrderId || order.gatewayOrderId !== razorpayOrderId) {
      return new Response(JSON.stringify({ success: false, error: 'this payment does not belong to this order' }), { status: 400, headers: corsHeaders });
    }

    const expectedSignature = await hmacSha256Hex(RAZORPAY_KEY_SECRET, `${razorpayOrderId}|${razorpayPaymentId}`);
    const verified = timingSafeEqual(expectedSignature, razorpaySignature);

    const confirmRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_payment`, {
      method: 'POST',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_order_id: orderId,
        p_status: verified ? 'paid' : 'failed',
        p_provider: 'razorpay',
        p_payment_reference: razorpayPaymentId,
        p_provider_response: { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, verified },
      }),
    });
    if (!confirmRes.ok) {
      console.error('confirm_payment failed:', await confirmRes.text());
      return new Response(JSON.stringify({ error: 'payment was verified but could not be recorded — contact support' }), { status: 500, headers: corsHeaders });
    }

    if (!verified) {
      return new Response(JSON.stringify({ success: false, error: 'payment signature did not match' }), { status: 400, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown error' }), { status: 500, headers: corsHeaders });
  }
});
