-- Same gap as orders_owner_read, one table over: order_items_owner_read
-- never granted a rider access either, so getDeliveryDetail's
-- order_items(id) embed silently came back empty for a rider (not a
-- crash by itself — item count just read wrong — but the same real
-- gap in the same live-tested request). Reuses is_rider_of_order()
-- (SECURITY DEFINER, already safe against the recursion this schema
-- hit fixing orders' own policy) rather than a raw subquery.
drop policy if exists "order_items_owner_read" on order_items;

create policy "order_items_owner_read"
  on order_items for select
  using (
    exists (
      select 1 from orders
      where orders.id = order_items.order_id
        and (orders.user_id = auth.uid() or is_store_staff(orders.store_id) or is_admin())
    )
    or is_rider_of_order(order_id)
  );
