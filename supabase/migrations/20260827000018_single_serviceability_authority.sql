-- One authoritative answer to "can we deliver here, and from which store?".
--
-- Why this exists (live bug, 2026-10-27): find_serviceable_stores() ran with the CALLER's rights. It reads the
-- qa_test_mode flag, and customers cannot read feature_flags (RLS: settings.view only), so for a customer the flag
-- always read "off" and the 09:00-21:00 opening hours were enforced, while resolve_checkout() (SECURITY DEFINER)
-- saw the flag "on" and ignored hours. Result: the same coordinates were "unavailable" in Add Address / location
-- and "available" at checkout, and a CLOSED store was reported to the customer as "we don't deliver to this
-- location yet" (OUTSIDE_SERVICE_AREA). Four real Agra pins ~0.1-2.7 km from the Vijay Nagar store all failed this way.
--
-- What changes:
--   * store_service_candidates(): the single place that computes, for every active store, its true geodesic
--     distance to the point, whether it is inside the delivery radius, accepting orders and open. Runs with definer
--     rights, so every caller sees the same configuration. Not callable by app users.
--   * Eligibility is DISTANCE based: within app_settings.max_delivery_radius_km (default 10 km, admin-editable).
--     Delivery-zone polygons are no longer used to decide eligibility (they were ~8 km circles that also silently
--     capped the radius); a store's zone now only supplies its fee / minimum order / ETA terms.
--   * find_serviceable_stores(): same signature, now just the eligible rows of the candidates, NEAREST FIRST
--     (store_delivery_zones.priority no longer overrides distance).
--   * check_serviceability(): same shape for serviceable results (+ nearestStore, maxRadiusKm); unserviceable results
--     now say WHY: INVALID_COORDINATES / OUTSIDE_SERVICE_AREA (with the nearest store's distance) / STORE_CLOSED (with
--     opening hours) / STORES_NOT_ACCEPTING_ORDERS / NO_ACTIVE_STORES.
--   * resolve_checkout(): unchanged logic (nearest store that holds the WHOLE cart in stock; nothing is split) but it
--     returns the real reason instead of always "outside service area", and refuses an address with no coordinates.
--   * The qa_force_awas_vikas flag (routed every address to one hard-coded store id) is retired.
--   * Sanjay Place: only the STORE is inactive (it is not a real branch; the row stays for old orders). Its zone is left
--     as it is: zones no longer decide eligibility, so a customer in the Sanjay Place area is simply served by the
--     nearest active store (Vijay Nagar), measured by distance.

-- ---------------------------------------------------------------------
-- 1. The radius is a setting, not a constant
-- ---------------------------------------------------------------------
alter table app_settings
  add column if not exists max_delivery_radius_km numeric(5,2) not null default 10
  check (max_delivery_radius_km > 0 and max_delivery_radius_km <= 50);

comment on column app_settings.max_delivery_radius_km is 'Maximum straight-line distance (km) between a store and a customer for the store to be eligible. One value for every store; the customer app, checkout and order creation all read it through store_service_candidates().';

create or replace function update_app_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;

  update app_settings set
    business_name = coalesce(p_patch->>'businessName', business_name),
    logo_url = coalesce(p_patch->>'logoUrl', logo_url),
    support_phone = coalesce(p_patch->>'supportPhone', support_phone),
    support_email = coalesce(p_patch->>'supportEmail', support_email),
    default_min_order_value = coalesce((p_patch->>'defaultMinOrderValue')::numeric, default_min_order_value),
    default_delivery_fee = coalesce((p_patch->>'defaultDeliveryFee')::numeric, default_delivery_fee),
    default_inventory_reorder_level = coalesce((p_patch->>'defaultInventoryReorderLevel')::int, default_inventory_reorder_level),
    default_low_stock_threshold = coalesce((p_patch->>'defaultLowStockThreshold')::int, default_low_stock_threshold),
    default_max_active_deliveries = coalesce((p_patch->>'defaultMaxActiveDeliveries')::int, default_max_active_deliveries),
    max_delivery_radius_km = coalesce((p_patch->>'maxDeliveryRadiusKm')::numeric, max_delivery_radius_km),
    updated_by = auth.uid()
  where id = true
  returning to_jsonb(app_settings.*) into v_result;

  perform log_audit_event('settings_changed', 'app_settings', null, p_patch);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Every active store with its distance and status for one point (internal)
-- ---------------------------------------------------------------------
create or replace function store_service_candidates(p_lat double precision, p_lng double precision)
returns table (
  store_id uuid,
  store_name text,
  delivery_zone_id uuid,
  delivery_fee numeric,
  minimum_order_value numeric,
  estimated_delivery_minutes integer,
  distance_meters double precision,
  within_radius boolean,
  accepting_orders boolean,
  open_now boolean,
  opening_time time,
  closing_time time
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce((select a.max_delivery_radius_km from app_settings a where a.id), 10)::double precision * 1000.0 as radius_m,
      coalesce((select f.enabled from feature_flags f where f.key = 'qa_test_mode'), false) as ignore_hours,
      (now() at time zone 'Asia/Kolkata')::time as local_time
  ), pt as (
    -- NaN compares greater than every number in Postgres, so it fails the range test like any other bad input.
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g
    where p_lat is not null and p_lng is not null
      and p_lat between -90 and 90 and p_lng between -180 and 180
  )
  select
    s.id, s.name, z.zone_id, z.delivery_fee, z.minimum_order_value, z.estimated_delivery_minutes,
    ST_Distance(s.geog, pt.g),
    ST_Distance(s.geog, pt.g) <= cfg.radius_m,
    s.is_accepting_orders,
    (cfg.ignore_hours or case
       when s.opening_time <= s.closing_time then cfg.local_time between s.opening_time and s.closing_time
       else cfg.local_time >= s.opening_time or cfg.local_time <= s.closing_time
     end),
    s.opening_time, s.closing_time
  from stores s
  cross join pt
  cross join cfg
  cross join lateral (
    select dz.id as zone_id, dz.delivery_fee, dz.minimum_order_value, dz.estimated_delivery_minutes
    from store_delivery_zones sdz
    join delivery_zones dz on dz.id = sdz.delivery_zone_id
    where sdz.store_id = s.id and dz.is_active
    order by sdz.priority, dz.id
    limit 1
  ) z
  where s.is_active;
$$;

comment on function store_service_candidates is 'Internal. Every active store (that has an active zone for its fee/minimum/ETA terms) with its geodesic distance to the point, and whether it is inside max_delivery_radius_km, accepting orders and open now (qa_test_mode ignores hours). The one definition of eligibility; find_serviceable_stores() and check_serviceability() are views of it.';

revoke all on function store_service_candidates(double precision, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The eligible stores, nearest first
-- ---------------------------------------------------------------------
create or replace function find_serviceable_stores(customer_lat double precision, customer_lng double precision)
returns table (
  store_id uuid,
  store_name text,
  delivery_zone_id uuid,
  delivery_fee numeric,
  minimum_order_value numeric,
  estimated_delivery_minutes integer,
  distance_meters double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select c.store_id, c.store_name, c.delivery_zone_id, c.delivery_fee, c.minimum_order_value, c.estimated_delivery_minutes, c.distance_meters
  from store_service_candidates(customer_lat, customer_lng) c
  where c.within_radius and c.accepting_orders and c.open_now
  order by c.distance_meters asc, c.store_id asc;
$$;

comment on function find_serviceable_stores is 'Stores that can serve this point right now (inside the delivery radius, accepting orders, open), nearest first. Runs with definer rights so every caller sees the same configuration.';

-- ---------------------------------------------------------------------
-- 4. The customer-facing answer, with a real reason when it is "no"
-- ---------------------------------------------------------------------
create or replace function check_serviceability(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_radius numeric := coalesce((select a.max_delivery_radius_km from app_settings a where a.id), 10);
  v_stores jsonb;
  v_first record;
  v_nearest record;
  v_closed record;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('serviceable', false, 'reason', 'INVALID_COORDINATES', 'maxRadiusKm', v_radius);
  end if;

  select jsonb_agg(jsonb_build_object(
           'storeId', f.store_id, 'storeName', f.store_name, 'distanceMeters', round(f.distance_meters::numeric, 1)
         ) order by f.distance_meters, f.store_id)
    into v_stores
  from find_serviceable_stores(p_lat, p_lng) f;

  if v_stores is not null then
    select * into v_first from find_serviceable_stores(p_lat, p_lng) order by distance_meters, store_id limit 1;
    return jsonb_build_object(
      'serviceable', true,
      'zoneId', v_first.delivery_zone_id,
      'deliveryFee', v_first.delivery_fee,
      'minimumOrderValue', v_first.minimum_order_value,
      'estimatedDeliveryMinutes', v_first.estimated_delivery_minutes,
      'eligibleStores', v_stores,
      'nearestStore', v_stores->0,
      'maxRadiusKm', v_radius
    );
  end if;

  select * into v_nearest from store_service_candidates(p_lat, p_lng) order by distance_meters, store_id limit 1;
  if v_nearest.store_id is null then
    return jsonb_build_object('serviceable', false, 'reason', 'NO_ACTIVE_STORES', 'maxRadiusKm', v_radius);
  end if;

  -- The nearest store overall is beyond the radius, so every store is.
  if not v_nearest.within_radius then
    return jsonb_build_object(
      'serviceable', false, 'reason', 'OUTSIDE_SERVICE_AREA',
      'maxRadiusKm', v_radius,
      'nearestStore', jsonb_build_object('storeId', v_nearest.store_id, 'storeName', v_nearest.store_name, 'distanceMeters', round(v_nearest.distance_meters::numeric, 1))
    );
  end if;

  -- In range, but nobody can take the order right now: closed, or not accepting.
  select * into v_closed from store_service_candidates(p_lat, p_lng) c
    where c.within_radius and c.accepting_orders and not c.open_now
    order by c.distance_meters, c.store_id limit 1;
  if v_closed.store_id is not null then
    return jsonb_build_object(
      'serviceable', false, 'reason', 'STORE_CLOSED',
      'opensAt', to_char(v_closed.opening_time, 'HH24:MI'), 'closesAt', to_char(v_closed.closing_time, 'HH24:MI'),
      'maxRadiusKm', v_radius,
      'nearestStore', jsonb_build_object('storeId', v_closed.store_id, 'storeName', v_closed.store_name, 'distanceMeters', round(v_closed.distance_meters::numeric, 1))
    );
  end if;

  return jsonb_build_object(
    'serviceable', false, 'reason', 'STORES_NOT_ACCEPTING_ORDERS', 'maxRadiusKm', v_radius,
    'nearestStore', jsonb_build_object('storeId', v_nearest.store_id, 'storeName', v_nearest.store_name, 'distanceMeters', round(v_nearest.distance_meters::numeric, 1))
  );
end;
$$;

comment on function check_serviceability is 'What every customer screen shows for a point: serviceable (with the eligible stores nearest-first, fee, minimum, ETA) or not, with the true reason (INVALID_COORDINATES, OUTSIDE_SERVICE_AREA, STORE_CLOSED, STORES_NOT_ACCEPTING_ORDERS, NO_ACTIVE_STORES). Checkout and order creation use the same candidates.';

-- ---------------------------------------------------------------------
-- 5. Checkout: same eligibility, honest reasons, no coordinates -> no order
-- ---------------------------------------------------------------------
create or replace function resolve_checkout(p_address_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
  v_check jsonb;
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
  if v_address.latitude is null or v_address.longitude is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_COORDINATES', 'message', 'This address has no map location. Please pick it on the map again.');
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

  -- Fulfillment store selection: among stores that actually serve this
  -- address (inside the delivery radius, accepting orders, open), pick the
  -- nearest one that can fulfill every cart line from its own stock. No
  -- partial fulfillment / no order-splitting. A closer store that cannot
  -- fulfill the cart is skipped. `fs.store_id` is a stable tiebreak for two
  -- stores at exactly the same distance.
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
      v_check := check_serviceability(v_address.latitude, v_address.longitude);
      return jsonb_build_object(
        'success', false,
        'code', coalesce(v_check->>'reason', 'OUTSIDE_SERVICE_AREA'),
        'message', case v_check->>'reason'
          when 'STORE_CLOSED' then format('Our stores are closed right now. We deliver between %s and %s.', v_check->>'opensAt', v_check->>'closesAt')
          when 'OUTSIDE_SERVICE_AREA' then format('This address is outside our delivery area (we deliver within %s km of our stores).', trim_scale((v_check->>'maxRadiusKm')::numeric))
          when 'STORES_NOT_ACCEPTING_ORDERS' then 'Our nearby stores are not taking orders right now. Please try again shortly.'
          when 'INVALID_COORDINATES' then 'This address has no valid map location. Please pick it on the map again.'
          else 'We can''t deliver to this address right now.'
        end,
        'opensAt', v_check->'opensAt',
        'closesAt', v_check->'closesAt',
        'maxRadiusKm', v_check->'maxRadiusKm',
        'nearestStore', v_check->'nearestStore'
      );
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

-- ---------------------------------------------------------------------
-- 6. Retire the hard-coded single-store QA switch
-- ---------------------------------------------------------------------
update feature_flags
set enabled = false,
    description = 'RETIRED: this switch routed every address to one hard-coded store and is no longer read by store selection. Safe to ignore.'
where key = 'qa_force_awas_vikas';
