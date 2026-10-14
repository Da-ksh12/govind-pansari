-- Phase 03 (Authentication + Profile + Location + Address +
-- Serviceability): backend additions. All additive except one real
-- gap fixed in an already-applied Phase 01 policy — see part 1.

-- ---------------------------------------------------------------------
-- 1. profiles.phone must not be directly client-editable. It was in
-- the grantable column set from Phase 01, which is wrong: phone is the
-- *authentication identity* here (Supabase Auth phone+OTP), not plain
-- contact info like email. A raw UPDATE could desync profiles.phone
-- from the verified auth.users.phone. Changing your phone number
-- should go through Supabase Auth's own updateUser({ phone }) + OTP
-- re-verification (a future-phase UI) — this migration also adds a
-- trigger that keeps profiles.phone in sync automatically whenever
-- that happens, so the column is still always correct, just never
-- directly writable by the client.
-- ---------------------------------------------------------------------

revoke update on profiles from authenticated;
grant update (full_name, email, avatar_url) on profiles to authenticated;

create or replace function sync_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is distinct from old.phone then
    update profiles set phone = new.phone where id = new.id;
  end if;
  return new;
end;
$$;

create trigger auth_user_phone_sync
  after update of phone on auth.users
  for each row execute function sync_profile_phone();

-- ---------------------------------------------------------------------
-- 2. Address validation the DB actually enforces (section 33/34) —
-- never trust the frontend alone for this.
-- ---------------------------------------------------------------------

alter table addresses
  add constraint addresses_latitude_valid check (latitude between -90 and 90),
  add constraint addresses_longitude_valid check (longitude between -180 and 180),
  add constraint addresses_recipient_name_not_blank check (btrim(recipient_name) <> ''),
  add constraint addresses_phone_not_blank check (btrim(phone) <> ''),
  add constraint addresses_line1_not_blank check (btrim(address_line_1) <> ''),
  add constraint addresses_postal_code_not_blank check (btrim(postal_code) <> '');

-- ---------------------------------------------------------------------
-- 3. Atomic default-address swap (section 15) — a client doing two
-- separate UPDATE requests (unset old default, set new default) has no
-- way to guarantee both happen or neither does. This function does both
-- in one transaction and checks ownership itself, so it's also safe to
-- expose directly to authenticated clients.
-- ---------------------------------------------------------------------

create or replace function set_default_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from addresses where id = p_address_id;
  if v_user_id is null then
    raise exception 'address not found';
  end if;
  if v_user_id <> auth.uid() then
    raise exception 'not authorized';
  end if;

  update addresses set is_default = false where user_id = auth.uid() and is_default and id <> p_address_id;
  update addresses set is_default = true where id = p_address_id;
end;
$$;

grant execute on function set_default_address to authenticated;

-- ---------------------------------------------------------------------
-- 4. check_serviceability(lat, lng) — the clean, customer-safe shape
-- section 23 asks for, built on top of Phase 01's
-- find_serviceable_stores() rather than duplicating its geofencing
-- logic. Treat client-provided coordinates as untrusted input (section
-- 36): this is what the app calls to re-check serviceability
-- server-side, never trusting a client-side "serviceable = true" flag
-- carried over from a previous check.
-- ---------------------------------------------------------------------

create or replace function check_serviceability(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
as $$
declare
  v_stores jsonb;
  v_first record;
begin
  select jsonb_agg(jsonb_build_object(
           'storeId', store_id,
           'storeName', store_name,
           'distanceMeters', round(distance_meters::numeric, 1)
         ) order by distance_meters)
    into v_stores
  from find_serviceable_stores(p_lat, p_lng);

  if v_stores is null then
    return jsonb_build_object('serviceable', false, 'reason', 'OUTSIDE_SERVICE_AREA');
  end if;

  -- Same ranking find_serviceable_stores itself uses (priority, then
  -- distance) isn't exposed as an output column, but distance alone is
  -- a reasonable, stable tiebreak for "which zone's terms represent
  -- this response" when several zones/stores are eligible.
  select * into v_first from find_serviceable_stores(p_lat, p_lng) order by distance_meters limit 1;

  return jsonb_build_object(
    'serviceable', true,
    'zoneId', v_first.delivery_zone_id,
    'deliveryFee', v_first.delivery_fee,
    'minimumOrderValue', v_first.minimum_order_value,
    'estimatedDeliveryMinutes', v_first.estimated_delivery_minutes,
    'eligibleStores', v_stores
  );
end;
$$;

grant execute on function check_serviceability to anon, authenticated;
