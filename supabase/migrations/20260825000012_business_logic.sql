-- Server-side business logic. Everything in this migration is the
-- enforcement boundary for section 25/26/27 of the spec: checkout,
-- inventory reservation, coupon validation, order status transitions
-- and rider dispatch never happen as raw client table writes — only
-- through these SECURITY DEFINER functions, each doing its own
-- authorization check before touching data.

-- =======================================================================
-- Serviceability / fulfillment-store lookup
-- =======================================================================

create or replace function find_serviceable_stores(customer_lat double precision, customer_lng double precision)
returns table (
  store_id uuid,
  store_name text,
  delivery_zone_id uuid,
  delivery_fee numeric,
  minimum_order_value numeric,
  estimated_delivery_minutes int,
  distance_meters double precision
)
language sql
stable
as $$
  select
    s.id,
    s.name,
    dz.id,
    dz.delivery_fee,
    dz.minimum_order_value,
    dz.estimated_delivery_minutes,
    ST_Distance(s.geog, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  from delivery_zones dz
  join store_delivery_zones sdz on sdz.delivery_zone_id = dz.id
  join stores s on s.id = sdz.store_id
  where dz.is_active
    and s.is_active
    and s.is_accepting_orders
    and ST_Covers(dz.boundary, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  order by sdz.priority asc, 7 asc;
$$;

comment on function find_serviceable_stores is 'Customer location -> zone -> eligible stores, ranked by explicit priority then distance. Does not consider inventory — the caller (checkout, or a "which store has this in stock" browse query) filters further.';

grant execute on function find_serviceable_stores to anon, authenticated;

-- =======================================================================
-- Checkout: the one atomic entry point that turns a cart into an order.
-- Runs as SECURITY DEFINER because it must write inventory/orders/
-- order_items/payments/coupon_usage, none of which grant direct insert
-- to `authenticated`. Everything below happens in the caller's single
-- transaction — any exception raised aborts the whole thing, so there
-- is no path that leaves a half-created order or a dangling
-- reservation.
-- =======================================================================

create or replace function checkout(
  p_address_id uuid,
  p_coupon_code text default null,
  p_payment_method payment_method default 'upi'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart carts%rowtype;
  v_address addresses%rowtype;
  v_store stores%rowtype;
  v_zone record;
  v_item record;
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_coupon coupons%rowtype;
  v_coupon_usage_count int;
  v_order_id uuid;
  v_reserved_count int;
begin
  if v_user_id is null then
    raise exception 'checkout requires an authenticated user';
  end if;

  select * into v_cart from carts where user_id = v_user_id;
  if v_cart is null or v_cart.store_id is null then
    raise exception 'cart is empty';
  end if;

  if not exists (select 1 from cart_items where cart_id = v_cart.id) then
    raise exception 'cart is empty';
  end if;

  select * into v_address from addresses where id = p_address_id and user_id = v_user_id;
  if v_address is null then
    raise exception 'address not found';
  end if;

  select * into v_store from stores where id = v_cart.store_id for update;
  if v_store is null or not v_store.is_active or not v_store.is_accepting_orders then
    raise exception 'store is not currently accepting orders';
  end if;

  -- Confirm the address is still inside a zone this store actually
  -- serves, and grab that zone's delivery terms.
  select dz.id as delivery_zone_id, dz.delivery_fee, dz.minimum_order_value, dz.estimated_delivery_minutes
    into v_zone
  from delivery_zones dz
  join store_delivery_zones sdz on sdz.delivery_zone_id = dz.id
  where sdz.store_id = v_store.id
    and dz.is_active
    and ST_Covers(dz.boundary, v_address.geog)
  order by sdz.priority asc
  limit 1;

  if v_zone is null then
    raise exception 'this address is outside the store''s delivery area';
  end if;

  -- Re-price and validate every line from product_variants/inventory —
  -- never from cart_items.price_snapshot.
  create temporary table tmp_checkout_items on commit drop as
  select
    ci.id as cart_item_id,
    pv.id as product_variant_id,
    pv.product_id,
    p.name as product_name,
    (pv.weight_value || ' ' || pv.weight_unit) as variant_label,
    pv.sku,
    p.image,
    ci.quantity,
    pv.price as unit_price,
    pv.mrp
  from cart_items ci
  join product_variants pv on pv.id = ci.product_variant_id
  join products p on p.id = pv.product_id
  where ci.cart_id = v_cart.id;

  if exists (select 1 from tmp_checkout_items t join product_variants pv on pv.id = t.product_variant_id where not pv.is_active) then
    raise exception 'one or more items in your cart are no longer available';
  end if;

  select coalesce(sum(unit_price * quantity), 0) into v_subtotal from tmp_checkout_items;

  -- Coupon validation — server-side, never trust a client-computed
  -- discount.
  if p_coupon_code is not null then
    select * into v_coupon from coupons where code = p_coupon_code and is_active;
    if v_coupon is null then
      raise exception 'invalid coupon code';
    end if;
    if now() < v_coupon.starts_at or now() > v_coupon.expires_at then
      raise exception 'coupon is not currently valid';
    end if;
    if v_subtotal < v_coupon.min_order_value then
      raise exception 'order does not meet the coupon''s minimum order value';
    end if;
    if v_coupon.usage_limit is not null then
      select count(*) into v_coupon_usage_count from coupon_usage where coupon_id = v_coupon.id;
      if v_coupon_usage_count >= v_coupon.usage_limit then
        raise exception 'coupon usage limit reached';
      end if;
    end if;
    select count(*) into v_coupon_usage_count from coupon_usage where coupon_id = v_coupon.id and user_id = v_user_id;
    if v_coupon_usage_count >= v_coupon.per_user_limit then
      raise exception 'you have already used this coupon';
    end if;

    v_discount := case v_coupon.discount_type
      when 'flat' then v_coupon.discount_value
      else v_subtotal * v_coupon.discount_value / 100
    end;
    if v_coupon.max_discount is not null and v_discount > v_coupon.max_discount then
      v_discount := v_coupon.max_discount;
    end if;
    if v_discount > v_subtotal then
      v_discount := v_subtotal;
    end if;
  end if;

  if v_subtotal < v_zone.minimum_order_value then
    raise exception 'order does not meet the minimum order value for this area';
  end if;

  -- Reserve inventory atomically, one line at a time. The WHERE clause
  -- (not just the SET) is what makes this race-safe: two concurrent
  -- checkouts racing for the last unit will serialize on this row, and
  -- the loser's UPDATE simply matches zero rows.
  for v_item in select * from tmp_checkout_items loop
    update inventory
      set reserved_quantity = reserved_quantity + v_item.quantity
      where store_id = v_store.id
        and product_variant_id = v_item.product_variant_id
        and is_available
        and quantity - reserved_quantity >= v_item.quantity;
    get diagnostics v_reserved_count = row_count;
    if v_reserved_count = 0 then
      raise exception 'insufficient stock for %', v_item.product_name;
    end if;
  end loop;

  -- Everything validated and reserved — create the order.
  insert into orders (
    user_id, store_id, address_id, delivery_address, status, payment_status,
    subtotal, discount, delivery_fee, tax, total, coupon_id, estimated_delivery_minutes
  ) values (
    v_user_id, v_store.id, v_address.id,
    jsonb_build_object(
      'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'address_line_1', v_address.address_line_1, 'address_line_2', v_address.address_line_2,
      'landmark', v_address.landmark, 'city', v_address.city, 'state', v_address.state,
      'postal_code', v_address.postal_code, 'latitude', v_address.latitude, 'longitude', v_address.longitude
    ),
    'placed', 'pending',
    v_subtotal, v_discount, v_zone.delivery_fee, 0,
    v_subtotal - v_discount + v_zone.delivery_fee,
    v_coupon.id, v_zone.estimated_delivery_minutes
  ) returning id into v_order_id;

  insert into order_items (
    order_id, product_id, product_variant_id, product_name_snapshot, variant_snapshot,
    sku_snapshot, image_snapshot, quantity, unit_price, mrp, discount, total
  )
  select
    v_order_id, product_id, product_variant_id, product_name, variant_label,
    sku, image, quantity, unit_price, mrp, 0, unit_price * quantity
  from tmp_checkout_items;

  insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
  select v_store.id, product_variant_id, quantity, 'reservation', 'order', v_order_id, v_user_id
  from tmp_checkout_items;

  insert into payments (order_id, provider, amount, method, status)
  values (v_order_id, case when p_payment_method = 'cod' then 'cod' else 'pending_gateway' end, v_subtotal - v_discount + v_zone.delivery_fee, p_payment_method, 'pending');

  if v_coupon.id is not null then
    insert into coupon_usage (coupon_id, user_id, order_id) values (v_coupon.id, v_user_id, v_order_id);
  end if;

  delete from cart_items where cart_id = v_cart.id;
  update carts set store_id = null where id = v_cart.id;

  return v_order_id;
end;
$$;

comment on function checkout is 'Atomic checkout: validates store/zone/prices/coupon, reserves inventory, creates the order+items+payment. Raises (and rolls the whole transaction back) on any failure — see docs/order-lifecycle.md.';

revoke all on function checkout from public;
grant execute on function checkout to authenticated;

-- =======================================================================
-- Payment confirmation — service_role only. This is the function a
-- payment-gateway webhook Edge Function calls after verifying the
-- provider's signature server-side. The mobile app has no path to mark
-- a payment paid; it can only read payments.status change via Realtime.
-- =======================================================================

create or replace function confirm_payment(
  p_order_id uuid,
  p_status payment_status,
  p_provider text default null,
  p_payment_reference text default null,
  p_provider_response jsonb default null
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
    -- Convert each line's reservation into an actual sale.
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set quantity = quantity - v_item.quantity,
            reserved_quantity = reserved_quantity - v_item.quantity
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', p_order_id, null);
    end loop;

    update orders set payment_status = 'paid', status = case when status = 'placed' then 'confirmed' else status end
      where id = p_order_id;

  elsif p_status = 'failed' then
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set reserved_quantity = reserved_quantity - v_item.quantity
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

comment on function confirm_payment is 'Called only by the payment-gateway webhook handler (service_role). Never callable with the anon/authenticated key — a client can never mark its own payment paid.';

revoke all on function confirm_payment from public, anon, authenticated;

-- =======================================================================
-- Expired-reservation sweep — releases inventory held by orders whose
-- payment never completed. Scheduled by pg_cron (see the cron
-- migration); also safe to call manually as service_role/admin.
-- =======================================================================

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
    for v_item in select * from order_items where order_id = v_order.id loop
      update inventory
        set reserved_quantity = reserved_quantity - v_item.quantity
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id)
      values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', v_order.id);
    end loop;

    update orders set status = 'cancelled', payment_status = 'failed' where id = v_order.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function release_expired_reservations from public, anon, authenticated;

-- =======================================================================
-- Order status transitions (pre-delivery stages + cancellation). Rider-
-- driven delivery stages live in update_delivery_status() below so the
-- order and its delivery_assignment stay in lockstep.
-- =======================================================================

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
  v_is_staff := is_store_staff(v_order.store_id) or is_admin();

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

    -- Release stock: if payment hadn't converted reservation to sale
    -- yet, release the reservation; if it had, restock via a return.
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

grant execute on function update_order_status to authenticated;

-- =======================================================================
-- Rider dispatch
-- =======================================================================

create or replace function assign_rider(p_order_id uuid, p_rider_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_assignment_id uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
    raise exception 'not authorized to assign a rider for this order';
  end if;
  if v_order.status not in ('confirmed', 'preparing', 'packed') then
    raise exception 'order is not ready for rider assignment';
  end if;
  if not exists (select 1 from riders where id = p_rider_id and is_active and is_available) then
    raise exception 'rider is not available';
  end if;

  insert into delivery_assignments (order_id, rider_id, store_id, status)
  values (p_order_id, p_rider_id, v_order.store_id, 'assigned')
  returning id into v_assignment_id;

  update orders set status = 'rider_assigned' where id = p_order_id;
  -- Prevent double-booking: this rider stays unavailable until
  -- update_delivery_status() marks the delivery 'completed' (or the
  -- assignment is cancelled — see the note on that path below).
  update riders set is_available = false where id = p_rider_id;

  return v_assignment_id;
end;
$$;

grant execute on function assign_rider to authenticated;

create or replace function update_delivery_status(p_assignment_id uuid, p_new_status delivery_assignment_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
  v_is_rider boolean;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then
    raise exception 'delivery assignment not found';
  end if;

  v_is_rider := exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid());
  if not (v_is_rider or is_admin() or is_store_staff(v_assignment.store_id)) then
    raise exception 'not authorized to update this delivery';
  end if;

  update delivery_assignments set
    status = p_new_status,
    accepted_at = case when p_new_status = 'accepted' then now() else accepted_at end,
    picked_up_at = case when p_new_status = 'picked_up' then now() else picked_up_at end,
    completed_at = case when p_new_status in ('completed', 'cancelled') then now() else completed_at end
  where id = p_assignment_id;

  if p_new_status = 'picked_up' then
    update orders set status = 'out_for_delivery' where id = v_assignment.order_id;
  elsif p_new_status = 'completed' then
    update orders set
      status = 'delivered',
      payment_status = case when payment_status = 'pending' then 'paid' else payment_status end
    where id = v_assignment.order_id;
    update riders set is_available = true where id = v_assignment.rider_id;
  elsif p_new_status = 'cancelled' then
    -- Frees the rider up for reassignment; the order itself is left
    -- alone here (assign_rider() can be called again for it — the
    -- delivery_assignments_one_active_per_order partial unique index
    -- allows a new row once this one is cancelled).
    update riders set is_available = true where id = v_assignment.rider_id;
  end if;
end;
$$;

comment on function update_delivery_status is 'On ''completed'', a still-pending payment is marked paid — this is the COD collection point; gateway-paid orders are already ''paid'' via confirm_payment() long before delivery.';

grant execute on function update_delivery_status to authenticated;

create or replace function mark_order_approaching(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from orders o
    join delivery_assignments da on da.order_id = o.id and da.status = 'in_transit'
    join riders r on r.id = da.rider_id
    where o.id = p_order_id and r.profile_id = auth.uid() and o.status = 'out_for_delivery'
  ) then
    raise exception 'not authorized, or order is not currently out for delivery';
  end if;
  update orders set status = 'approaching' where id = p_order_id;
end;
$$;

grant execute on function mark_order_approaching to authenticated;

-- =======================================================================
-- Reviews — verified-purchase gated.
-- =======================================================================

create or replace function add_review(p_product_id uuid, p_rating smallint, p_comment text default null, p_images text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item_id uuid;
  v_review_id uuid;
begin
  select oi.id into v_order_item_id
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.product_id = p_product_id and o.user_id = auth.uid() and o.status = 'delivered'
  order by o.placed_at desc
  limit 1;

  if v_order_item_id is null then
    raise exception 'you can only review products from a delivered order';
  end if;

  insert into reviews (product_id, user_id, order_item_id, rating, comment, images, status)
  values (p_product_id, auth.uid(), v_order_item_id, p_rating, p_comment, p_images, 'published')
  returning id into v_review_id;

  return v_review_id;
end;
$$;

grant execute on function add_review to authenticated;
