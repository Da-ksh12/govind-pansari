-- Admin Control Center, part 7: staff & role management (section
-- 30/31). This app has no email-invite flow (phone+OTP only, Phase 03)
-- — "create staff" here means promoting an existing signed-up profile
-- (found by phone) to a staff/admin capacity, not provisioning a new
-- login from scratch. No second auth system, per the phase brief.

create or replace function assign_store_staff_role(p_phone text, p_store_id uuid, p_role store_staff_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_result jsonb;
begin
  if not (has_permission('users.manage') or is_store_staff(p_store_id, 'store_manager') or is_admin()) then
    raise exception 'not authorized';
  end if;

  select * into v_profile from profiles where phone = p_phone;
  if v_profile is null then
    raise exception 'no account found for that phone number — they must sign up first';
  end if;

  update profiles set role = p_role::text::user_role where id = v_profile.id and role = 'customer';

  insert into store_staff (user_id, store_id, role, is_active)
  values (v_profile.id, p_store_id, p_role, true)
  on conflict (user_id, store_id) do update set role = excluded.role, is_active = true
  returning jsonb_build_object('userId', user_id, 'storeId', store_id, 'role', role) into v_result;

  perform log_audit_event('staff_role_assigned', 'store_staff', v_profile.id, jsonb_build_object('storeId', p_store_id, 'role', p_role));
  return v_result;
end;
$$;

comment on function assign_store_staff_role is 'Promotes an existing customer profile to staff and upserts their store_staff row — the same underlying table Phase 07''s is_store_staff() already reads, no second staff-assignment system.';

revoke all on function assign_store_staff_role from public, anon;
grant execute on function assign_store_staff_role to authenticated;

create or replace function deactivate_store_staff(p_store_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row store_staff%rowtype;
begin
  select * into v_row from store_staff where id = p_store_staff_id;
  if v_row is null then raise exception 'not found'; end if;
  if not (has_permission('users.manage') or is_store_staff(v_row.store_id, 'store_manager') or is_admin()) then
    raise exception 'not authorized';
  end if;
  update store_staff set is_active = false where id = p_store_staff_id;
  perform log_audit_event('staff_deactivated', 'store_staff', p_store_staff_id, '{}'::jsonb);
end;
$$;

revoke all on function deactivate_store_staff from public, anon;
grant execute on function deactivate_store_staff to authenticated;

-- ---------------------------------------------------------------------
-- Admin sub-role assignment (section 30/31). SUPER_ADMIN-only for the
-- two highest tiers, and a hard self-promotion guard regardless of who
-- calls it — "Do not allow ADMIN to promote itself to SUPER_ADMIN"
-- (section 30) is enforced here even for a caller who otherwise has
-- users.manage, not just documented as a UI rule.
-- ---------------------------------------------------------------------

create or replace function assign_admin_role(p_phone text, p_admin_role admin_role_type)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_caller_is_super boolean;
begin
  select (admin_role is null or admin_role = 'super_admin') into v_caller_is_super
  from profiles where id = auth.uid() and role = 'admin';
  v_caller_is_super := coalesce(v_caller_is_super, false);

  if p_admin_role in ('super_admin', 'admin') and not v_caller_is_super then
    raise exception 'only a super admin can grant the admin or super_admin tier';
  end if;
  if not (v_caller_is_super or has_permission('users.manage')) then
    raise exception 'not authorized';
  end if;

  select * into v_profile from profiles where phone = p_phone;
  if v_profile is null then
    raise exception 'no account found for that phone number — they must sign up first';
  end if;
  if v_profile.id = auth.uid() then
    raise exception 'cannot change your own admin role';
  end if;

  update profiles set role = 'admin', admin_role = p_admin_role where id = v_profile.id
  returning jsonb_build_object('userId', id, 'fullName', full_name, 'adminRole', admin_role) into v_profile;

  perform log_audit_event('admin_role_changed', 'profiles', v_profile.id, jsonb_build_object('newAdminRole', p_admin_role));
  return to_jsonb(v_profile);
end;
$$;

revoke all on function assign_admin_role from public, anon;
grant execute on function assign_admin_role to authenticated;

create or replace function get_admin_staff_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not has_permission('users.view') then '[]'::jsonb else coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) end
  from (
    select p.id, p.full_name, p.phone, p.role, p.admin_role, p.is_active,
           (select jsonb_agg(jsonb_build_object('storeId', ss.store_id, 'storeName', s.name, 'role', ss.role))
              from store_staff ss join stores s on s.id = ss.store_id where ss.user_id = p.id and ss.is_active) as store_assignments
    from profiles p
    where p.role in ('admin', 'store_manager', 'staff')
    order by p.role, p.full_name
  ) t
$$;

revoke all on function get_admin_staff_list from public, anon;
grant execute on function get_admin_staff_list to authenticated;
