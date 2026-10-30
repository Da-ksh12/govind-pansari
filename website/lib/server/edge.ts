import { NextResponse } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from '../env';
import { serverClient } from '../supabase/server';

// The mobile app's Razorpay functions (create-razorpay-order, verify-razorpay-payment) were written for a native app, so they answer no browser
// pre-flight (CORS) request and a browser would refuse to call them from this site. The website's own server calls them instead — server-to-server
// is not subject to CORS — carrying the signed-in customer's own session token. The functions therefore see exactly the same caller as from the
// app, apply the same checks (the order must be this customer's, the amount comes from the server's order total) and need no change.

/** A browser request must come from this site itself: the sign-in cookie must not let another website start a payment for a customer. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // not a browser cross-site request (server-to-server, curl): there is no cookie-riding risk
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
  } catch {
    return false;
  }
}

export async function callEdgeFunction(name: 'create-razorpay-order' | 'verify-razorpay-payment', body: Record<string, string>): Promise<NextResponse> {
  const supabase = await serverClient();
  // getUser() asks Supabase to verify (and, if needed, refresh) the session; only then is the token read.
  const { data: auth } = await supabase.auth.getUser();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!auth.user || !token) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

  try {
    const response = await fetch(`${supabaseUrl()}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supabaseAnonKey() },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    // the function's own status and message pass straight through: the checkout tells "refused" (4xx) from "no answer" (5xx / unreachable)
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The payment service could not be reached.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
