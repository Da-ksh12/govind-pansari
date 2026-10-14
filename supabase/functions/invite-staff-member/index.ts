// Sends the actual invite email for a staff_invites row already
// created by create_staff_invite() (section: admin-invites-staff-by-
// email follow-up). auth.admin invite endpoints require the service
// role key, which must never reach the client — this function is the
// one place that key is used, and only after re-confirming (via the
// CALLER's own JWT, not service role) that RLS on staff_invites would
// actually let them see this row. Same authorization boundary as
// everywhere else in this app: RLS decides, not this function's own
// logic.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface InviteRow {
  id: string;
  email: string;
  full_name: string;
}

Deno.serve(async (req) => {
  const corsHeaders = { 'Content-Type': 'application/json' };
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401, headers: corsHeaders });
    }

    const { invite_id: inviteId, redirect_to: redirectTo } = await req.json();
    if (!inviteId) {
      return new Response(JSON.stringify({ error: 'invite_id is required' }), { status: 400, headers: corsHeaders });
    }

    // RLS-scoped lookup as the caller — an unauthorized caller (or a
    // guessed/spoofed invite_id they have no rights to) gets an empty
    // result here, not a bypass.
    const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/staff_invites?id=eq.${inviteId}&applied_at=is.null&select=id,email,full_name`, {
      headers: { apikey: ANON_KEY, Authorization: authHeader },
    });
    const rows: InviteRow[] = await lookupRes.json().catch(() => []);
    const invite = rows[0];
    if (!lookupRes.ok || !invite) {
      return new Response(JSON.stringify({ error: 'invite not found, already applied, or not authorized' }), { status: 403, headers: corsHeaders });
    }

    const inviteRes = await fetch(
      `${SUPABASE_URL}/auth/v1/invite${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`,
      {
        method: 'POST',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, data: { full_name: invite.full_name, staff_invite_id: invite.id } }),
      },
    );

    if (!inviteRes.ok) {
      const detail = await inviteRes.text();
      // A duplicate invite attempt (email already has an auth.users row
      // from an earlier invite send) is a real, expected case — surface
      // it plainly rather than as a generic failure.
      const status = inviteRes.status === 422 ? 409 : 502;
      return new Response(JSON.stringify({ error: `couldn't send the invite email: ${detail}` }), { status, headers: corsHeaders });
    }

    // GoTrue's invite response is the created user object — apply the
    // role right now, deterministically, rather than waiting on
    // handle_new_auth_user()'s trigger to maybe catch the moment
    // auth.users.email settles (live-tested: unreliable on its own).
    const createdUser = await inviteRes.json().catch(() => null);
    if (createdUser?.id) {
      const applyRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_staff_invite`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_invite_id: invite.id, p_user_id: createdUser.id }),
      });
      if (!applyRes.ok) {
        // The invite email was already sent successfully — don't fail
        // the whole call over the role-application step; the trigger
        // safety net or a manual retry can still catch it.
        console.error('apply_staff_invite failed:', await applyRes.text());
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown error' }), { status: 500, headers: corsHeaders });
  }
});
