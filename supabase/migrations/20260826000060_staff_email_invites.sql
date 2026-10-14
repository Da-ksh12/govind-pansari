-- Admin-invites-staff-by-email (requested follow-up to the catalogue
-- hardening phase). Store managers/riders previously had no onboarding
-- path at all beyond an admin manually inserting rows — this is a
-- genuinely new, separate login pathway (email+password) alongside the
-- existing phone+OTP flow every customer uses, by explicit choice: the
-- invited person sets a password via the email link and logs in with
-- email+password from then on, never phone+OTP.
--
-- Mechanic: supabase.auth.admin.inviteUserByEmail() creates the
-- auth.users row immediately when the invite is SENT (not when
-- accepted) — handle_new_auth_user() already fires on that insert, so
-- this is the natural place to apply the intended role, not a second
-- "acceptance" step.

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role user_role not null check (role in ('store_manager', 'staff', 'rider')),
  store_id uuid references stores (id), -- required for store_manager/staff, null for rider
  vehicle_type text, -- optional, rider only
  vehicle_number text, -- optional, rider only
  invited_by uuid not null references profiles (id),
  applied_at timestamptz, -- set by handle_new_auth_user() once the invited person's auth.users row appears
  created_at timestamptz not null default now()
);

create index staff_invites_email_idx on staff_invites (email) where applied_at is null;

alter table staff_invites enable row level security;

-- No client insert policy — only create_staff_invite() (security
-- definer) writes here, so its permission check is the one and only
-- gate, same pattern as role_permissions/audit_logs.
create policy "staff_invites_read" on staff_invites for select using (
  is_admin()
  or has_permission('users.manage')
  or (store_id is not null and is_store_staff(store_id, 'store_manager'))
);

create or replace function create_staff_invite(
  p_email text, p_full_name text, p_role user_role, p_store_id uuid default null,
  p_vehicle_type text default null, p_vehicle_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_role not in ('store_manager', 'staff', 'rider') then
    raise exception 'can only invite store_manager, staff, or rider';
  end if;
  if p_role in ('store_manager', 'staff') then
    if p_store_id is null then
      raise exception 'store_id is required for store_manager/staff invites';
    end if;
    if not (has_permission('users.manage') or is_store_staff(p_store_id, 'store_manager') or is_admin()) then
      raise exception 'not authorized';
    end if;
  else -- rider
    if not (has_permission('riders.manage') or is_admin()) then
      raise exception 'not authorized';
    end if;
  end if;

  if coalesce(p_email, '') = '' or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required';
  end if;
  if coalesce(p_full_name, '') = '' then
    raise exception 'full name is required';
  end if;
  if exists (select 1 from profiles where email = p_email) then
    raise exception 'someone with this email already has an account — use the existing staff/role assignment flow instead';
  end if;

  insert into staff_invites (email, full_name, role, store_id, vehicle_type, vehicle_number, invited_by)
  values (lower(p_email), p_full_name, p_role, p_store_id, p_vehicle_type, p_vehicle_number, auth.uid())
  returning id into v_id;

  perform log_audit_event('staff_invited', 'staff_invites', v_id, jsonb_build_object('email', p_email, 'role', p_role, 'storeId', p_store_id));

  return jsonb_build_object('success', true, 'inviteId', v_id);
end;
$$;

revoke all on function create_staff_invite from public, anon;
grant execute on function create_staff_invite to authenticated;

create or replace function get_staff_invites()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not (is_admin() or has_permission('users.manage')) then '[]'::jsonb
  else coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) end
  from (
    select si.id, si.email, si.full_name, si.role, si.store_id, s.name as store_name,
           si.applied_at, si.created_at
    from staff_invites si
    left join stores s on s.id = si.store_id
  ) t;
$$;

revoke all on function get_staff_invites from public, anon;
grant execute on function get_staff_invites to authenticated;

-- ---------------------------------------------------------------------
-- Extend handle_new_auth_user(): additive only — if the new auth.users
-- row's email matches a pending staff_invites row, apply the intended
-- role/store/rider row right away. Every existing phone-signup customer
-- path is completely unaffected (no matching invite = no behavior
-- change at all, same as before this migration).
-- ---------------------------------------------------------------------
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
