-- Critical fix, found live via a real pg_cron failure in production
-- logs (not a test): release_expired_reservations() had no floor on
-- reserved_quantity, and — since payment confirmation was never wired
-- up (Phase 06 skipped) — a large backlog of long-pending 'placed'
-- orders had accumulated against shared inventory rows across this
-- project's testing history. When the cron finally tried to reconcile
-- that backlog, it hit a row where the release would go negative,
-- which violates inventory_reserved_quantity_check — and because the
-- whole function ran as one transaction with no per-order isolation,
-- that single bad row rolled back EVERY order in the batch, blocking
-- future legitimate expired-reservation cleanup indefinitely.
--
-- Fix: (1) a GREATEST(...,0) floor everywhere reserved_quantity is
-- decremented, so this specific violation can never recur regardless
-- of root cause, and (2) per-order exception isolation in the batch
-- sweep so one inconsistent row can never block the rest of the batch
-- again. confirm_payment() and update_order_status()'s cancellation
-- path get the same floor for the same defense-in-depth reason, even
-- though — being single-order, single-transaction functions — they
-- were never the actual cause of this specific failure.

create or replace function release_expired_reservations(p_older_than interval default interval '15 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_count int := 0;
begin
  for v_order in
    select * from orders
    where status = 'placed' and payment_status = 'pending' and placed_at < now() - p_older_than
    for update skip locked
  loop
    begin
      for v_item in select * from order_items where order_id = v_order.id loop
        update inventory
          set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
          where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

        insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id)
        values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', v_order.id);
      end loop;

      update orders set status = 'cancelled', payment_status = 'failed' where id = v_order.id;
      v_count := v_count + 1;
    exception when others then
      -- One order's inconsistent inventory state must never block the
      -- rest of the batch — log and move on, don't abort everything.
      raise warning 'release_expired_reservations: failed to release order %: %', v_order.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- confirm_payment(): same floor on the 'failed' branch's reservation release.
create or replace function confirm_payment(
  p_order_id uuid, p_status payment_status, p_provider text default null,
  p_payment_reference text default null, p_provider_response jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;

  update payments
    set status = p_status,
        provider = coalesce(p_provider, provider),
        payment_reference = coalesce(p_payment_reference, payment_reference),
        provider_response = coalesce(p_provider_response, provider_response)
    where order_id = p_order_id;

  if p_status = 'paid' then
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set quantity = quantity - v_item.quantity,
            reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', p_order_id, null);
    end loop;

    update orders set payment_status = 'paid', status = case when status = 'placed' then 'confirmed' else status end
      where id = p_order_id;

  elsif p_status = 'failed' then
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, null);
    end loop;

    update orders set payment_status = 'failed', status = 'cancelled' where id = p_order_id;
  else
    update orders set payment_status = p_status where id = p_order_id;
  end if;
end;
$$;

revoke all on function confirm_payment from public, anon, authenticated;

-- update_order_status(): same floor on its cancellation-path reservation
-- release. Reproduces 20260826000046_admin_extend_order_status_auth.sql
-- verbatim except for that one line, same discipline that migration
-- itself used relative to its own predecessor.
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
        update inventory set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
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
