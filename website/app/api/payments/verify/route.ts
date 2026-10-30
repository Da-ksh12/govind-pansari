import { NextResponse } from 'next/server';
import { callEdgeFunction, isSameOrigin } from '@/lib/server/edge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAZORPAY_ID = /^[A-Za-z0-9_]{6,64}$/;
const SIGNATURE = /^[A-Fa-f0-9]{32,128}$/;

// Hands Razorpay's reply to the server, which checks the signature with the secret key (never present in the browser) before any order is marked
// paid. This route only validates the shape of the request and passes it on; it never decides that a payment succeeded.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = b?.order_id;
  const razorpayOrderId = b?.razorpay_order_id;
  const paymentId = b?.razorpay_payment_id;
  const signature = b?.razorpay_signature;
  if (
    typeof orderId !== 'string' || !UUID.test(orderId) ||
    typeof razorpayOrderId !== 'string' || !RAZORPAY_ID.test(razorpayOrderId) ||
    typeof paymentId !== 'string' || !RAZORPAY_ID.test(paymentId) ||
    typeof signature !== 'string' || !SIGNATURE.test(signature)
  ) {
    return NextResponse.json({ error: 'invalid payment details' }, { status: 400 });
  }
  return callEdgeFunction('verify-razorpay-payment', { order_id: orderId, razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature });
}
