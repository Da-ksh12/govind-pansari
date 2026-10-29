-- QA report TC-21 (packing proceeds with an unavailable product) and
-- TC-22 (an unpaid UPI order proceeds as if it were paid).
--
-- TC-21 — live data showed three orders that went
--   item_unavailable -> exception_resolved (4-34 s later) -> packing_started
--   -> order_packed, and two were delivered and paid in full with the
--   unavailable item still on the order. resolve_order_exception() only
--   flipped orders.has_exception to false; nothing handled the item. The
--   store UI called it from a plain confirm dialog. Now:
--     * advance_order_fulfillment() refuses picking -> packing while ANY
--       item on the order is still 'unavailable' (not just while the
--       has_exception flag is set);
--     * resolve_order_exception() refuses while unavailable items remain —
--       an unavailable item cannot be waved through;
--     * reopen_unavailable_item() is the one resolution path for "we found
--       it after all": the item goes back to pending so it must really be
--       picked, and the exception clears only when no unavailable item is
--       left;
--     * the other resolution is cancelling the order (existing
--       update_order_status(.., 'cancelled', reason), which releases the
--       reservation and notifies the customer).
--   No partial-fulfilment / substitution / refund flow exists in the
--   product rules, so none is invented here — that is a business decision.
--
-- TC-22 — create_order_from_cart() creates the order (and reserves stock)
--   before the gateway opens. Nothing stopped store staff accepting or
--   packing that order while payment was still unverified. Now accept_order
--   and advance_order_fulfillment refuse an order that
--   order_awaits_online_payment(); verify-razorpay-payment remains the only
--   thing that can mark it paid. COD orders are unaffected.
--
-- update_order_status() — its non-cancel branch only checked the TARGET
--   status, never the current one, so it could skip every guard above. The
--   QA Demo Control Panel (20260826000095) legitimately fast-forwards a demo
--   order through it, so it is not removed; it is now limited to qa_test_mode
--   (the existing reversible QA flag), restricted to the exact chain
--   placed -> confirmed -> preparing -> packed, and subject to the same
--   payment and unavailable-item guards. With qa_test_mode off, the function
--   only cancels.
--
-- Rollback: re-apply accept_order / advance_order_fulfillment /
-- resolve_order_exception from 20260825000023 and update_order_status from
-- 20260826000098; drop function reopen_unavailable_item(uuid, text).

-- ---------------------------------------------------------------------
-- accept_order: placed -> confirmed, refused while payment is unverified.
-- ---------------------------------------------------------------------
create or replace function accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to accept this order';
  end if;
  if v_order.status <> 'placed' then
    raise exception 'order is not awaiting acceptance (current status: %)', v_order.status;
  end if;
  if order_awaits_online_payment(p_order_id) then
    raise exception 'this order is waiting for its online payment to be confirmed and cannot be accepted yet';
  end if;

  update orders set status = 'confirmed', accepted_at = now() where id = p_order_id;
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (p_order_id, v_order.store_id, auth.uid(), 'order_accepted');
end;
$$;

-- ---------------------------------------------------------------------
-- advance_order_fulfillment: same strict one-step chain as before, plus
-- the payment guard and the unavailable-item guard.
-- ---------------------------------------------------------------------
create or replace function advance_order_fulfillment(p_order_id uuid, p_new_status order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_pending_items int;
  v_unavailable_items int;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to change this order''s status';
  end if;
  if order_awaits_online_payment(p_order_id) then
    raise exception 'this order is waiting for its online payment to be confirmed and cannot be processed yet';
  end if;

  if v_order.status = 'confirmed' and p_new_status = 'preparing' then
    update orders set status = 'preparing', processing_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'processing_started');

  elsif v_order.status = 'preparing' and p_new_status = 'picking' then
    update orders set status = 'picking', picking_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'picking_started');

  elsif v_order.status = 'picking' and p_new_status = 'packing' then
    select count(*) into v_pending_items from order_items where order_id = p_order_id and picking_status = 'pending';
    if v_pending_items > 0 then
      raise exception 'all items must be picked or marked unavailable first (% still pending)', v_pending_items;
    end if;
    select count(*) into v_unavailable_items from order_items where order_id = p_order_id and picking_status = 'unavailable';
    if v_unavailable_items > 0 then
      raise exception '% item(s) on this order are marked unavailable — reopen the item if it was found, or cancel the order, before packing', v_unavailable_items;
    end if;
    if v_order.has_exception then
      raise exception 'this order has an unresolved item exception — a store manager must resolve it first';
    end if;
    update orders set status = 'packing', packing_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'packing_started');

  elsif v_order.status = 'packing' and p_new_status = 'packed' then
    update orders set status = 'packed', ready_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'order_packed');
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'order_ready_for_pickup');

  else
    raise exception 'invalid status transition from % to % (order_already_processed_or_invalid)', v_order.status, p_new_status;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- resolve_order_exception: manager checkpoint, but it can no longer clear
-- the flag while an item is still unavailable.
-- ---------------------------------------------------------------------
create or replace function resolve_order_exception(p_order_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_unavailable_items int;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
    raise exception 'only a store manager can resolve an order exception';
  end if;
  if not v_order.has_exception then
    raise exception 'this order has no unresolved exception';
  end if;
  select count(*) into v_unavailable_items from order_items where order_id = p_order_id and picking_status = 'unavailable';
  if v_unavailable_items > 0 then
    raise exception '% item(s) are still unavailable — reopen each item if it was found, or cancel the order; an unavailable item cannot simply be waved through', v_unavailable_items;
  end if;

  update orders set has_exception = false where id = p_order_id;
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (p_order_id, v_order.store_id, auth.uid(), 'exception_resolved', jsonb_build_object('notes', p_notes));
end;
$$;

-- ---------------------------------------------------------------------
-- reopen_unavailable_item: "we found it" — back to pending so it has to
-- be genuinely picked; the order's exception clears only once no
-- unavailable item remains.
-- ---------------------------------------------------------------------
create or replace function reopen_unavailable_item(p_order_item_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item order_items%rowtype;
  v_order orders%rowtype;
  v_remaining int;
begin
  select * into v_item from order_items where id = p_order_item_id for update;
  if v_item is null then
    raise exception 'order item not found';
  end if;
  select * into v_order from orders where id = v_item.order_id for update;
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
    raise exception 'only a store manager can reopen an unavailable item';
  end if;
  if v_order.status <> 'picking' then
    raise exception 'items can only be reopened while the order is in the picking stage (current status: %)', v_order.status;
  end if;
  if v_item.picking_status <> 'unavailable' then
    raise exception 'this item is not marked unavailable';
  end if;

  update order_items set picking_status = 'pending', picked_by = null, picked_at = null where id = p_order_item_id;

  select count(*) into v_remaining from order_items where order_id = v_order.id and picking_status = 'unavailable';
  if v_remaining = 0 then
    update orders set has_exception = false where id = v_order.id;
  end if;

  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (v_order.id, v_order.store_id, auth.uid(), 'item_reopened',
      jsonb_build_object('orderItemId', p_order_item_id, 'productName', v_item.product_name_snapshot, 'notes', p_notes));
end;
$$;

revoke all on function reopen_unavailable_item from public, anon;
grant execute on function reopen_unavailable_item to authenticated;

-- ---------------------------------------------------------------------
-- update_order_status: cancellation unchanged; the forward branch is now
-- QA-flag-gated, chain-exact and guarded.
-- ---------------------------------------------------------------------
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
$$;
