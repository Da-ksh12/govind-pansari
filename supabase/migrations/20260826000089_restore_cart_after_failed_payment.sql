-- Cart/checkout/order state hardening pass.
--
-- Root cause of "cart shows an item, but Checkout says it's empty":
-- create_order_from_cart() deletes cart_items the moment an order is
-- created (necessary so the same cart can't be double-spent while a
-- gateway payment is in flight or retried) — for COD that's correct
-- (order created = purchase committed = cart consumed). But for an
-- online-payment order, the order+reservation is created BEFORE
-- Razorpay even opens, so a cancelled/failed payment left a real order
-- (immediately cancelled by the client) whose cart was already gone —
-- with nothing to restore it, since the frontend never re-adds items
-- to a cart it doesn't know was emptied. The customer's cart_items were
-- really deleted; the app just never told the local store.
--
-- This is the one, narrow, backend-authoritative undo for exactly that
-- case: a just-created order, gateway payment method, payment_status
-- still 'pending' (never confirmed). It releases the reservation,
-- cancels the order, and re-inserts the order's items back into
-- cart_items so checkout can resume with the same cart. Deliberately
-- NOT reused by the general "Cancel Order" action (update_order_status)
-- on a later, already-settled order — reviving a real historical
-- order's cart automatically would violate section 21 of the brief;
-- that case is Buy Again's job.
create or replace function restore_cart_after_failed_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_payment payments%rowtype;
  v_item record;
  v_cart_id uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if v_order.user_id != auth.uid() then
    raise exception 'not authorized';
  end if;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'order is already %', v_order.status;
  end if;

  select * into v_payment from payments where order_id = p_order_id order by created_at desc limit 1;
  if v_payment.id is null or v_payment.method = 'cod' or v_payment.status != 'pending' then
    raise exception 'this order has no recoverable pending gateway payment';
  end if;

  insert into carts (user_id) values (auth.uid())
    on conflict (user_id) do update set updated_at = now()
    returning id into v_cart_id;

  for v_item in select * from order_items where order_id = p_order_id loop
    update inventory set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
      where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
    values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, auth.uid());

    insert into cart_items (cart_id, product_variant_id, quantity, price_snapshot)
    values (v_cart_id, v_item.product_variant_id, v_item.quantity, v_item.unit_price)
    on conflict (cart_id, product_variant_id) do update
      set quantity = cart_items.quantity + excluded.quantity;
  end loop;

  update orders set status = 'cancelled' where id = p_order_id;
  update payments set status = 'failed' where order_id = p_order_id and status = 'pending';
end;
$$;

comment on function restore_cart_after_failed_payment(uuid) is 'Cancels a just-created gateway-payment order whose payment never completed (payment_status still pending) and restores its items to the customer''s cart_items. Never touches an order that reached a final payment outcome or a COD order. See docs/cart-architecture.md.';

revoke all on function restore_cart_after_failed_payment(uuid) from public, anon;
grant execute on function restore_cart_after_failed_payment(uuid) to authenticated;
