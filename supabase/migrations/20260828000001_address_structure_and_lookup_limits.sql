-- Structured delivery addresses, and the rate limit for the Google address lookup.
--
-- 1. addresses gains the fields the new Add Address screen collects: house/flat number, building, floor, street,
--    locality, the provider's formatted address, its place id, the customer's delivery instructions and where the
--    coordinates came from. All nullable, so every existing address stays valid. address_line_1/2 keep being written
--    (composed from these parts) so every screen that reads them today keeps working unchanged.
-- 2. enforce_rate_limit() learns 'places_lookup' (used by the address-lookup Edge Function). Everything else in it is
--    byte-identical to 20260826000104.
-- 3. create_order_from_cart_impl() is copied from 20260827000008 with exactly one change: the delivery_address snapshot
--    stored on the order now also carries the new fields, so a rider/store/admin sees the house number and the
--    delivery instructions the customer typed. (Orders keep a snapshot, never a live read of addresses.)
--
-- Rollback: re-apply 20260826000104's enforce_rate_limit and 20260827000008's create_order_from_cart_impl; the new columns
-- can stay (they are unused by anything else).

-- ---------------------------------------------------------------------
-- 1. Structured address fields
-- ---------------------------------------------------------------------
alter table addresses
  add column house_no text,
  add column building text,
  add column floor text,
  add column street text,
  add column locality text,
  add column formatted_address text,
  add column place_id text,
  add column delivery_instructions text,
  add column geocode_source text;

alter table addresses
  add constraint addresses_geocode_source_valid check (geocode_source is null or geocode_source in ('google', 'osm', 'device', 'manual')),
  add constraint addresses_structured_lengths check (
    coalesce(char_length(house_no), 0) <= 100
    and coalesce(char_length(building), 0) <= 150
    and coalesce(char_length(floor), 0) <= 50
    and coalesce(char_length(street), 0) <= 200
    and coalesce(char_length(locality), 0) <= 200
    and coalesce(char_length(formatted_address), 0) <= 400
    and coalesce(char_length(place_id), 0) <= 400
    and coalesce(char_length(delivery_instructions), 0) <= 500
  );

comment on column addresses.house_no is 'House / flat / shop number, typed by the customer. Never filled in from a geocoder: providers rarely know it in India and a guess is worse than a blank.';
comment on column addresses.formatted_address is 'The provider''s one-line address for the confirmed pin (display only). Serviceability is decided from latitude/longitude, never from this text.';
comment on column addresses.place_id is 'Google place id of the confirmed place, when the customer picked a search result or a reverse-geocoded pin had one. Google permits storing place ids.';
comment on column addresses.geocode_source is 'Where the coordinates were confirmed: google (search or reverse geocode), osm (fallback provider), device (GPS only) or manual (pin dragged with no address lookup).';

-- ---------------------------------------------------------------------
-- 2. Rate limit for address lookups
-- ---------------------------------------------------------------------
create or replace function enforce_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_refill double precision;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  case p_action
    when 'checkout'       then v_capacity := 20; v_refill := 1.0 / 3;   -- burst 20, then 1 per 3s
    when 'review'         then v_capacity := 10; v_refill := 1.0 / 30;
    when 'razorpay_order' then v_capacity := 10; v_refill := 1.0 / 6;
    when 'staff_invite'   then v_capacity := 10; v_refill := 1.0 / 60;
    when 'places_lookup'  then v_capacity := 60; v_refill := 2.0;       -- address search: typing bursts, then 2 per second
    else raise exception 'unknown rate limit action';
  end case;
  if not take_rate_limit_token(p_action || ':' || auth.uid()::text, v_capacity, v_refill) then
    raise exception 'rate_limit_exceeded: too many requests, please wait a moment' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function enforce_rate_limit(text) from public, anon;
grant execute on function enforce_rate_limit(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Order snapshot carries the structured address
-- ---------------------------------------------------------------------
create or replace function create_order_from_cart_impl(p_address_id uuid, p_idempotency_key text, p_payment_method payment_method default 'cod')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing record;
  v_summary jsonb;
  v_cart carts%rowtype;
  v_store_id uuid;
  v_subtotal numeric(10,2);
  v_delivery_fee numeric(10,2);
  v_total numeric(10,2);
  v_line record;
  v_row_count int;
  v_order_id uuid;
  v_address addresses%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required';
  end if;

  select id, order_number, status, total, estimated_delivery_minutes
    into v_existing
  from orders
  where user_id = v_user_id and idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.status = 'cancelled' then
      return jsonb_build_object('success', false, 'code', 'CHECKOUT_ALREADY_PROCESSED', 'message', 'That checkout attempt was already closed. Please place the order again.');
    end if;
    return jsonb_build_object(
      'success', true, 'idempotent', true,
      'orderId', v_existing.id, 'orderNumber', v_existing.order_number,
      'status', v_existing.status, 'total', v_existing.total,
      'estimatedDeliveryMinutes', v_existing.estimated_delivery_minutes
    );
  end if;

  v_summary := resolve_checkout(p_address_id);
  if not (v_summary->>'success')::boolean then
    return v_summary;
  end if;
  if not (v_summary->>'meetsMinimumOrder')::boolean then
    return jsonb_build_object(
      'success', false, 'code', 'BELOW_MINIMUM_ORDER',
      'message', 'Add more items to meet the minimum order value for this area',
      'minimumOrderValue', v_summary->'minimumOrderValue',
      'amountToMinimumOrder', v_summary->'amountToMinimumOrder'
    );
  end if;

  select * into v_cart from carts where user_id = v_user_id;
  select * into v_address from addresses where id = p_address_id and user_id = v_user_id;
  v_store_id := (v_summary->>'storeId')::uuid;
  v_subtotal := (v_summary->>'subtotal')::numeric;
  v_delivery_fee := (v_summary->>'deliveryFee')::numeric;
  v_total := (v_summary->>'total')::numeric;

  begin
    insert into orders (
      user_id, store_id, address_id, delivery_address, status, payment_status,
      subtotal, discount, delivery_fee, tax, total, estimated_delivery_minutes, idempotency_key
    ) values (
      v_user_id, v_store_id, v_address.id,
      jsonb_build_object(
        'label', v_address.label, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
        'address_line_1', v_address.address_line_1, 'address_line_2', v_address.address_line_2,
        'landmark', v_address.landmark, 'city', v_address.city, 'state', v_address.state,
        'postal_code', v_address.postal_code, 'latitude', v_address.latitude, 'longitude', v_address.longitude,
        'house_no', v_address.house_no, 'building', v_address.building, 'floor', v_address.floor,
        'street', v_address.street, 'locality', v_address.locality,
        'formatted_address', v_address.formatted_address, 'place_id', v_address.place_id,
        'delivery_instructions', v_address.delivery_instructions
      ),
      'placed', 'pending',
      v_subtotal, 0, v_delivery_fee, 0, v_total,
      (v_summary->>'estimatedDeliveryMinutes')::int, p_idempotency_key
    ) returning id into v_order_id;

    for v_line in
      select * from jsonb_to_recordset(v_summary->'items') as x(
        "cartItemId" uuid, "productId" uuid, "productVariantId" uuid,
        "productName" text, "variantLabel" text, sku text, image text,
        quantity int, "unitPrice" numeric, mrp numeric, "lineTotal" numeric
      )
    loop
      update inventory
        set reserved_quantity = reserved_quantity + v_line.quantity
        where store_id = v_store_id
          and product_variant_id = v_line."productVariantId"
          and is_available
          and quantity - reserved_quantity >= v_line.quantity;
      get diagnostics v_row_count = row_count;
      if v_row_count = 0 then
        raise exception '% just went out of stock', v_line."productName";
      end if;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_store_id, v_line."productVariantId", v_line.quantity, 'reservation', 'order', v_order_id, v_user_id);
    end loop;

    insert into order_items (
      order_id, product_id, product_variant_id, product_name_snapshot, variant_snapshot,
      sku_snapshot, image_snapshot, quantity, unit_price, mrp, discount, total
    )
    select
      v_order_id, (x->>'productId')::uuid, (x->>'productVariantId')::uuid, x->>'productName', x->>'variantLabel',
      x->>'sku', x->>'image', (x->>'quantity')::int, (x->>'unitPrice')::numeric, (x->>'mrp')::numeric,
      ((x->>'mrp')::numeric - (x->>'unitPrice')::numeric) * (x->>'quantity')::int, (x->>'lineTotal')::numeric
    from jsonb_array_elements(v_summary->'items') x;

    insert into payments (order_id, provider, amount, method, status)
    values (v_order_id, case when p_payment_method = 'cod' then 'cod' else 'razorpay' end, v_total, p_payment_method, 'pending');

    delete from cart_items where cart_id = v_cart.id;

    return jsonb_build_object(
      'success', true, 'idempotent', false,
      'orderId', v_order_id, 'orderNumber', (select order_number from orders where id = v_order_id),
      'status', 'placed', 'total', v_total, 'paymentMethod', p_payment_method,
      'estimatedDeliveryMinutes', (v_summary->>'estimatedDeliveryMinutes')::int
    );
  exception
    when unique_violation then
      select id, order_number, status, total, estimated_delivery_minutes
        into v_existing
      from orders
      where user_id = v_user_id and idempotency_key = p_idempotency_key;

      if v_existing.id is not null then
        if v_existing.status = 'cancelled' then
          return jsonb_build_object('success', false, 'code', 'CHECKOUT_ALREADY_PROCESSED', 'message', 'That checkout attempt was already closed. Please place the order again.');
        end if;
        return jsonb_build_object(
          'success', true, 'idempotent', true,
          'orderId', v_existing.id, 'orderNumber', v_existing.order_number,
          'status', v_existing.status, 'total', v_existing.total,
          'estimatedDeliveryMinutes', v_existing.estimated_delivery_minutes
        );
      end if;
      return jsonb_build_object('success', false, 'code', 'CHECKOUT_ALREADY_PROCESSED', 'message', 'This checkout was already processed');
    when others then
      return jsonb_build_object(
        'success', false, 'code', 'OUT_OF_STOCK',
        'message', 'Sorry, an item in your cart just sold out: ' || sqlerrm
      );
  end;
end;
$$;

comment on function create_order_from_cart_impl(uuid, text, payment_method) is 'Atomic, idempotent checkout (internal; clients call the rate-limited create_order_from_cart wrapper). Replays the existing order for a repeated idempotency_key unless that order was cancelled (a finished attempt — returns CHECKOUT_ALREADY_PROCESSED so the app retries with a fresh key); otherwise validates via resolve_checkout, reserves inventory, creates order+items+payment (the delivery_address snapshot includes the structured address fields), clears the cart. A gateway method leaves payment_status=pending until verify-razorpay-payment (or the Razorpay webhook) calls confirm_payment() with a verified result.';

-- Internal only, exactly as before: reachable through the rate-limited wrapper.
revoke all on function create_order_from_cart_impl(uuid, text, payment_method) from public, anon, authenticated;
