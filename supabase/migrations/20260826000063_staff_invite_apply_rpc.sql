-- Replaces reliance on handle_new_auth_user() firing reactively off an
-- auth.users email UPDATE. Live testing showed that path unreliable —
-- even after the 20260826000061 fix (an AFTER UPDATE OF email trigger),
-- a fresh live invite still left the role unapplied (auth.users.email
-- was confirmed populated and updated_at had advanced, yet applied_at
-- stayed null — the trigger just wasn't firing predictably for
-- GoTrue's internal invite-processing update, for reasons not fully
-- diagnosable from outside GoTrue's own connection/session context).
--
-- More robust: the invite-staff-member Edge Function already knows
-- exactly when GoTrue successfully created the user (it gets the new
-- user's id directly back in that same response) — so apply the role
-- explicitly and immediately right there, deterministically, instead
-- of waiting on a trigger to maybe catch it. The trigger from
-- 20260826000060/61 is left in place as a harmless safety net (it's
-- idempotent — applied_at is null is what makes it eligible) but is no
-- longer the primary mechanism.
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

revoke all on function apply_staff_invite from public, anon;
grant execute on function apply_staff_invite to authenticated;
