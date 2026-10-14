-- Found during a full store-routing re-verification pass: at an exact
-- distance tie between two eligible, cart-fulfilling stores (tested
-- directly at the literal geographic midpoint between Vijay Nagar and
-- Awas Vikas), `order by fs.distance_meters limit 1` has no secondary
-- tiebreak, so which store wins at a perfect tie isn't guaranteed
-- deterministic. Extremely unlikely in real customer addresses, but
-- cheap and worth closing properly rather than leaving as a real,
-- if rare, source of "why did it pick that store" confusion. Adding
-- store_id as a stable secondary sort key — full body reproduced
-- (Postgres requires that for CREATE OR REPLACE), only that one ORDER
-- BY clause changed from 20260825000021.

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
  -- order-splitting. `fs.store_id` is a secondary, stable tiebreak for
  -- the (rare) case of two stores at an exactly equal distance.
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
  order by fs.distance_meters, fs.store_id
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
