-- Fixes a real regression introduced by 20260826000080 itself, caught
-- immediately by the live test suite (never reached a real user):
-- inventory_movements.created_by references profiles(id), but that
-- migration's new 'sale' insert passed v_assignment.rider_id (a
-- riders.id — a different id space entirely), so every COD
-- complete_delivery() call failed its foreign key check with a 409,
-- rolling back the whole delivery completion. auth.uid() is the
-- correct value here — it's already validated earlier in this same
-- function (the "not authorized for this delivery" check) to be this
-- rider's own profiles.id, and using it (rather than null, the way
-- confirm_payment()'s webhook-context 'sale' movement does) correctly
-- attributes this movement to the rider who actually delivered it.

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

  if v_order.payment_status = 'pending' then
    for v_item in select * from order_items where order_id = v_order.id loop
      update inventory
        set quantity = quantity - v_item.quantity,
            reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
        values (v_order.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', v_order.id, auth.uid());
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

comment on function complete_delivery is 'Photo + location are both mandatory (Zepto/Blinkit pattern) — enforced here, not just in the rider UI. Accepts orders.status of either out_for_delivery or approaching (see mark_order_approaching / "I''ve Reached Destination") as valid pre-completion state. Converts a still-pending (COD) order''s inventory reservation into a real sale at this point — see 20260826000080/81 — since confirm_payment(''paid'') is gateway-only and never reached by the COD path. Atomic: delivery + order + inventory flip together, in one transaction, or none of them do.';
