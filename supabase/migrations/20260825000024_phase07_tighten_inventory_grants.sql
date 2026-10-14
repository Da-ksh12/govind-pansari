-- Fixes a real gap surfaced by phase07-store-operations.test.mjs
-- (test 21): the column-level `REVOKE UPDATE (quantity,
-- reserved_quantity) ON inventory FROM authenticated` in
-- 20260825000022 had no effect, because `authenticated` (and `anon`)
-- already hold a broader TABLE-level UPDATE grant on `inventory` —
-- Supabase's default `GRANT ALL ... TO anon, authenticated,
-- service_role` on every public-schema table at project creation. A
-- column-level REVOKE cannot retract privilege that a table-level
-- GRANT already covers; the table-level grant has to be revoked
-- first, then the safe columns re-granted narrowly. Verified live: a
-- direct PATCH of inventory.quantity as a real store manager (who
-- correctly passes the inventory_staff_write RLS policy) returned 204
-- before this fix.

revoke update on inventory from authenticated, anon;
grant update (is_available, reorder_level) on inventory to authenticated;

comment on policy "inventory_staff_write" on inventory is 'RLS restricts which ROWS (via is_store_staff(store_id)/is_admin()); the table-level REVOKE + narrow column-level GRANT above (20260825000024) restricts which COLUMNS — only is_available/reorder_level are directly writable. quantity/reserved_quantity have no UPDATE grant at all for authenticated; only record_inventory_adjustment() (SECURITY DEFINER, runs as the table owner) can change them.';
