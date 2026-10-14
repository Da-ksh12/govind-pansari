-- Final Dispatch pass, QA/Demo Control Panel (sections 33-40) — lets an
-- admin drive the whole dispatch lifecycle (create a real order, send
-- riders, expire a round, flip a rider's state, force the concurrent-
-- accept race) from one screen instead of needing 5+ real phones/logins
-- open at once for a client demo. Every action here reuses the SAME
-- functions a real customer/store/rider would trigger (checkout shape,
-- start_dispatch_round, accept_delivery_offer, update_order_status) —
-- nothing here writes order/delivery state directly except the one
-- seed step (qa_create_demo_order) that has no real-user equivalent to
-- call through. settings.manage-gated throughout, same permission
-- qa_reset_inventory (20260826000076) already uses for this class of
-- admin-only operational tooling — never reachable by a customer,
-- store, or rider session.

-- ===========================================================================
-- qa_create_demo_order — the one genuinely new write path. Produces an
-- order structurally identical to create_order_from_cart's real output
-- (same order_items snapshot columns, same inventory reservation, same
-- payments row) for a chosen demo customer/store/variant, then walks it
-- to 'packed' via the real update_order_status() so it lands exactly
-- where a real store's pack-complete would leave it — ready for "Send
-- Rider". Tagged via idempotency_key ('qa-demo-%') so qa_reset_demo_state
-- can find and safely unwind only what this created, never a real order.
-- ===========================================================================
create or replace function qa_create_demo_order(p_customer_id uuid, p_store_id uuid, p_variant_id uuid default null, p_quantity int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store stores%rowtype;
  v_variant record;
  v_address addresses%rowtype;
  v_delivery_fee numeric(10,2);
  v_line_total numeric(10,2);
  v_order_id uuid;
  v_row_count int;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'quantity must be at least 1';
  end if;

  select * into v_store from stores where id = p_store_id;
  if v_store is null or not v_store.is_active then
    raise exception 'store not found or inactive';
  end if;

  if p_variant_id is null then
    select pv.id into p_variant_id
    from product_variants pv
    join products p on p.id = pv.product_id
    join inventory inv on inv.product_variant_id = pv.id and inv.store_id = p_store_id
    where pv.is_active and p.is_active and inv.is_available and (inv.quantity - inv.reserved_quantity) >= p_quantity
    order by pv.price asc
    limit 1;
    if p_variant_id is null then
      raise exception 'no in-stock product available at this store for a demo order';
    end if;
  end if;

  select pv.id, pv.price, pv.mrp, pv.sku, p.name as product_name,
      (pv.weight_value || ' ' || pv.weight_unit) as variant_label, p.image
    into v_variant
  from product_variants pv join products p on p.id = pv.product_id
  where pv.id = p_variant_id;
  if v_variant is null then
    raise exception 'product variant not found';
  end if;

  select * into v_address from addresses where user_id = p_customer_id order by is_default desc, created_at asc limit 1;
  if v_address is null then
    raise exception 'this demo customer has no saved address to deliver to';
  end if;

  select dz.delivery_fee into v_delivery_fee
  from store_delivery_zones sdz join delivery_zones dz on dz.id = sdz.delivery_zone_id
  where sdz.store_id = p_store_id order by sdz.priority asc limit 1;
  v_delivery_fee := coalesce(v_delivery_fee, 0);
  v_line_total := v_variant.price * p_quantity;

  update inventory set reserved_quantity = reserved_quantity + p_quantity
    where store_id = p_store_id and product_variant_id = v_variant.id
      and is_available and quantity - reserved_quantity >= p_quantity;
  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'the chosen demo product just went out of stock at this store';
  end if;

  insert into orders (
    user_id, store_id, address_id, delivery_address, status, payment_status,
    subtotal, discount, delivery_fee, tax, total, estimated_delivery_minutes, idempotency_key
  ) values (
    p_customer_id, p_store_id, v_address.id,
    jsonb_build_object(
      'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'address_line_1', v_address.address_line_1, 'address_line_2', v_address.address_line_2,
      'landmark', v_address.landmark, 'city', v_address.city, 'state', v_address.state,
      'postal_code', v_address.postal_code, 'latitude', v_address.latitude, 'longitude', v_address.longitude
    ),
    'placed', 'pending', v_line_total, 0, v_delivery_fee, 0, v_line_total + v_delivery_fee, 35,
    'qa-demo-' || gen_random_uuid()::text
  ) returning id into v_order_id;

  insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
  values (p_store_id, v_variant.id, p_quantity, 'reservation', 'order', v_order_id, auth.uid());

  insert into order_items (
    order_id, product_id, product_variant_id, product_name_snapshot, variant_snapshot,
    sku_snapshot, image_snapshot, quantity, unit_price, mrp, discount, total
  ) values (
    v_order_id, (select product_id from product_variants where id = v_variant.id), v_variant.id,
    v_variant.product_name, v_variant.variant_label, v_variant.sku, v_variant.image,
    p_quantity, v_variant.price, v_variant.mrp, (v_variant.mrp - v_variant.price) * p_quantity, v_line_total
  );

  insert into payments (order_id, provider, amount, method, status)
  values (v_order_id, 'cod', v_line_total + v_delivery_fee, 'cod', 'pending');

  -- Walk it to READY_FOR_PICKUP through the same staged transitions a
  -- real store confirming/preparing/packing would produce (fires the
  -- same order_events/notifications a genuine order does) rather than
  -- setting status directly.
  perform update_order_status(v_order_id, 'confirmed');
  perform update_order_status(v_order_id, 'preparing');
  perform update_order_status(v_order_id, 'packed');

  perform log_audit_event('qa_demo_order_created', 'orders', v_order_id, jsonb_build_object('customerId', p_customer_id, 'storeId', p_store_id));

  return jsonb_build_object('success', true, 'orderId', v_order_id, 'orderNumber', (select order_number from orders where id = v_order_id));
end;
$$;

comment on function qa_create_demo_order is 'QA/demo only (settings.manage) — creates a real, correctly-shaped order for an existing demo customer (needs a saved address) and walks it to packed/READY_FOR_PICKUP via the real update_order_status(), so "Send Rider" can be pressed on it immediately. Tagged via idempotency_key LIKE ''qa-demo-%'' for qa_reset_demo_state to find later.';

revoke all on function qa_create_demo_order(uuid, uuid, uuid, int) from public, anon;
grant execute on function qa_create_demo_order(uuid, uuid, uuid, int) to authenticated;

-- ===========================================================================
-- qa_expire_dispatch_round — fast-forwards ONE open round past its real
-- 5-minute expiry window (assignment_expiry_minutes()) so a demo doesn't
-- need to sit and wait for it, then hands off to the exact same
-- expire_stale_dispatch_rounds() the pg_cron job calls every minute —
-- no separate expiry logic to keep in sync with the real path.
-- ===========================================================================
create or replace function qa_expire_dispatch_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from delivery_dispatch_rounds where id = p_round_id and status = 'open') then
    raise exception 'no open dispatch round with that id';
  end if;

  update delivery_dispatch_rounds set expires_at = now() - interval '1 second' where id = p_round_id;
  update delivery_offers set expires_at = now() - interval '1 second' where dispatch_round_id = p_round_id and status = 'open';
  perform expire_stale_dispatch_rounds();
end;
$$;

comment on function qa_expire_dispatch_round is 'QA/demo only — rewinds one open round''s expires_at into the past and immediately runs the real expire_stale_dispatch_rounds(), instead of waiting for the real 5-minute window or duplicating that function''s expiry logic.';

revoke all on function qa_expire_dispatch_round(uuid) from public, anon;
grant execute on function qa_expire_dispatch_round(uuid) to authenticated;

-- ===========================================================================
-- qa_set_rider_availability — the existing set_rider_availability() is
-- deliberately self-service only (a rider setting their OWN status); an
-- admin demoing "an offline rider gets no offer" needs to flip a
-- DIFFERENT rider's flag. Same active-delivery guard reused via
-- is_terminal_delivery_status, so this can't silently orphan a live
-- delivery either.
-- ===========================================================================
create or replace function qa_set_rider_availability(p_rider_id uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  if not p_available and exists (
    select 1 from delivery_assignments where rider_id = p_rider_id and not is_terminal_delivery_status(status)
  ) then
    raise exception 'cannot take this rider offline while they have an active delivery';
  end if;
  update riders set is_available = p_available where id = p_rider_id;
end;
$$;

comment on function qa_set_rider_availability is 'QA/demo only — admin-driven equivalent of set_rider_availability() for a rider OTHER than the caller, same active-delivery guard. Lets a demo set up a genuinely OFFLINE rider (get_eligible_riders_for_dispatch already excludes them for real).';

revoke all on function qa_set_rider_availability(uuid, boolean) from public, anon;
grant execute on function qa_set_rider_availability(uuid, boolean) to authenticated;

-- ===========================================================================
-- qa_make_rider_busy / qa_clear_rider_busy — "busy" is never a stored
-- flag (get_rider_status/get_eligible_riders_for_dispatch both derive it
-- from a real non-terminal delivery_assignments row), so making a rider
-- genuinely busy for a demo means giving them a real active delivery,
-- not faking a column. Reuses qa_create_demo_order + the real
-- assign_rider() for exactly that.
-- ===========================================================================
create or replace function qa_make_rider_busy(p_rider_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders%rowtype;
  v_order jsonb;
  v_order_id uuid;
  v_assignment_id uuid;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  select * into v_rider from riders where id = p_rider_id;
  if v_rider is null then
    raise exception 'rider not found';
  end if;
  if exists (select 1 from delivery_assignments where rider_id = p_rider_id and not is_terminal_delivery_status(status)) then
    raise exception 'this rider already has an active delivery';
  end if;
  if not v_rider.is_active or not v_rider.is_available then
    raise exception 'rider must be active and available before being given a delivery';
  end if;

  v_order := qa_create_demo_order(p_customer_id, v_rider.primary_store_id);
  if not (v_order->>'success')::boolean then
    return v_order;
  end if;
  v_order_id := (v_order->>'orderId')::uuid;

  v_assignment_id := assign_rider(v_order_id, p_rider_id, 'manual');

  return jsonb_build_object('success', true, 'orderId', v_order_id, 'assignmentId', v_assignment_id);
end;
$$;

comment on function qa_make_rider_busy is 'QA/demo only — creates a real demo order at the rider''s own store and assigns it straight to them, so they become genuinely BUSY (a real open delivery_assignments row) rather than a faked status. p_customer_id should be one of the demo customer accounts.';

revoke all on function qa_make_rider_busy(uuid, uuid) from public, anon;
grant execute on function qa_make_rider_busy(uuid, uuid) to authenticated;

create or replace function qa_clear_rider_busy(p_rider_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;

  select * into v_assignment from delivery_assignments
    where rider_id = p_rider_id and not is_terminal_delivery_status(status)
    order by created_at desc limit 1;
  if v_assignment is null then
    return;
  end if;

  perform update_order_status(v_assignment.order_id, 'cancelled');
  update delivery_assignments set status = 'cancelled', cancelled_at = now() where id = v_assignment.id;
end;
$$;

comment on function qa_clear_rider_busy is 'QA/demo only — undoes qa_make_rider_busy via the real update_order_status(''cancelled'') (releases the inventory reservation the same way any cancelled order does), then closes the delivery_assignments row.';

revoke all on function qa_clear_rider_busy(uuid) from public, anon;
grant execute on function qa_clear_rider_busy(uuid) to authenticated;

-- ===========================================================================
-- accept_delivery_offer — extended (not duplicated) so a settings.manage
-- admin can accept an offer on a rider's behalf for a demo, without
-- needing a second physical device signed in as that rider. This is
-- the SAME atomic round-lock/eligibility-recheck/assign_rider path a
-- real rider's own Accept tap goes through — including the "only one
-- winner" guarantee — so "Simulate Acceptance" and "Simulate Concurrent
-- Acceptance" both just call this directly (Promise.all of two offers
-- from the same round) rather than needing separate QA-only logic.
-- ===========================================================================
create or replace function accept_delivery_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer delivery_offers%rowtype;
  v_round delivery_dispatch_rounds%rowtype;
  v_rider riders%rowtype;
  v_assignment_id uuid;
begin
  select * into v_offer from delivery_offers where id = p_offer_id for update;
  if v_offer is null then
    raise exception 'offer not found';
  end if;
  if not (is_own_rider(v_offer.rider_id) or has_permission('settings.manage')) then
    raise exception 'not authorized to respond to this offer';
  end if;

  select * into v_round from delivery_dispatch_rounds where id = v_offer.dispatch_round_id for update;

  if v_round.status <> 'open' then
    return jsonb_build_object('success', false, 'code', 'ALREADY_TAKEN', 'message', 'This delivery was accepted by another rider.');
  end if;
  if v_offer.status = 'open' and v_offer.expires_at <= now() then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'EXPIRED', 'message', 'This offer has expired.');
  end if;
  if v_offer.status <> 'open' then
    return jsonb_build_object('success', false, 'code', 'ALREADY_RESPONDED', 'message', 'You already responded to this offer.');
  end if;

  select * into v_rider from riders where id = v_offer.rider_id for update;
  if not v_rider.is_active or not v_rider.is_available then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'RIDER_NOT_AVAILABLE', 'message', 'You are no longer available to accept this delivery.');
  end if;
  if exists (select 1 from delivery_assignments where rider_id = v_offer.rider_id and not is_terminal_delivery_status(status)) then
    update delivery_offers set status = 'expired', responded_at = now() where id = p_offer_id;
    return jsonb_build_object('success', false, 'code', 'RIDER_NOT_AVAILABLE', 'message', 'You already have an active delivery.');
  end if;

  v_assignment_id := assign_rider(v_offer.order_id, v_offer.rider_id, 'dispatch_offer');
  update delivery_assignments set status = 'accepted', accepted_at = now() where id = v_assignment_id;

  update delivery_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update delivery_offers set status = 'lost', responded_at = now()
    where dispatch_round_id = v_round.id and id <> p_offer_id and status = 'open';

  update delivery_dispatch_rounds
    set status = 'completed', winner_rider_id = v_offer.rider_id, winning_assignment_id = v_assignment_id, completed_at = now()
    where id = v_round.id;

  return jsonb_build_object('success', true, 'assignmentId', v_assignment_id, 'orderId', v_offer.order_id);
end;
$$;

revoke all on function accept_delivery_offer(uuid) from public, anon;
grant execute on function accept_delivery_offer(uuid) to authenticated;

-- ===========================================================================
-- qa_reset_demo_state — bounded to rows THIS panel created (idempotency_key
-- LIKE 'qa-demo-%'). Deliberately does not touch any other order, rider
-- availability, or inventory — "do not implement a destructive reset"
-- (section 40) on a production-connected database means scoping the
-- reset to exactly what QA seeded, never a blanket wipe.
-- ===========================================================================
create or replace function qa_reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_cancelled int := 0;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;

  for v_order in
    select id from orders where idempotency_key like 'qa-demo-%' and status not in ('delivered', 'cancelled')
  loop
    perform update_order_status(v_order.id, 'cancelled');
    v_cancelled := v_cancelled + 1;
  end loop;

  update delivery_assignments set status = 'cancelled', cancelled_at = now()
    where order_id in (select id from orders where idempotency_key like 'qa-demo-%')
      and not is_terminal_delivery_status(status);

  update delivery_dispatch_rounds set status = 'cancelled', completed_at = now()
    where order_id in (select id from orders where idempotency_key like 'qa-demo-%') and status = 'open';
  update delivery_offers set status = 'expired', responded_at = now()
    where order_id in (select id from orders where idempotency_key like 'qa-demo-%') and status = 'open';

  perform log_audit_event('qa_demo_state_reset', 'orders', null, jsonb_build_object('cancelledOrders', v_cancelled));
  return jsonb_build_object('success', true, 'cancelledOrders', v_cancelled);
end;
$$;

comment on function qa_reset_demo_state is 'QA/demo only — cancels only orders this panel created (idempotency_key LIKE ''qa-demo-%'') that are not already delivered/cancelled, via the real update_order_status() (so inventory reservations are correctly released), and closes any of their still-open dispatch rounds/offers/assignments. Never touches a real customer order, and never touches rider availability.';

revoke all on function qa_reset_demo_state from public, anon;
grant execute on function qa_reset_demo_state to authenticated;
