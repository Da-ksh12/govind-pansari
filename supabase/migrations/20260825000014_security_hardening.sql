-- Follow-up hardening from running `supabase db advisors` against the
-- freshly-applied schema. Deliberately a new migration rather than an
-- edit to the ones already applied — see the note in
-- docs/backend-architecture.md.

-- ---------------------------------------------------------------------
-- 1. spatial_ref_sys (an internal PostGIS reference table, not one of
-- ours — created as a side effect of `create extension postgis`) has no
-- RLS, which the linter flags as ERROR-level regardless of the table's
-- origin. NOT fixed here: `alter table spatial_ref_sys enable row
-- level security` fails with "must be owner of table spatial_ref_sys"
-- — it's owned by the extension/superuser role, not the migration
-- role, on Supabase-hosted projects. This is a well-documented,
-- accepted false-positive for Postgres+PostGIS in general (the table
-- holds only static, non-sensitive EPSG reference data — there is
-- nothing to actually protect), not something fixable from a normal
-- migration. Leaving it as a known, permanent advisor finding.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 2. Three functions had a mutable search_path (didn't pin one). None
-- of these are SECURITY DEFINER, so the practical exploit risk was low,
-- but pinning it is a one-line fix and removes the ambiguity entirely.
-- ---------------------------------------------------------------------

alter function set_updated_at() set search_path = public;
alter function generate_order_number() set search_path = public;
alter function find_serviceable_stores(double precision, double precision) set search_path = public;

-- ---------------------------------------------------------------------
-- 3. Postgres grants EXECUTE on new functions to PUBLIC by default —
-- which includes `anon`. The mutating RPCs below only ever explicitly
-- *added* a grant for `authenticated`; they never revoked the implicit
-- PUBLIC one first, so an unauthenticated request technically retained
-- the ability to call them (each still requires the caller to satisfy
-- the function's own internal auth.uid()-based check to do anything —
-- an anon caller has no auth.uid() and would fail every one of them —
-- but "the internal logic happens to reject you" is not the same
-- guarantee as "you never had the privilege," so tightening it here.
-- ---------------------------------------------------------------------

revoke execute on function checkout(uuid, text, payment_method) from public;
revoke execute on function update_order_status(uuid, order_status) from public;
revoke execute on function assign_rider(uuid, uuid) from public;
revoke execute on function update_delivery_status(uuid, delivery_assignment_status) from public;
revoke execute on function mark_order_approaching(uuid) from public;
revoke execute on function add_review(uuid, smallint, text, text[]) from public;

-- (each already has `grant execute ... to authenticated` from its
-- defining migration, which still stands — only the PUBLIC/anon grant
-- is being removed here)

-- Trigger functions are never meant to be called directly (they read
-- NEW/OLD, which only exist during an actual trigger firing) — remove
-- their implicit public-callable surface too, for the same reason.
revoke execute on function handle_new_auth_user() from public;
revoke execute on function log_order_status_change() from public;
revoke execute on function sync_rider_current_location() from public;

-- is_admin(), is_store_staff(), current_profile_role(), and
-- find_serviceable_stores() are deliberately left executable by
-- anon/authenticated (the default) — they're evaluated inside RLS
-- policies themselves (e.g. `products_public_read using (is_active or
-- is_admin())`), including for anonymous catalogue browsing, so both
-- roles must be able to call them.
