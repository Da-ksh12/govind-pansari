-- Section 14 follow-up (reopen/background resilience, section 17): the
-- rider delivery screen needs to know whether "I've Reached
-- Destination" has already been tapped for the CURRENT delivery, even
-- after a screen reopen, app kill/reopen, or a different device
-- session. mark_order_approaching() only ever changes orders.status
-- (delivery_assignments.status stays 'in_transit' throughout), so that
-- signal was previously invisible to get_rider_dashboard()'s
-- currentAssignment payload — the client had no honest way to recover
-- it and would have had to rely on fragile local-only state that
-- forgets itself on remount. This adds orderStatus alongside the
-- existing fields so the client can derive "reached destination" as
-- orderStatus = 'approaching', matching what getDeliveryDetail() (a
-- direct table select) already exposes.

create or replace function get_rider_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_rider riders%rowtype;
  v_today_start timestamptz := date_trunc('day', now());
  v_current jsonb;
begin
  select * into v_rider from riders where profile_id = auth.uid();
  if v_rider is null then
    raise exception 'rider profile not found';
  end if;

  select jsonb_build_object(
    'assignmentId', da.id,
    'orderId', o.id,
    'orderNumber', o.order_number,
    'status', da.status,
    'orderStatus', o.status,
    'itemCount', (select count(*) from order_items where order_id = o.id),
    'total', o.total,
    'storeName', s.name,
    'storeAddress', s.address_line,
    'storeLatitude', s.latitude,
    'storeLongitude', s.longitude,
    'deliveryCity', o.delivery_address->>'city',
    'deliveryAddressLine1', o.delivery_address->>'address_line_1',
    'deliveryLatitude', (o.delivery_address->>'latitude')::double precision,
    'deliveryLongitude', (o.delivery_address->>'longitude')::double precision,
    'recipientName', o.delivery_address->>'recipient_name',
    'recipientPhone', o.delivery_address->>'phone',
    'assignedAt', da.assigned_at,
    'expiresAt', da.expires_at
  )
  into v_current
  from delivery_assignments da
  join orders o on o.id = da.order_id
  join stores s on s.id = da.store_id
  where da.rider_id = v_rider.id and not is_terminal_delivery_status(da.status)
  order by da.assigned_at desc
  limit 1;

  return jsonb_build_object(
    'riderId', v_rider.id,
    'status', get_rider_status(v_rider.id),
    'isAvailable', v_rider.is_available,
    'isActive', v_rider.is_active,
    'todayDeliveredCount', (
      select count(*) from delivery_assignments
      where rider_id = v_rider.id and status = 'completed' and completed_at >= v_today_start
    ),
    'currentAssignment', v_current
  );
end;
$$;

revoke all on function get_rider_dashboard from public, anon;
grant execute on function get_rider_dashboard to authenticated;
