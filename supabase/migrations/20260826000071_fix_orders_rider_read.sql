-- orders_owner_read never granted a rider access to the order they're
-- actually delivering — only the customer, store staff, or admin.
-- Every rider screen that embeds orders(...) from delivery_assignments
-- (getDeliveryDetail, listHistory) got a silently-null embed from RLS
-- rather than an error, and the client code then crashed reading
-- row.orders.order_number off null — "Couldn't load this delivery"
-- on literally every assignment. Same shape of bug as the payments
-- RLS gap fixed earlier (20260826000068). Live-reported by the user
-- tapping into an assigned delivery in the rider app.
drop policy if exists "orders_owner_read" on orders;

create policy "orders_owner_read"
  on orders for select
  using (
    user_id = auth.uid()
    or is_store_staff(store_id)
    or is_admin()
    or exists (select 1 from delivery_assignments da where da.order_id = orders.id and is_own_rider(da.rider_id))
  );
