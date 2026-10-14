-- Real bug found via the database consistency audit (final pre-launch
-- QA hardening, section 30): COD orders never converted their
-- inventory reservation into a real sale.
--
-- docs/inventory-lifecycle.md documents exactly one path out of
-- "reserved": confirm_payment('paid') -> quantity -= qty,
-- reserved_quantity -= qty ("sold"). But confirm_payment is only ever
-- called by the Razorpay verify Edge Function (gateway payments) — a
-- COD order's payment_status stays 'pending' through its entire
-- fulfillment lifecycle and is flipped straight to 'paid' by a bare
-- UPDATE inside complete_delivery() (see 20260826000077), which never
-- touches inventory at all. Neither advance_order_fulfillment() nor
-- any other function in the pipeline does either. Since this app's
-- default and presumably dominant payment method is COD
-- (app/checkout.tsx defaults paymentMethod to 'cod'), this meant the
-- large majority of real deliveries would silently never decrement
-- inventory.quantity and never release reserved_quantity — live
-- verified: 3 rows in the QA database already show reserved_quantity
-- permanently stuck above what any currently-open order accounts for,
-- left over from earlier COD test runs completing delivery.
--
-- Long-term: quantity keeps overstating real physical stock forever,
-- and reserved_quantity keeps climbing, eventually making
-- available_to_sell (quantity - reserved_quantity) go artificially
-- low/negative-pressure even with real stock on the shelf — a
-- "reservation leak" in the exact sense section 30 asks to audit for.
--
-- Fix: complete_delivery() now performs the identical sale-conversion
-- confirm_payment('paid') already does (quantity -= qty,
-- reserved_quantity = greatest(reserved_quantity - qty, 0), a 'sale'
-- inventory_movements row) for each order_item, but only when the
-- order's payment_status was still 'pending' going into this call —
-- i.e. exactly the COD case. A gateway-paid order was already
-- converted at confirm_payment() time and must not be double-deducted;
-- the payment_status = 'pending' gate (read from the row locked at the
-- top of this function, before the update below) makes that safe.

create or replace function complete_delivery(
  p_assignment_id uuid,
  p_proof_photo_url text,
  p_proof_latitude double precision,
  p_proof_longitude double precision,
  p_cash_collected numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
  v_order orders%rowtype;
  v_item record;
begin
  if p_proof_photo_url is null or btrim(p_proof_photo_url) = '' then
    raise exception 'a delivery proof photo is required to complete this delivery';
  end if;
  if p_proof_latitude is null or p_proof_longitude is null then
    raise exception 'the location where the photo was taken is required to complete this delivery';
  end if;
  if p_proof_latitude not between -90 and 90 or p_proof_longitude not between -180 and 180 then
    raise exception 'invalid proof location';
  end if;

  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid()) then
    raise exception 'not authorized for this delivery';
  end if;
  if v_assignment.status <> 'in_transit' then
    raise exception 'delivery must be out for delivery before it can be completed (current: %)', v_assignment.status;
  end if;
  select * into v_order from orders where id = v_assignment.order_id for update;
  if v_order.status not in ('out_for_delivery', 'approaching') then
    raise exception 'order is not currently out for delivery (current: %)', v_order.status;
  end if;

  -- COD (and any other still-pending-payment order) converts its
  -- reservation to a real sale right here, at the moment it's actually
  -- handed over — a gateway-paid order already did this at
  -- confirm_payment('paid') time and is skipped to avoid double-deducting.
  if v_order.payment_status = 'pending' then
    for v_item in select * from order_items where order_id = v_order.id loop
      update inventory
        set quantity = quantity - v_item.quantity,
            reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
        values (v_order.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', v_order.id, v_assignment.rider_id);
    end loop;
  end if;

  update delivery_assignments set
    status = 'completed',
    completed_at = now(),
    delivery_verification_method = 'photo',
    delivery_proof_photo_url = p_proof_photo_url,
    delivery_proof_latitude = p_proof_latitude,
    delivery_proof_longitude = p_proof_longitude,
    cash_collected = p_cash_collected,
    payment_collection_status = case when p_cash_collected is not null then 'collected' when v_order.payment_status = 'pending' then 'pending' else 'not_applicable' end
  where id = p_assignment_id;

  update orders set
    status = 'delivered',
    delivered_at = now(),
    payment_status = case when payment_status = 'pending' then 'paid' else payment_status end
  where id = v_assignment.order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_completed', jsonb_build_object('verificationMethod', 'photo', 'proofPhotoUrl', p_proof_photo_url, 'proofLatitude', p_proof_latitude, 'proofLongitude', p_proof_longitude, 'cashCollected', p_cash_collected));
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'order_delivered');
end;
$$;

comment on function complete_delivery is 'Photo + location are both mandatory (Zepto/Blinkit pattern) — enforced here, not just in the rider UI. Accepts orders.status of either out_for_delivery or approaching (see mark_order_approaching / "I''ve Reached Destination") as valid pre-completion state. Converts a still-pending (COD) order''s inventory reservation into a real sale at this point — see 20260826000080 — since confirm_payment(''paid'') is gateway-only and never reached by the COD path. Atomic: delivery + order + inventory flip together, in one transaction, or none of them do.';

-- One-off backfill: release the reservation debt that already
-- accumulated in this project's testing history before this fix
-- existed (delivered orders whose inventory was never converted to a
-- sale). orders has no payment_method column (that lives on
-- `payments`) — no need to join it anyway: a gateway-paid order
-- already got its 'sale' movement from confirm_payment() at
-- confirmation time, so "delivered, but no 'sale' movement yet" is by
-- itself exactly the set of COD orders this bug affected. Guarded by
-- inventory_movements so re-running this block a second time is a
-- no-op (nothing left to backfill).
do $$
declare
  v_item record;
begin
  for v_item in
    select oi.*, o.store_id, o.id as order_id
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.status = 'delivered'
      and not exists (
        select 1 from inventory_movements im
        where im.reference_type = 'order' and im.reference_id = o.id
          and im.product_variant_id = oi.product_variant_id
          and im.movement_type = 'sale'
      )
  loop
    update inventory
      set quantity = quantity - v_item.quantity,
          reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
      where store_id = v_item.store_id and product_variant_id = v_item.product_variant_id;

    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id)
      values (v_item.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', v_item.order_id);
  end loop;
end $$;
