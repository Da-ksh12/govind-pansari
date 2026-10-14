-- Phase 05: Checkout + Fulfillment Engine + Inventory Reservation +
-- Order Creation.
--
-- Supersedes Phase 01's checkout() function, which was never actually
-- callable end-to-end: it required cart.store_id to already be set, and
-- nothing in Phases 01-04 ever sets it (flagged in docs/cart-
-- architecture.md and every phase since). This migration resolves that
-- by having checkout itself pick the fulfilling store, and adds the two
-- things Phase 01's checkout() never had: idempotency, and a read-only
-- preview the UI can show before the customer commits to an order.
--
-- Reused, not rebuilt: the inventory reservation model (quantity /
-- reserved_quantity, atomic conditional UPDATE), order/order_items
-- snapshot columns, order_status_history audit trigger, and
-- update_order_status()'s cancellation logic are all untouched — they
-- already do exactly what this phase needs.

-- =======================================================================
-- Delivery zones gain a free-delivery threshold, separate from
-- minimum_order_value. minimum_order_value gates whether an order can
-- be placed at all in this zone; free_delivery_threshold is the higher
-- bar above which the (otherwise-payable) delivery_fee is waived. These
-- were being conflated by the frontend's hardcoded 499 constant
-- (hooks/useCartLines.ts), which has no backend enforcement at all.
-- =======================================================================

alter table delivery_zones
  add column free_delivery_threshold numeric(10, 2) check (free_delivery_threshold >= 0);

comment on column delivery_zones.free_delivery_threshold is 'Subtotal at or above which delivery_fee is waived for this zone. Null = never free. Distinct from minimum_order_value (the floor below which checkout is blocked entirely).';

update delivery_zones set free_delivery_threshold = 499 where free_delivery_threshold is null;

-- =======================================================================
-- Idempotency: a client-generated key, unique per user, lets a retried
-- "Place Order" (double tap, network timeout + resend) return the
-- already-created order instead of creating a second one.
-- =======================================================================

alter table orders add column idempotency_key text;

create unique index orders_user_idempotency_key_idx
  on orders (user_id, idempotency_key)
  where idempotency_key is not null;

comment on column orders.idempotency_key is 'Client-generated key for one checkout attempt (stable across retries of that same attempt, regenerated for a genuinely new attempt). create_order_from_cart() checks this first and replays the existing order rather than re-validating/re-reserving.';

-- =======================================================================
-- resolve_checkout: the one place that validates cart/address, selects
-- a fulfilling store, and re-prices every line from live data. Called
-- by both get_checkout_summary (read-only preview) and
-- create_order_from_cart (the real thing) so the two can never
-- disagree. Performs no writes of its own — safe to call as often as
-- the UI likes.
--
-- Returns jsonb. Failure shape: {success:false, code, message, ...}.
-- Success shape: {success:true, storeId, storeName, items[], subtotal,
-- mrpTotal, deliveryFee, meetsMinimumOrder, minimumOrderValue,
-- amountToMinimumOrder, estimatedDeliveryMinutes, total, warnings[]}.
-- =======================================================================

create or replace function resolve_checkout(p_address_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart carts%rowtype;
  v_item_count int;
  v_address addresses%rowtype;
  v_inactive_names jsonb;
  v_store record;
  v_unavailable_names jsonb;
  v_items jsonb;
  v_subtotal numeric(10,2);
  v_mrp_total numeric(10,2);
  v_warnings jsonb := '[]'::jsonb;
  v_delivery_fee numeric(10,2);
  v_meets_minimum boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_cart from carts where user_id = v_user_id;
  if v_cart is null then
    return jsonb_build_object('success', false, 'code', 'CART_EMPTY', 'message', 'Your cart is empty');
  end if;
  select count(*) into v_item_count from cart_items where cart_id = v_cart.id;
  if v_item_count = 0 then
    return jsonb_build_object('success', false, 'code', 'CART_EMPTY', 'message', 'Your cart is empty');
  end if;

  select * into v_address from addresses where id = p_address_id and user_id = v_user_id;
  if v_address is null then
    return jsonb_build_object('success', false, 'code', 'ADDRESS_NOT_FOUND', 'message', 'Please choose a delivery address');
  end if;

  -- Deactivated products/variants are called out distinctly from a
  -- stock shortfall — different customer action either way (remove the
  -- item), but a different, clearer message.
  select jsonb_agg(distinct p.name) into v_inactive_names
  from cart_items ci
  join product_variants pv on pv.id = ci.product_variant_id
  join products p on p.id = pv.product_id
  where ci.cart_id = v_cart.id and (not pv.is_active or not p.is_active);

  if v_inactive_names is not null then
    return jsonb_build_object(
      'success', false, 'code', 'PRODUCT_UNAVAILABLE',
      'message', 'Some items in your cart are no longer available',
      'unavailableItems', v_inactive_names
    );
  end if;

  -- Fulfillment store selection (section 6): among stores that
  -- actually serve this address, pick the nearest one that can fulfill
  -- every cart line from its own stock. No partial fulfillment / no
  -- order-splitting — a store either covers the whole cart or it isn't
  -- a candidate at all.
  select fs.store_id, fs.store_name, fs.delivery_zone_id, fs.delivery_fee,
         fs.minimum_order_value, fs.estimated_delivery_minutes
    into v_store
  from find_serviceable_stores(v_address.latitude, v_address.longitude) fs
  where not exists (
    select 1 from cart_items ci
    join product_variants pv on pv.id = ci.product_variant_id
    where ci.cart_id = v_cart.id
      and not exists (
        select 1 from inventory inv
        where inv.store_id = fs.store_id
          and inv.product_variant_id = ci.product_variant_id
          and inv.is_available
          and (inv.quantity - inv.reserved_quantity) >= ci.quantity
      )
  )
  order by fs.distance_meters
  limit 1;

  if v_store.store_id is null then
    if not exists (select 1 from find_serviceable_stores(v_address.latitude, v_address.longitude)) then
      return jsonb_build_object('success', false, 'code', 'OUTSIDE_SERVICE_AREA', 'message', 'We don''t deliver to this address yet');
    end if;

    select jsonb_agg(distinct p.name) into v_unavailable_names
    from cart_items ci
    join product_variants pv on pv.id = ci.product_variant_id
    join products p on p.id = pv.product_id
    where ci.cart_id = v_cart.id
      and not exists (
        select 1 from find_serviceable_stores(v_address.latitude, v_address.longitude) fs2
        join inventory inv on inv.store_id = fs2.store_id and inv.product_variant_id = ci.product_variant_id
        where inv.is_available and (inv.quantity - inv.reserved_quantity) >= ci.quantity
      );

    return jsonb_build_object(
      'success', false, 'code', 'CART_NOT_FULFILLABLE',
      'message', 'No single store nearby can fulfill your whole cart right now',
      'unavailableItems', coalesce(v_unavailable_names, '[]'::jsonb)
    );
  end if;

  -- Re-price every line from product_variants live — never from
  -- cart_items.price_snapshot — and flag drift as a warning rather than
  -- blocking (the customer sees the real, current price before paying).
  select
    jsonb_agg(jsonb_build_object(
      'cartItemId', ci.id,
      'productId', pv.product_id,
      'productVariantId', pv.id,
      'productName', p.name,
      'variantLabel', pv.weight_value || ' ' || pv.weight_unit,
      'sku', pv.sku,
      'image', p.image,
      'quantity', ci.quantity,
      'unitPrice', pv.price,
      'mrp', pv.mrp,
      'lineTotal', pv.price * ci.quantity,
      'priceChanged', ci.price_snapshot is not null and ci.price_snapshot <> pv.price
    )),
    coalesce(sum(pv.price * ci.quantity), 0),
    coalesce(sum(pv.mrp * ci.quantity), 0)
  into v_items, v_subtotal, v_mrp_total
  from cart_items ci
  join product_variants pv on pv.id = ci.product_variant_id
  join products p on p.id = pv.product_id
  where ci.cart_id = v_cart.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', 'PRICE_CHANGED',
           'productName', p.name,
           'oldPrice', ci.price_snapshot,
           'newPrice', pv.price
         )), '[]'::jsonb)
    into v_warnings
  from cart_items ci
  join product_variants pv on pv.id = ci.product_variant_id
  join products p on p.id = pv.product_id
  where ci.cart_id = v_cart.id
    and ci.price_snapshot is not null and ci.price_snapshot <> pv.price;

  v_delivery_fee := v_store.delivery_fee;
  v_meets_minimum := v_subtotal >= v_store.minimum_order_value;
  if v_meets_minimum and (
    select z.free_delivery_threshold from delivery_zones z where z.id = v_store.delivery_zone_id
  ) is not null and v_subtotal >= (
    select z.free_delivery_threshold from delivery_zones z where z.id = v_store.delivery_zone_id
  ) then
    v_delivery_fee := 0;
  end if;

  return jsonb_build_object(
    'success', true,
    'storeId', v_store.store_id,
    'storeName', v_store.store_name,
    'deliveryZoneId', v_store.delivery_zone_id,
    'items', v_items,
    'subtotal', v_subtotal,
    'mrpTotal', v_mrp_total,
    'discount', v_mrp_total - v_subtotal,
    'deliveryFee', v_delivery_fee,
    'minimumOrderValue', v_store.minimum_order_value,
    'meetsMinimumOrder', v_meets_minimum,
    'amountToMinimumOrder', greatest(0, v_store.minimum_order_value - v_subtotal),
    'estimatedDeliveryMinutes', v_store.estimated_delivery_minutes,
    'total', v_subtotal + v_delivery_fee,
    'warnings', v_warnings
  );
end;
$$;

comment on function resolve_checkout is 'Read-only: validates cart+address, selects the fulfilling store (deterministic, whole-cart, no splitting), re-prices from live data. Shared by get_checkout_summary and create_order_from_cart so they can never disagree. See docs/fulfillment-engine.md.';

revoke all on function resolve_checkout from public, anon;
grant execute on function resolve_checkout to authenticated;

-- =======================================================================
-- get_checkout_summary: the public read-only preview the Checkout
-- screen calls to render the bill before the customer taps Place Order.
-- =======================================================================

create or replace function get_checkout_summary(p_address_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select resolve_checkout(p_address_id);
$$;

comment on function get_checkout_summary is 'Public alias of resolve_checkout — the name the Checkout screen calls, kept distinct so intent is clear at the call site.';

revoke all on function get_checkout_summary from public, anon;
grant execute on function get_checkout_summary to authenticated;

-- =======================================================================
-- create_order_from_cart: the one atomic entry point that turns a cart
-- into an order. Idempotent on (user, idempotency_key). All validation
-- happens first via resolve_checkout with zero mutation, so any
-- expected-business-outcome failure (empty cart, outside service area,
-- unfulfillable, below minimum) returns cleanly with nothing written.
-- Only once everything validates does it reserve inventory and write —
-- wrapped so a race lost at the reservation step (the one thing
-- resolve_checkout's plain SELECT can't fully guarantee under
-- concurrency) rolls back cleanly and reports OUT_OF_STOCK rather than
-- surfacing a raw exception.
-- =======================================================================

create or replace function create_order_from_cart(p_address_id uuid, p_idempotency_key text)
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
    -- Created first (in this same sub-transaction) so the reservation
    -- loop below can write a real order_id into inventory_movements —
    -- that ledger is append-only, never updated after insert.
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
    values (v_order_id, 'cod', v_total, 'cod', 'pending');

    delete from cart_items where cart_id = v_cart.id;

    return jsonb_build_object(
      'success', true, 'idempotent', false,
      'orderId', v_order_id, 'orderNumber', (select order_number from orders where id = v_order_id),
      'status', 'placed', 'total', v_total,
      'estimatedDeliveryMinutes', (v_summary->>'estimatedDeliveryMinutes')::int
    );
  exception
    when unique_violation then
      -- Lost a race to a concurrent retry carrying the same
      -- idempotency key. That other request's order now exists (a
      -- unique-index conflict can only fire once the winner has
      -- committed) — return it instead of a spurious stock error.
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

comment on function create_order_from_cart is 'Atomic, idempotent checkout. Replays the existing order for a repeated idempotency_key; otherwise validates via resolve_checkout, reserves inventory, creates order+items+payment, clears the cart. Payment method is fixed to COD in Phase 05 — gateway methods arrive in Phase 06 (see confirm_payment()).';

revoke all on function create_order_from_cart from public, anon;
grant execute on function create_order_from_cart to authenticated;

-- =======================================================================
-- Phase 01's checkout() is superseded by create_order_from_cart above —
-- it required cart.store_id pre-set, which nothing has ever set, so it
-- was never actually reachable from the app. Dropping rather than
-- leaving two competing "turn a cart into an order" entry points.
-- =======================================================================

drop function if exists checkout(uuid, text, payment_method);
