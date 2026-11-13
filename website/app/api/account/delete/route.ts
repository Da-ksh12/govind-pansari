import { NextResponse } from 'next/server';
import { callEdgeFunction, isSameOrigin } from '@/lib/server/edge';

// Deletes the signed-in customer's own account. No user id is read from the request: the edge function works out who is calling from the session
// token this site's server attaches, so a customer can only ever delete themselves. The same-origin check keeps another website from riding the
// sign-in cookie to trigger it.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (b?.confirm !== 'DELETE') return NextResponse.json({ error: 'Please type DELETE to confirm.' }, { status: 400 });
  return callEdgeFunction('delete-account', {});
}
