-- A device row is deliberately retained during a shared-device handoff so
-- token uniqueness is preserved.  Its queued deliveries, however, belong to
-- the prior account and must never be sent after that row is re-parented.

create or replace function deactivate_device_token(p_device_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
begin
  -- Locking and expiring occur in the same transaction. A concurrent token
  -- registration cannot observe an inactive device with an old pending row.
  update user_devices
  set is_active = false, updated_at = now()
  where device_token = p_device_token and user_id = auth.uid()
  returning id into v_device_id;

  if v_device_id is not null then
    update notification_deliveries
    set status = 'expired', last_error = 'device deactivated'
    where device_id = v_device_id and channel = 'push' and status = 'pending';
  end if;
end;
$$;
-- Recreate both public overloads with the additional handoff guard. The
-- inactive-device condition alone is insufficient: a legacy pending delivery
-- still points to the stable device id and would otherwise be sent to the new
-- owner after re-parenting.
create or replace function register_device_token(
  p_device_token text,
  p_platform device_platform,
  p_app_version text default null,
  p_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'must be signed in to register a device'; end if;
  if p_device_token is null or p_device_token !~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then
    raise exception 'invalid Expo push token';
  end if;

  insert into user_devices (user_id, device_token, platform, push_provider, app_version, device_id, is_active, last_seen_at)
  values (auth.uid(), p_device_token, p_platform, 'expo', p_app_version, p_device_id, true, now())
  on conflict (device_token) do update
    set user_id = case when user_devices.user_id = auth.uid() then user_devices.user_id else excluded.user_id end,
        platform = excluded.platform, push_provider = excluded.push_provider,
        app_version = excluded.app_version, device_id = excluded.device_id,
        is_active = true, last_seen_at = now(), updated_at = now()
    where user_devices.user_id = auth.uid()
       or (not user_devices.is_active and not exists (
         select 1 from notification_deliveries nd
         where nd.device_id = user_devices.id and nd.channel = 'push' and nd.status = 'pending'
       ))
  returning id into v_id;

  if v_id is null then raise exception 'device token is already registered to another account' using errcode = '23505'; end if;
  return v_id;
end;
$$;
create or replace function register_device_token(
  p_device_token text,
  p_platform device_platform,
  p_push_provider device_push_provider,
  p_app_version text default null,
  p_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'must be signed in to register a device'; end if;
  if p_push_provider is null then raise exception 'push provider is required'; end if;
  if p_push_provider = 'expo' then
    if p_device_token is null or p_device_token !~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then raise exception 'invalid Expo push token'; end if;
  elsif p_device_token is null or length(p_device_token) not between 20 and 4096
     or p_device_token ~ '[[:cntrl:]\r\n]' or p_device_token ~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then
    raise exception 'invalid FCM registration token';
  end if;

  insert into user_devices (user_id, device_token, platform, push_provider, app_version, device_id, is_active, last_seen_at)
  values (auth.uid(), p_device_token, p_platform, p_push_provider, p_app_version, p_device_id, true, now())
  on conflict (device_token) do update
    set user_id = case when user_devices.user_id = auth.uid() then user_devices.user_id else excluded.user_id end,
        platform = excluded.platform, push_provider = excluded.push_provider,
        app_version = excluded.app_version, device_id = excluded.device_id,
        is_active = true, last_seen_at = now(), updated_at = now()
    where user_devices.user_id = auth.uid()
       or (not user_devices.is_active and not exists (
         select 1 from notification_deliveries nd
         where nd.device_id = user_devices.id and nd.channel = 'push' and nd.status = 'pending'
       ))
  returning id into v_id;

  if v_id is null then raise exception 'device token is already registered to another account' using errcode = '23505'; end if;
  return v_id;
end;
$$;
comment on function deactivate_device_token(text) is
  'Deactivates only the caller-owned token and atomically expires its queued push deliveries before any cross-account handoff.';
