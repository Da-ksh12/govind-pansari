-- Admin edits a rider: name, vehicle, home store, capacity and the activate / deactivate switch.
--
-- Why this exists: the admin Riders screens updated the `riders` table directly, but direct UPDATE on `riders` was revoked from
-- `authenticated` in the very first delivery migration (20260825000009: riders must only change through checked functions, so a rider
-- cannot, say, raise their own capacity). The result: the "Active" switch on the Riders list and rider detail — and any rider edit —
-- failed with "permission denied for table riders" for EVERY admin role, including the super admin (verified against the live database).
-- This function is the checked way to do it. Nothing is granted on the table; the table stays locked.
--
-- A NULL argument means "leave as it is". Phone is deliberately not editable: it is the rider's sign-in identity (auth.users.phone).

create or replace function admin_update_rider(
  p_rider_id uuid,
  p_full_name text default null,
  p_vehicle_type text default null,
  p_vehicle_number text default null,
  p_primary_store_id uuid default null,
  p_max_active_deliveries integer default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders%rowtype;
  v_changes jsonb := '{}'::jsonb;
  v_name text := nullif(btrim(p_full_name), '');
  v_type text := nullif(btrim(p_vehicle_type), '');
  v_number text := nullif(btrim(p_vehicle_number), '');
begin
  if not (has_permission('riders.manage') or is_admin()) then
    raise exception 'not authorized';
  end if;

  select * into v_rider from riders where id = p_rider_id for update;
  if not found then
    raise exception 'rider not found';
  end if;

  if p_full_name is not null and (v_name is null or char_length(v_name) not between 2 and 60) then
    raise exception 'the rider''s name must be 2 to 60 characters';
  end if;
  if p_vehicle_type is not null and (v_type is null or char_length(v_type) > 30) then
    raise exception 'the vehicle type must be 1 to 30 characters';
  end if;
  if p_vehicle_number is not null and (v_number is null or char_length(v_number) > 20) then
    raise exception 'the vehicle number must be 1 to 20 characters';
  end if;
  if p_max_active_deliveries is not null and p_max_active_deliveries not between 1 and 10 then
    raise exception 'active deliveries at once must be between 1 and 10';
  end if;
  if p_primary_store_id is not null and not exists (select 1 from stores where id = p_primary_store_id) then
    raise exception 'store not found';
  end if;

  -- Moving a rider to another store or switching them off in the middle of a delivery would strand it: finish or cancel it first.
  if (p_is_active is false and v_rider.is_active)
     or (p_primary_store_id is not null and p_primary_store_id is distinct from v_rider.primary_store_id) then
    if exists (select 1 from delivery_assignments da where da.rider_id = p_rider_id and not is_terminal_delivery_status(da.status)) then
      raise exception 'this rider has a delivery in progress — finish or cancel it first';
    end if;
  end if;

  if v_name is not null then
    update profiles set full_name = v_name where id = v_rider.profile_id and full_name is distinct from v_name;
    if found then v_changes := v_changes || jsonb_build_object('fullName', v_name); end if;
  end if;

  if v_type is not null and v_type is distinct from v_rider.vehicle_type then
    update riders set vehicle_type = v_type where id = p_rider_id;
    v_changes := v_changes || jsonb_build_object('vehicleType', v_type);
  end if;
  if v_number is not null and v_number is distinct from v_rider.vehicle_number then
    update riders set vehicle_number = v_number where id = p_rider_id;
    v_changes := v_changes || jsonb_build_object('vehicleNumber', v_number);
  end if;
  if p_primary_store_id is not null and p_primary_store_id is distinct from v_rider.primary_store_id then
    update riders set primary_store_id = p_primary_store_id where id = p_rider_id;
    v_changes := v_changes || jsonb_build_object('primaryStoreId', p_primary_store_id);
  end if;
  if p_max_active_deliveries is not null and p_max_active_deliveries is distinct from v_rider.max_active_deliveries then
    update riders set max_active_deliveries = p_max_active_deliveries where id = p_rider_id;
    v_changes := v_changes || jsonb_build_object('maxActiveDeliveries', p_max_active_deliveries);
  end if;
  if p_is_active is not null and p_is_active is distinct from v_rider.is_active then
    -- A switched-off rider is also offline; switching back on does not put them online (they do that themselves).
    update riders set is_active = p_is_active, is_available = case when p_is_active then is_available else false end where id = p_rider_id;
    v_changes := v_changes || jsonb_build_object('isActive', p_is_active);
  end if;

  if v_changes <> '{}'::jsonb then
    perform log_audit_event('rider_updated', 'rider', p_rider_id, v_changes);
  end if;
end;
$$;

revoke all on function admin_update_rider(uuid, text, text, text, uuid, integer, boolean) from public, anon;
grant execute on function admin_update_rider(uuid, text, text, text, uuid, integer, boolean) to authenticated;

comment on function admin_update_rider is 'The only way an admin edits a rider (direct UPDATE on riders is revoked from authenticated by design). riders.manage or super admin; NULL argument = unchanged; refuses to move or switch off a rider who has a delivery in progress; audited.';
