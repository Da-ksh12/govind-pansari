import { NextResponse } from 'next/server';
import { callEdgeFunction, isSameOrigin } from '@/lib/server/edge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asks the server to create the Razorpay order for one of THIS customer's orders. The amount is the order's own total on the server; nothing the
// browser sends can change it.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { order_id?: unknown } | null;
  if (typeof body?.order_id !== 'string' || !UUID.test(body.order_id)) return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
  return callEdgeFunction('create-razorpay-order', { order_id: body.order_id });
}
