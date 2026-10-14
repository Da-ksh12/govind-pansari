-- Follow-up to 20260825000018: revoking EXECUTE from `anon` in the
-- *same* migration as `create function` didn't stick (verified live
-- with has_function_privilege — still true after that migration
-- applied). Same root cause documented in
-- 20260825000015_revoke_anon_execute.sql: Supabase's automatic
-- EXECUTE grant to anon/authenticated on new functions appears to
-- re-apply at/around commit, after an explicit REVOKE earlier in the
-- same transaction. Doing the revoke in its own, later migration (a
-- separate transaction, after that auto-grant has already happened
-- once) is what actually works — confirmed here the same way: checked
-- has_function_privilege before and after.

revoke execute on function add_to_cart(uuid, int) from anon;
revoke execute on function set_cart_item_quantity(uuid, int) from anon;
revoke execute on function remove_cart_item(uuid) from anon;
