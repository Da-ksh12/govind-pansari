-- Real bug caught by the live smoke test immediately after 093: ST_Distance()
-- returns double precision, but get_eligible_riders_for_dispatch()
-- declared its RETURNS TABLE column as numeric -- PostgREST/Postgres
-- rejected every call with "structure of query does not match function
-- result type" (42804). Cast explicitly at the one place distance is
-- computed; start_dispatch_round() consumes this function's output
-- rather than recomputing ST_Distance itself, so fixing it here is
-- the only change needed.
create or replace function get_eligible_riders_for_dispatch(p_order_id uuid)
returns table (rider_id uuid, full_name text, vehicle_type text, vehicle_number text, distance_meters numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_store stores%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin() or has_permission('deliveries.assign')) then
    raise exception 'not authorized to view riders for this order';
  end if;
  select * into v_store from stores where id = v_order.store_id;

  return query
  select r.id, p.full_name, r.vehicle_type, r.vehicle_number,
    case when r.current_latitude is not null and r.current_longitude is not null
      then ST_Distance(v_store.geog, ST_SetSRID(ST_MakePoint(r.current_longitude, r.current_latitude), 4326)::geography)::numeric
      else null end as distance_meters
  from riders r
  join profiles p on p.id = r.profile_id
  where r.is_active and r.is_available
    and r.primary_store_id = v_order.store_id
    and not exists (select 1 from delivery_assignments da where da.rider_id = r.id and not is_terminal_delivery_status(da.status))
    and not exists (select 1 from delivery_offers o where o.rider_id = r.id and o.status = 'open' and o.expires_at > now())
  order by distance_meters asc nulls last;
end;
$$;
