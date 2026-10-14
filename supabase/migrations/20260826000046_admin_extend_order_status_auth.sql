-- Admin Control Center: update_order_status() already lets any
-- is_admin() account cancel any non-terminal order — correctly, with
-- the existing inventory release/restock logic untouched. But a
-- SCOPED admin (operations_manager, granted orders.cancel without
-- being a full is_admin()) would be rejected by v_is_staff's current
-- definition, which only recognises is_store_staff()/is_admin(). This
-- is the one required, minimal change to Phase 05's cancellation path
-- — everything else in the function (the state-machine checks, the
-- stock-release accounting, the staff-only forward-advance branch) is
-- reproduced verbatim, unchanged.

create or replace function update_order_status(p_order_id uuid, p_new_status order_status)
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
        update inventory set reserved_quantity = reserved_quantity - v_item.quantity
          where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
        insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
        values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, auth.uid());
      end if;
    end loop;

    update orders set status = 'cancelled' where id = p_order_id;

    if not v_is_owner then
      perform log_audit_event('order_cancelled', 'orders', p_order_id, jsonb_build_object('previousStatus', v_order.status));
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
