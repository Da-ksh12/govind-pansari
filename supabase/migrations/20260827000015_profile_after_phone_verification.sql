-- A customer profile must exist only for a phone number that has been VERIFIED.
--
-- Supabase Auth inserts the auth.users row when an OTP is REQUESTED (the phone is
-- still unconfirmed), and the on_auth_user_created trigger created the profile
-- right then. So anyone could create a profile — a "customer" in the admin lists,
-- counted in "new customers" — for any phone number just by asking for a code,
-- without ever proving they own it, and every SMS-pumping request left one behind.
--
-- Now:
--   * Inserting an unconfirmed PHONE-only user creates no profile.
--   * The profile is created the moment phone_confirmed_at is first set (the user
--     entered the correct OTP), by the same function, in the same transaction as
--     the verification — so a verified session always has its profile.
--   * Everything else is unchanged: users created already-confirmed (admin API,
--     seeds), email users, and the staff-invite flow keep creating their profile at
--     insert, and the insert is still `on conflict do nothing`, so retries,
--     repeated verification or an interrupted sign-up can never create a second
--     profile (it is keyed on the auth user id, and auth.users.phone is unique).
--
-- An interrupted sign-up (code requested, never entered) leaves only the bare auth
-- row; requesting a code again reuses it, and verifying then creates the profile.
--
-- handle_new_auth_user() is otherwise reproduced verbatim from the live function.
--
-- Rollback: drop trigger on_auth_user_phone_confirmed on auth.users; then re-apply
-- handle_new_auth_user() without the guard (profiles for already-verified users
-- already exist and are untouched either way).

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite staff_invites%rowtype;
begin
  -- Phone sign-up whose number is not verified yet: wait for the verification.
  if tg_op = 'INSERT' and new.phone is not null and new.phone <> '' and new.phone_confirmed_at is null and new.email is null then
    return new;
  end if;

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

drop trigger if exists on_auth_user_phone_confirmed on auth.users;
create trigger on_auth_user_phone_confirmed
  after update of phone_confirmed_at on auth.users
  for each row
  when (old.phone_confirmed_at is null and new.phone_confirmed_at is not null)
  execute function handle_new_auth_user();
