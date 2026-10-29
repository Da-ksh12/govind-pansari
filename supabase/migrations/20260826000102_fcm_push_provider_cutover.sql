-- Native Android devices register FCM tokens while existing Expo clients
-- continue using Expo Push.  Existing rows and the four-argument RPC remain
-- valid: every pre-cutover token is explicitly/implicitly an Expo token.

create type device_push_provider as enum ('expo', 'fcm');
alter table user_devices
  add column push_provider device_push_provider not null default 'expo';
comment on column user_devices.push_provider is
  'Server-selected push transport for this opaque registration token. Existing rows remain expo; clients may only choose expo or fcm through register_device_token().';
-- Preserve the established RPC exactly for old Expo clients, but reject values
-- that cannot be provider tokens before they are persisted. A device token is
-- account-bound: a second account must explicitly deactivate/re-register from
-- the original session instead of silently taking over its push destination.
-- An inactive row may be claimed by the next account only after the former
-- owner has logged out/deactivated it; this supports a deliberate shared
-- device handoff without allowing an active push destination to be stolen.
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
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to register a device';
  end if;

  if p_device_token is null
     or p_device_token !~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then
    raise exception 'invalid Expo push token';
  end if;

  insert into user_devices (user_id, device_token, platform, push_provider, app_version, device_id, is_active, last_seen_at)
  values (auth.uid(), p_device_token, p_platform, 'expo', p_app_version, p_device_id, true, now())
  on conflict (device_token) do update
    set user_id = case
          when user_devices.user_id = auth.uid() then user_devices.user_id
          else excluded.user_id
        end,
        platform = excluded.platform,
        push_provider = excluded.push_provider,
        app_version = excluded.app_version,
        device_id = excluded.device_id,
        is_active = true,
        last_seen_at = now(),
        updated_at = now()
    where user_devices.user_id = auth.uid() or not user_devices.is_active
  returning id into v_id;

  if v_id is null then
    raise exception 'device token is already registered to another account'
      using errcode = '23505';
  end if;

  return v_id;
end;
$$;
-- New native clients call this overload with p_push_provider = 'fcm'. The
-- token is deliberately stored as opaque data; validation rejects empty,
-- control-character, implausibly short/large, and Expo-shaped inputs because
-- FCM tokens are not a stable public string format.
create function register_device_token(
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
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to register a device';
  end if;

  if p_push_provider is null then
    raise exception 'push provider is required';
  end if;

  if p_push_provider = 'expo' then
    if p_device_token is null
       or p_device_token !~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then
      raise exception 'invalid Expo push token';
    end if;
  elsif p_device_token is null
     or length(p_device_token) not between 20 and 4096
     or p_device_token ~ '[[:cntrl:]\r\n]'
     or p_device_token ~ '^(ExponentPushToken|ExpoPushToken|ExpoToken)\[[^]\r\n]{1,4096}\]$' then
    raise exception 'invalid FCM registration token';
  end if;

  insert into user_devices (user_id, device_token, platform, push_provider, app_version, device_id, is_active, last_seen_at)
  values (auth.uid(), p_device_token, p_platform, p_push_provider, p_app_version, p_device_id, true, now())
  on conflict (device_token) do update
    set user_id = case
          when user_devices.user_id = auth.uid() then user_devices.user_id
          else excluded.user_id
        end,
        platform = excluded.platform,
        push_provider = excluded.push_provider,
        app_version = excluded.app_version,
        device_id = excluded.device_id,
        is_active = true,
        last_seen_at = now(),
        updated_at = now()
    where user_devices.user_id = auth.uid() or not user_devices.is_active
  returning id into v_id;

  if v_id is null then
    raise exception 'device token is already registered to another account'
      using errcode = '23505';
  end if;

  return v_id;
end;
$$;
revoke all on function register_device_token(text, device_platform, text, text) from public, anon;
revoke all on function register_device_token(text, device_platform, device_push_provider, text, text) from public, anon;
grant execute on function register_device_token(text, device_platform, text, text) to authenticated;
grant execute on function register_device_token(text, device_platform, device_push_provider, text, text) to authenticated;
-- PostgreSQL does not allow CREATE OR REPLACE to change a function's OUT
-- columns. Nothing in the database depends on this service-role-only RPC;
-- the Edge Function is updated in the same release, so recreate it with the
-- provider field rather than leaving the worker unable to distinguish tokens.
drop function get_pending_push_deliveries();
create function get_pending_push_deliveries()
returns table (
  id uuid, device_id uuid, attempt_count int, device_token text, platform device_platform,
  push_provider device_push_provider, title text, body text, data jsonb, priority notification_priority
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update notification_deliveries nd set status = 'expired'
  where nd.channel = 'push' and nd.status = 'pending' and nd.next_attempt_at <= now()
    and not exists (select 1 from user_devices ud where ud.id = nd.device_id and ud.is_active);

  return query
  select nd.id, nd.device_id, nd.attempt_count, ud.device_token, ud.platform, ud.push_provider,
         n.title, n.body, n.data || jsonb_build_object('eventType', n.event_type), n.priority
  from notification_deliveries nd
  join user_devices ud on ud.id = nd.device_id and ud.is_active
  join notifications n on n.id = nd.notification_id
  where nd.channel = 'push' and nd.status = 'pending' and nd.next_attempt_at <= now()
  order by nd.created_at
  limit 500;
end;
$$;
revoke all on function get_pending_push_deliveries() from public, anon, authenticated;
grant execute on function get_pending_push_deliveries() to service_role;
