// Deletes the signed-in customer's own account. Called by the mobile app and by the website's "Delete my account" page with the customer's
// own session token — it never takes a user id from the request, so nobody can delete anyone but themselves.
//
// Two steps, in this order:
//   1. rpc delete_my_account() AS THE CALLER: removes addresses, cart, wishlist, reviews, devices and notifications, strips the personal
//      details from old orders and anonymizes the profile. It refuses (and this function passes the reason on) for staff/rider/admin accounts
//      and for a customer who still has an order on its way.
//   2. soft-deletes the sign-in (auth user) with the service-role key, which has to stay on the server: GoTrue releases the phone number and
//      email and ends every session. A hard delete is not possible because orders and payments keep pointing at the (anonymized) profile.
// If step 2 fails after step 1 succeeded the customer simply presses delete again: step 1 is safe to repeat.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing authorization' }, 401);

    // Who is calling: asked of the auth server itself, never read out of the token by hand.
    const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: authHeader } });
    const who = await whoRes.json().catch(() => null);
    if (!whoRes.ok || !who?.id) return json({ error: 'please sign in again' }, 401);

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_my_account`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!rpcRes.ok) {
      const detail = await rpcRes.text();
      if (detail.includes('active_orders_pending')) {
        return json({ error: 'You have an order that has not been delivered yet. You can delete your account once it is delivered or cancelled.', code: 'active_orders_pending' }, 409);
      }
      if (detail.includes('staff_account_not_self_deletable')) {
        return json({ error: 'This account is a staff, rider or admin account and is managed by the shop. Please contact the shop to close it.', code: 'staff_account' }, 403);
      }
      console.error('delete_my_account failed:', detail);
      return json({ error: 'We could not delete your account just now. Please try again.' }, 502);
    }

    const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${who.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ should_soft_delete: true }),
    });
    if (!delRes.ok) {
      console.error('auth soft-delete failed:', delRes.status, await delRes.text());
      return json({ error: 'Your data was removed but we could not close your sign-in. Please press delete again.' }, 502);
    }

    return json({ success: true });
  } catch (e) {
    console.error('delete-account error:', e);
    return json({ error: 'We could not delete your account just now. Please try again.' }, 500);
  }
});
