-- 20260826000071 broke orders reads for EVERYONE (including
-- customers reading their own order) with "infinite recursion
-- detected in policy for relation orders" — caught immediately via
-- live testing, never reached a real user. Root cause: it put a raw
-- `select ... from delivery_assignments` subquery directly inside
-- orders' own RLS policy. A raw cross-table subquery in a USING
-- clause runs as the CALLING user, so it re-triggers
-- delivery_assignments' own RLS evaluation, which this schema has
-- already hit this exact recursion trap on once before (see
-- 20260825000028_phase08_fix_rls_recursion.sql's is_own_rider() /
-- is_customer_of_rider_delivery() — the established fix is always a
-- SECURITY DEFINER helper, never a raw subquery, since a SECURITY
-- DEFINER function's own internal queries run RLS-exempt).
create or replace function is_rider_of_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from delivery_assignments da
    where da.order_id = target_order_id and is_own_rider(da.rider_id)
  );
$$;

comment on function is_rider_of_order is 'RLS helper: is the calling user a rider who has ever been assigned this order? SECURITY DEFINER so this function''s own delivery_assignments read never re-triggers that table''s RLS policies while orders'' own policy is still being evaluated (the exact recursion this schema hit once before — see is_own_rider''s comment).';

revoke all on function is_rider_of_order from public, anon, authenticated;
grant execute on function is_rider_of_order to public;

drop policy if exists "orders_owner_read" on orders;

create policy "orders_owner_read"
  on orders for select
  using (
    user_id = auth.uid()
    or is_store_staff(store_id)
    or is_admin()
    or is_rider_of_order(id)
  );
