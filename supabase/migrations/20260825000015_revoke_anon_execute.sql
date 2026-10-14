-- Correction to 20260825000014: `revoke ... from public` does not
-- remove Supabase's own default grant of EXECUTE to `anon` and
-- `authenticated` on newly-created functions in the public schema —
-- that grant is made directly to those roles (via a default-privileges
-- rule Supabase configures per-project), not inherited through PUBLIC.
-- Verified live: `has_function_privilege('anon', 'checkout(...)',
-- 'EXECUTE')` was still `true` after the previous migration.
--
-- The actual fix is revoking from `anon` by name.

revoke execute on function checkout(uuid, text, payment_method) from anon;
revoke execute on function update_order_status(uuid, order_status) from anon;
revoke execute on function assign_rider(uuid, uuid) from anon;
revoke execute on function update_delivery_status(uuid, delivery_assignment_status) from anon;
revoke execute on function mark_order_approaching(uuid) from anon;
revoke execute on function add_review(uuid, smallint, text, text[]) from anon;
revoke execute on function handle_new_auth_user() from anon, authenticated;
revoke execute on function log_order_status_change() from anon, authenticated;
revoke execute on function sync_rider_current_location() from anon, authenticated;

-- confirm_payment / release_expired_reservations / prune_old_rider_locations
-- already had `revoke all ... from public, anon, authenticated` in their
-- defining migrations (explicit role names, not just PUBLIC) — those were
-- correct from the start; only the ones that used the PUBLIC-only revoke
-- pattern in 20260825000014 needed this follow-up.
