-- Phase 06: real payment gateway (Razorpay), superseding the "gateway
-- methods arrive in Phase 06" note on create_order_from_cart and
-- wiring the confirm_payment() function that has been sitting ready
-- since Phase 01 (service_role only — a client can never mark its own
-- payment paid, see that function's own comment).
--
-- Nothing about the COD path changes: p_payment_method defaults to
-- 'cod', so every existing 2-argument call from the client keeps
-- working exactly as before. A gateway checkout passes the real
-- method and the order is created with payment_status='pending' and
-- a real payments row the Edge Functions (create-razorpay-order /
-- verify-razorpay-payment) fill in via confirm_payment() once the
-- payment is genuinely verified server-side.
-- Postgres treats a changed parameter list as a new overload, not a
-- replacement — drop the old 2-arg signature explicitly so there is
-- exactly one create_order_from_cart again (the multi-migration
-- redefinition gotcha this project has hit before).
drop function if exists create_order_from_cart(uuid, text);

create or replace function create_order_from_cart(p_address_id uuid, p_idempotency_key text, p_payment_method payment_method default 'cod')
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
        'postal_code', v_address.postal_code, 'latitude', v_address.latitude, 'longitude', v_address.longitude
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

comment on function create_order_from_cart(uuid, text, payment_method) is 'Atomic, idempotent checkout. Replays the existing order for a repeated idempotency_key; otherwise validates via resolve_checkout, reserves inventory, creates order+items+payment, clears the cart. p_payment_method defaults to cod (unchanged behaviour); a gateway method leaves payment_status=pending until verify-razorpay-payment calls confirm_payment() with a cryptographically verified result.';

revoke all on function create_order_from_cart(uuid, text, payment_method) from public, anon;
grant execute on function create_order_from_cart(uuid, text, payment_method) to authenticated;

-- ---------------------------------------------------------------------
-- get_order_for_payment(): the one thing the create-razorpay-order
-- Edge Function needs to read — the caller's own order id, store name
-- and (critically) the SERVER's total, never a client-supplied amount.
-- Ordinary RLS (orders_select_own, already in place) would work here
-- too, but a narrow SECURITY DEFINER function keeps the Edge Function
-- from needing broader table access than this one read.
-- ---------------------------------------------------------------------
create or replace function get_order_for_payment(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'orderId', o.id, 'orderNumber', o.order_number, 'total', o.total,
    'paymentStatus', o.payment_status, 'paymentMethod', p.method
  )
  into v_result
  from orders o
  join payments p on p.order_id = o.id
  where o.id = p_order_id and o.user_id = auth.uid();

  if v_result is null then
    raise exception 'order not found';
  end if;
  return v_result;
end;
$$;

revoke all on function get_order_for_payment from public, anon;
grant execute on function get_order_for_payment to authenticated;
