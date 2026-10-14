-- Fixes a real bug surfaced by phase09-live-tracking.test.mjs (test 4):
-- a 176km "jump" one second after the previous ping was NOT flagged
-- as an outlier, despite the math being unambiguous (implied speed
-- ~630,000 km/h against a 120 km/h threshold).
--
-- Root cause: `if v_prev is not null then` on a `rider_locations
-- %rowtype` composite variable. Postgres composite NULL semantics mean
-- `row IS NOT NULL` only holds when EVERY field in the row is
-- non-null — it is NOT a "was a row found" check. accuracy/heading/
-- speed/altitude are all nullable columns that real callers routinely
-- omit (this test's own calls did), so the moment any of those was
-- null on the fetched previous row, the whole `IS NOT NULL` check
-- silently evaluated false — v_seconds/v_distance_m/v_implied_kmh were
-- never computed, and v_is_outlier stayed at its default `false`, even
-- though a real, valid previous row existed with real position data.
-- Confirmed live via a temporary diagnostic function before writing
-- this fix (a plain re-read of the deployed SQL looked correct; the
-- bug only became visible by inspecting actual runtime values).
--
-- Fix: check a column that's guaranteed NOT NULL (recorded_at, or
-- equivalently .id) instead of the whole-row composite.

drop function if exists debug_submit_rider_location(double precision, double precision);

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

  select * into v_assignment from delivery_assignments
    where rider_id = v_rider.id and status in ('accepted', 'at_store', 'picked_up', 'in_transit')
    order by assigned_at desc
    limit 1;
  if v_assignment is null then
    raise exception 'no active delivery eligible for location tracking';
  end if;

  select * into v_prev from rider_locations
    where rider_id = v_rider.id and delivery_id = v_assignment.id
    order by recorded_at desc
    limit 1;

  -- See the migration header: check a not-null column, not the whole-row composite.
  if v_prev.recorded_at is not null then
    v_seconds := greatest(extract(epoch from (now() - v_prev.recorded_at)), 0.001);
    v_distance_m := ST_Distance(
      ST_SetSRID(ST_MakePoint(v_prev.longitude, v_prev.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
    );
    v_implied_kmh := (v_distance_m / 1000.0) / (v_seconds / 3600.0);
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

revoke all on function submit_rider_location from public, anon;
grant execute on function submit_rider_location to authenticated;
