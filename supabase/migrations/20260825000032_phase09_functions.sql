-- Phase 09 functions: secure location ingestion (with validation and
-- outlier flagging) and the one read function the customer/store/
-- rider tracking screens use. Route/ETA computation itself is
-- deliberately NOT a backend function — the default routing provider
-- (OSRM's public server) needs no secret key, so RoutingService calls
-- it directly from the client, same as this project's existing
-- geocodingService.ts pattern (device-native by default, swappable to
-- a keyed provider later without touching call sites). A provider
-- that *does* need a protected key would go through a server-side
-- proxy at that point — not needed for the current provider.

create or replace function submit_rider_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_heading double precision default null,
  p_speed double precision default null,
  p_altitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders%rowtype;
  v_assignment delivery_assignments%rowtype;
  v_prev rider_locations%rowtype;
  v_is_outlier boolean := false;
  v_distance_m double precision;
  v_seconds double precision;
  v_implied_kmh double precision;
  v_location_id bigint;
begin
  -- Identity always comes from the session, never a client-supplied
  -- rider_id (section 6/8).
  select * into v_rider from riders where profile_id = auth.uid();
  if v_rider is null then
    raise exception 'rider profile not found';
  end if;
  if not v_rider.is_active then
    raise exception 'suspended riders cannot submit location';
  end if;

  if p_latitude < -90 or p_latitude > 90 then
    raise exception 'invalid latitude';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception 'invalid longitude';
  end if;
  if p_accuracy is not null and (p_accuracy < 0 or p_accuracy > 10000) then
    raise exception 'invalid accuracy';
  end if;

  -- Tracking eligibility (section 7): only while genuinely on an
  -- active delivery leg — never while OFFLINE/AVAILABLE/idle. This is
  -- re-derived from delivery_assignments itself, not a client-supplied
  -- delivery_id, so a rider can't submit pings against a delivery that
  -- isn't actually theirs and active.
  select * into v_assignment from delivery_assignments
    where rider_id = v_rider.id and status in ('accepted', 'at_store', 'picked_up', 'in_transit')
    order by assigned_at desc
    limit 1;
  if v_assignment is null then
    raise exception 'no active delivery eligible for location tracking';
  end if;

  -- Outlier detection (section 10): compare against this rider's most
  -- recent ping for the SAME delivery leg. Flag, don't reject — the
  -- row is still stored for audit, but sync_rider_current_location()
  -- (see the previous migration) skips updating the fast-read
  -- current-location fields for a flagged ping, so customers never
  -- see the jump.
  select * into v_prev from rider_locations
    where rider_id = v_rider.id and delivery_id = v_assignment.id
    order by recorded_at desc
    limit 1;

  -- `v_prev IS NOT NULL` on a %ROWTYPE composite is NOT "a row was
  -- found" — Postgres composite NULL semantics mean IS NOT NULL only
  -- holds when EVERY field is non-null. accuracy/heading/speed/
  -- altitude are all nullable columns and routinely omitted by
  -- callers, so that check silently failed to fire even when a real
  -- previous row existed. Check a column that's always populated
  -- (recorded_at, not-null) instead.
  if v_prev.recorded_at is not null then
    v_seconds := greatest(extract(epoch from (now() - v_prev.recorded_at)), 0.001);
    v_distance_m := ST_Distance(
      ST_SetSRID(ST_MakePoint(v_prev.longitude, v_prev.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
    );
    v_implied_kmh := (v_distance_m / 1000.0) / (v_seconds / 3600.0);
    -- A delivery bike/scooter/car realistically never sustains
    -- > ~120 km/h between consecutive pings a few seconds apart —
    -- generous margin on purpose (section 10: "do not reject
    -- legitimate GPS drift aggressively"), this is only meant to
    -- catch genuine teleports, not normal jitter.
    if v_implied_kmh > 120 then
      v_is_outlier := true;
    end if;
  end if;

  insert into rider_locations (rider_id, delivery_id, latitude, longitude, accuracy, heading, speed, altitude, is_outlier)
  values (v_rider.id, v_assignment.id, p_latitude, p_longitude, p_accuracy, p_heading, p_speed, p_altitude, v_is_outlier)
  returning id into v_location_id;

  return jsonb_build_object('success', true, 'locationId', v_location_id, 'flagged', v_is_outlier, 'deliveryId', v_assignment.id);
end;
$$;

comment on function submit_rider_location is 'The only path that writes rider_locations from a client — never a direct table insert (see the RLS policy below). Derives rider + active delivery from the session; rejects outright if the rider has no delivery in a trackable stage.';

revoke all on function submit_rider_location from public, anon;
grant execute on function submit_rider_location to authenticated;

-- rider_locations_self_insert (Phase 01) allowed a direct client
-- INSERT with zero eligibility/outlier logic — superseded by the
-- function above the same way Phase 07/08 superseded direct writes to
-- inventory.quantity and riders.is_available.
drop policy if exists "rider_locations_self_insert" on rider_locations;

-- =======================================================================
-- get_delivery_tracking(): the one read function the customer/store/
-- rider tracking UIs call. Takes order_id (what the customer app
-- naturally has) rather than delivery_id, resolving the current
-- active assignment internally. Returns only the latest known-good
-- location (never the raw history — section 40), the store/
-- destination coordinates already on file (never recomputed or
-- swapped for the customer's current profile address — section 41/42),
-- and enough rider/delivery context to render the screen, nothing more
-- (section 26/56: no license number, no other orders, no other
-- riders).
-- =======================================================================

create or replace function get_delivery_tracking(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_order orders%rowtype;
  v_assignment delivery_assignments%rowtype;
  v_authorized boolean;
  v_rider_name text;
  v_vehicle_type text;
  v_store record;
  v_current_location jsonb;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;

  select * into v_assignment from delivery_assignments
    where order_id = p_order_id
    order by assigned_at desc
    limit 1;

  v_authorized := is_admin()
    or v_order.user_id = auth.uid()
    or is_store_staff(v_order.store_id)
    or (v_assignment.id is not null and is_own_rider(v_assignment.rider_id));
  if not v_authorized then
    raise exception 'not authorized to view this order''s tracking';
  end if;

  select s.name, s.latitude, s.longitude into v_store from stores s where s.id = v_order.store_id;

  if v_assignment.id is not null then
    select p.full_name, r.vehicle_type into v_rider_name, v_vehicle_type
    from riders r join profiles p on p.id = r.profile_id where r.id = v_assignment.rider_id;

    select jsonb_build_object(
      'latitude', rl.latitude, 'longitude', rl.longitude, 'heading', rl.heading,
      'speed', rl.speed, 'accuracy', rl.accuracy, 'recordedAt', rl.recorded_at
    )
    into v_current_location
    from rider_locations rl
    where rl.delivery_id = v_assignment.id and not rl.is_outlier
    order by rl.recorded_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'orderStatus', v_order.status,
    'deliveryId', v_assignment.id,
    'deliveryStatus', v_assignment.status,
    'riderName', v_rider_name,
    'vehicleType', v_vehicle_type,
    'storeName', v_store.name,
    'storeLatitude', v_store.latitude,
    'storeLongitude', v_store.longitude,
    'destinationLatitude', (v_order.delivery_address->>'latitude')::double precision,
    'destinationLongitude', (v_order.delivery_address->>'longitude')::double precision,
    'currentLocation', v_current_location,
    'assignedAt', v_assignment.assigned_at,
    'outForDeliveryAt', v_assignment.out_for_delivery_at,
    'deliveredAt', v_order.delivered_at
  );
end;
$$;

comment on function get_delivery_tracking is 'Section 14/15/16 authorization all in one place: the order''s own customer, the assigned rider, that store''s staff, or admin — nobody else, checked server-side (not just an unguessable order_id in the URL). Returns the latest non-outlier location only, never rider_locations history.';

revoke all on function get_delivery_tracking from public, anon;
grant execute on function get_delivery_tracking to authenticated;
