-- Fix found by live testing: assign_admin_role() reused v_profile
-- (typed profiles%rowtype) as the target of `RETURNING
-- jsonb_build_object(...) INTO`, which tries to coerce a single jsonb
-- value into the row type's first column (uuid) — "invalid input
-- syntax for type uuid: {...}". A separate jsonb variable is what was
-- needed; same fix shape as Phase 09/10's earlier live-test-only bugs.

create or replace function assign_admin_role(p_phone text, p_admin_role admin_role_type)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_caller_is_super boolean;
  v_result jsonb;
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

  select * into v_profile from profiles where phone = ltrim(p_phone, '+');
  if v_profile is null then
    raise exception 'no account found for that phone number — they must sign up first';
  end if;
  if v_profile.id = auth.uid() then
    raise exception 'cannot change your own admin role';
  end if;

  update profiles set role = 'admin', admin_role = p_admin_role where id = v_profile.id
  returning jsonb_build_object('userId', id, 'fullName', full_name, 'adminRole', admin_role) into v_result;

  perform log_audit_event('admin_role_changed', 'profiles', v_profile.id, jsonb_build_object('newAdminRole', p_admin_role));
  return v_result;
end;
$$;
