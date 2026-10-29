-- Closes a role-escalation / login bypass in staff invites.
-- 1) handle_new_auth_user() granted a pending invite's role to ANY account
--    registering with the invited email. Email sign-up is open and unconfirmed
--    (enable_confirmations = false), so anyone who guessed an invited address
--    could sign up first and become store_manager/rider. It now also requires
--    the invite id GoTrue stored in the invited user's metadata (the id is only
--    ever in the invite email flow, never client-known).
-- 2) apply_staff_invite() let an authorized inviter apply the role to any
--    profile id; it now must be the user created for that invite.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite staff_invites%rowtype;
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.phone,
    new.email
  )
  on conflict (id) do nothing;

  if new.email is not null then
    select * into v_invite from staff_invites
    where email = lower(new.email) and applied_at is null
      and id::text = new.raw_user_meta_data ->> 'staff_invite_id'
    order by created_at desc
    limit 1;

    if v_invite is not null then
      update profiles set role = v_invite.role, full_name = coalesce(full_name, v_invite.full_name) where id = new.id;

      if v_invite.role in ('store_manager', 'staff') then
        insert into store_staff (user_id, store_id, role, is_active)
        values (new.id, v_invite.store_id, v_invite.role::text::store_staff_role, true)
        on conflict (user_id, store_id) do update set role = excluded.role, is_active = true;
      elsif v_invite.role = 'rider' then
        insert into riders (profile_id, vehicle_type, vehicle_number, is_active, is_available)
        values (new.id, coalesce(v_invite.vehicle_type, 'scooter'), v_invite.vehicle_number, true, false)
        on conflict (profile_id) do nothing;
      end if;

      update staff_invites set applied_at = now() where id = v_invite.id;
      perform log_audit_event('staff_invite_applied', 'profiles', new.id, jsonb_build_object('inviteId', v_invite.id, 'role', v_invite.role));
    end if;
  end if;

  return new;
end;
$$;
create or replace function apply_staff_invite(p_invite_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite staff_invites%rowtype;
begin
  select * into v_invite from staff_invites where id = p_invite_id and applied_at is null for update;
  if v_invite is null then
    raise exception 'invite not found or already applied';
  end if;

  -- Same authorization create_staff_invite() itself required — only
  -- someone who could have created this invite can apply it.
  if v_invite.role in ('store_manager', 'staff') then
    if not (has_permission('users.manage') or is_store_staff(v_invite.store_id, 'store_manager') or is_admin()) then
      raise exception 'not authorized';
    end if;
  else
    if not (has_permission('riders.manage') or is_admin()) then
      raise exception 'not authorized';
    end if;
  end if;

  -- The target must be the account GoTrue created for THIS invite, not any
  -- profile the caller names.
  if not exists (select 1 from auth.users where id = p_user_id and raw_user_meta_data ->> 'staff_invite_id' = p_invite_id::text) then
    raise exception 'user does not belong to this invite';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'no profile found for that user id yet';
  end if;

  update profiles set role = v_invite.role, full_name = coalesce(full_name, v_invite.full_name) where id = p_user_id;

  if v_invite.role in ('store_manager', 'staff') then
    insert into store_staff (user_id, store_id, role, is_active)
    values (p_user_id, v_invite.store_id, v_invite.role::text::store_staff_role, true)
    on conflict (user_id, store_id) do update set role = excluded.role, is_active = true;
  elsif v_invite.role = 'rider' then
    insert into riders (profile_id, vehicle_type, vehicle_number, is_active, is_available)
    values (p_user_id, coalesce(v_invite.vehicle_type, 'scooter'), v_invite.vehicle_number, true, false)
    on conflict (profile_id) do nothing;
  end if;

  update staff_invites set applied_at = now() where id = p_invite_id;
  perform log_audit_event('staff_invite_applied', 'profiles', p_user_id, jsonb_build_object('inviteId', p_invite_id, 'role', v_invite.role));

  return jsonb_build_object('success', true);
end;
$$;
