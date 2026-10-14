-- Follow-up to 20260825000019: that migration revoked EXECUTE from
-- `anon` specifically, following the pattern that fixed checkout()/
-- update_order_status() in Phase 01/03. It didn't work this time —
-- verified via `has_function_privilege` and, more usefully, via the
-- raw ACL (`proacl`): unlike checkout() (which only ever had
-- role-specific grants), these three functions had EXECUTE granted to
-- the PUBLIC pseudo-role itself (`=X/postgres` in the ACL) — likely
-- because `create function` defaults to a PUBLIC grant in plain
-- Postgres, and whatever Supabase-side mechanism normally overrides
-- that with role-specific anon/authenticated grants instead didn't
-- apply here (still not fully understood — but the fix, verified live
-- both via has_function_privilege and an actual anon REST call, is to
-- revoke from PUBLIC explicitly and re-grant only to `authenticated`).
--
-- Lesson for next time this class of bug shows up: check `proacl`
-- directly rather than assuming which grantee needs revoking.

revoke execute on function add_to_cart(uuid, int) from public;
revoke execute on function set_cart_item_quantity(uuid, int) from public;
revoke execute on function remove_cart_item(uuid) from public;

grant execute on function add_to_cart(uuid, int) to authenticated;
grant execute on function set_cart_item_quantity(uuid, int) to authenticated;
grant execute on function remove_cart_item(uuid) to authenticated;
