-- Open admin work, part 1: make the permission system say what it does, and close the order-cancel gap.
--
-- 1. is_admin() now includes the 'admin' admin role. has_permission() and the app's own context ('isSuperAdmin') already treated 'admin' as
--    allowed-everything; only is_admin() excluded it, so an 'admin' could not write coupons, banners, offers or zones, edit names, or use store
--    tools. Granting admin roles stays super-admin-only (assign_admin_role has its own check).
-- 2. Store managers could UPDATE their own store's row directly (name, coordinates, "active"…) although no screen offers it. They keep what the
--    store app actually uses: set_store_accepting_orders() (a security-definer function) and reading the row.
-- 3. Cancelling an order now closes its delivery, open rider requests and open dispatch round, so the rider is free again at once.
-- 4. Two grants that did nothing are removed (operations_manager "orders.manage", support_agent "notifications.send"); four permission names
--    are marked as reserved (no feature checks them).
-- 5. get_delivery_pricing(): the zone's fee, minimum and free-delivery level for a place, so the cart shows what checkout will charge
--    (the cart used a built-in Rs 40; the zones charge Rs 49).
-- 6. The two "default" price fields in app_settings are documented as unused (prices come from delivery_zones).

-- 1 ------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' and (admin_role is null or admin_role in ('super_admin', 'admin')) from profiles where id = auth.uid()), false);
$$;

-- 2 ------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists stores_manager_update on public.stores;

-- 3 ------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.update_order_status(p_order_id uuid, p_new_status order_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders%rowtype;
  v_item record;
  v_is_owner boolean;
  v_is_staff boolean;
  v_staff_id uuid;
  v_assignment delivery_assignments%rowtype;
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

    -- A cancelled order must not keep a rider busy. Until now only the order was cancelled: its delivery stayed "accepted" / "in transit" and
    -- kept the rider unavailable until somebody cancelled it by hand. Close the delivery (same event the "Cancel assignment" button writes),
    -- and any dispatch round and rider request still open for the order.
    for v_assignment in select * from delivery_assignments where order_id = p_order_id and not is_terminal_delivery_status(status) for update loop
      update delivery_assignments set status = 'cancelled', cancelled_at = now() where id = v_assignment.id;
      insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
        values (v_assignment.id, p_order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_cancelled', jsonb_build_object('reason', 'order_cancelled'));
    end loop;
    update delivery_offers set status = 'cancelled', responded_at = coalesce(responded_at, now()) where order_id = p_order_id and status = 'open';
    update delivery_dispatch_rounds set status = 'cancelled', completed_at = coalesce(completed_at, now()) where order_id = p_order_id and status = 'open';

    if not v_is_owner then
      perform log_audit_event('order_cancelled', 'orders', p_order_id, jsonb_build_object('previousStatus', v_order.status, 'reason', p_reason));
      perform create_notification(
        v_order.user_id, 'order_cancelled', 'order', 'Order Cancelled',
        format('Order #%s has been cancelled.%s', v_order.order_number, case when p_reason is not null then ' Reason: ' || p_reason else '' end),
        jsonb_build_object('orderId', p_order_id), 'high', 'orders', p_order_id
      );
    else
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

  -- Forward stages. The real app advances orders through
  -- advance_order_fulfillment(); this branch exists only for the QA Demo
  -- Control Panel, so it requires the qa_test_mode flag and follows the
  -- exact chain placed -> confirmed -> preparing -> packed.
  if not v_is_staff then
    raise exception 'not authorized to change this order''s status';
  end if;
  if not coalesce((select enabled from feature_flags where key = 'qa_test_mode'), false) then
    raise exception 'order status can only be changed here to cancel the order — use the fulfillment actions to move it forward';
  end if;
  if p_new_status not in ('confirmed', 'preparing', 'packed') then
    raise exception 'use assign_rider()/update_delivery_status() for delivery-stage transitions';
  end if;
  if not (
    (v_order.status = 'placed' and p_new_status = 'confirmed')
    or (v_order.status = 'confirmed' and p_new_status = 'preparing')
    or (v_order.status = 'preparing' and p_new_status = 'packed')
  ) then
    raise exception 'invalid status transition from % to %', v_order.status, p_new_status;
  end if;
  if order_awaits_online_payment(p_order_id) then
    raise exception 'this order is waiting for its online payment to be confirmed and cannot be processed yet';
  end if;
  if v_order.has_exception or exists (select 1 from order_items where order_id = p_order_id and picking_status = 'unavailable') then
    raise exception 'this order has an unavailable item and cannot move forward until it is resolved';
  end if;

  update orders set status = p_new_status where id = p_order_id;
end;
$function$;

-- 4 ------------------------------------------------------------------------------------------------------------------------------------
delete from role_permissions
 where (admin_role = 'operations_manager' and permission = 'orders.manage')
    or (admin_role = 'support_agent' and permission = 'notifications.send');

comment on type admin_permission is 'Reserved names with no feature behind them (nothing checks them): orders.manage, orders.refund, products.delete, notifications.send. notifications.view only controls whether the Notifications entry shows in the admin menu; the notifications themselves are always the signed-in admin''s own. See docs/roles-and-permissions.md.';

-- 5 ------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.get_delivery_pricing(p_lat double precision, p_lng double precision)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'deliveryFee', fs.delivery_fee,
      'minimumOrderValue', fs.minimum_order_value,
      'freeDeliveryThreshold', z.free_delivery_threshold,
      'estimatedMinutes', fs.estimated_delivery_minutes)
    from find_serviceable_stores(p_lat, p_lng) fs
    join delivery_zones z on z.id = fs.delivery_zone_id
    order by fs.distance_meters
    limit 1
  ), '{}'::jsonb);
$$;

revoke all on function public.get_delivery_pricing(double precision, double precision) from public, anon;
grant execute on function public.get_delivery_pricing(double precision, double precision) to authenticated;

comment on function public.get_delivery_pricing is 'The delivery fee, minimum order and free-delivery level of the zone that serves a place (nearest serviceable store) — the same numbers resolve_checkout() charges. Empty object when nothing serves the place.';

-- 6 ------------------------------------------------------------------------------------------------------------------------------------
comment on column app_settings.default_delivery_fee is 'UNUSED: nothing reads this. The delivery fee a customer pays is delivery_zones.delivery_fee (edited under Admin > Delivery & pricing).';
comment on column app_settings.default_min_order_value is 'UNUSED: nothing reads this. The minimum order is delivery_zones.minimum_order_value (edited under Admin > Delivery & pricing).';
