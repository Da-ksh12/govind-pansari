-- Final production pass, section 2/3: customer order cancellation
-- already works correctly (server-validated cancellable-status window,
-- atomic inventory release, blocks a second cancel with a clear error
-- — all pre-existing in update_order_status(), unchanged here). Two
-- real gaps found by reading the current function: no reason was ever
-- captured, and store staff were never notified when a CUSTOMER (not
-- staff) cancelled their own order — only a staff-initiated cancel
-- logged an audit event, nobody downstream ever heard about a
-- customer-initiated one until they happened to refresh the order list.

alter table orders add column cancellation_reason text;
alter table orders add column cancelled_by uuid references profiles (id);
alter table orders add column cancelled_at timestamptz;

comment on column orders.cancellation_reason is 'Free-text reason selected by whoever cancelled (customer: one of a fixed set of UI-offered reasons; staff: their own note) — never required to be one of a fixed enum server-side, so a staff cancellation notes field isn''t artificially constrained to customer-facing options.';

-- ===========================================================================
-- update_order_status — full body reproduced (required for CREATE OR
-- REPLACE to change the signature). Only the cancel branch changes:
-- accepts an optional reason, stamps cancelled_by/cancelled_at, and
-- now notifies both the customer (confirmation) and store staff
-- (so they don't keep preparing/packing an order that's already gone)
-- — reusing create_notification()/store_staff_recipient_ids() exactly
-- like every other order-lifecycle notification already does, not a
-- separate mechanism.
-- ===========================================================================
create or replace function update_order_status(p_order_id uuid, p_new_status order_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item record;
  v_is_owner boolean;
  v_is_staff boolean;
  v_staff_id uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;

  v_is_owner := v_order.user_id = auth.uid();
  v_is_staff := is_store_staff(v_order.store_id) or is_admin() or has_permission('orders.cancel');

  if p_new_status = 'cancelled' then
    if not (v_is_owner or v_is_staff) then
      raise exception 'not authorized to cancel this order';
    end if;
    if v_is_owner and not v_is_staff and v_order.status not in ('placed', 'confirmed', 'preparing') then
      raise exception 'this order can no longer be cancelled';
    end if;
    if v_order.status in ('delivered', 'cancelled') then
      raise exception 'order is already %', v_order.status;
    end if;

    for v_item in select * from order_items where order_id = p_order_id loop
      if v_order.payment_status = 'paid' then
        update inventory set quantity = quantity + v_item.quantity
          where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
        insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
        values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'return', 'order', p_order_id, auth.uid());
      else
        update inventory set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
          where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
        insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
        values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, auth.uid());
      end if;
    end loop;

    update orders
      set status = 'cancelled', cancellation_reason = p_reason, cancelled_by = auth.uid(), cancelled_at = now()
      where id = p_order_id;

    if not v_is_owner then
      perform log_audit_event('order_cancelled', 'orders', p_order_id, jsonb_build_object('previousStatus', v_order.status, 'reason', p_reason));
      -- Staff/admin cancelled it on the customer's behalf — the
      -- customer still needs to know their order is gone.
      perform create_notification(
        v_order.user_id, 'order_cancelled', 'order', 'Order Cancelled',
        format('Order #%s has been cancelled.%s', v_order.order_number, case when p_reason is not null then ' Reason: ' || p_reason else '' end),
        jsonb_build_object('orderId', p_order_id), 'high', 'orders', p_order_id
      );
    else
      -- Customer cancelled their own order — confirm it to them (same
      -- notification-center trail every other order event gets, not
      -- just the one-shot toast the screen already shows), and tell
      -- the store so nobody keeps preparing/packing a dead order.
      perform create_notification(
        v_order.user_id, 'order_cancelled', 'order', 'Order Cancelled',
        format('Your order #%s has been cancelled.', v_order.order_number),
        jsonb_build_object('orderId', p_order_id), 'normal', 'orders', p_order_id
      );
      for v_staff_id in select store_staff_recipient_ids(v_order.store_id) loop
        perform create_notification(
          v_staff_id, 'order_cancelled', 'order', 'Order Cancelled by Customer',
          format('Order #%s was cancelled by the customer.%s', v_order.order_number, case when p_reason is not null then ' Reason: ' || p_reason else '' end),
          jsonb_build_object('orderId', p_order_id), 'normal', 'orders', p_order_id
        );
      end loop;
    end if;
    return;
  end if;

  -- Fulfillment-stage advances (confirmed/preparing/packed): staff/admin
  -- only, and only moving forward one recognised stage at a time.
  if not v_is_staff then
    raise exception 'not authorized to change this order''s status';
  end if;
  if p_new_status not in ('confirmed', 'preparing', 'packed') then
    raise exception 'use assign_rider()/update_delivery_status() for delivery-stage transitions';
  end if;

  update orders set status = p_new_status where id = p_order_id;
end;
$$;
