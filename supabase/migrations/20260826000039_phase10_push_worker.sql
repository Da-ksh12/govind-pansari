-- Phase 10: the push delivery worker's database side. The Edge
-- Function (supabase/functions/send-push-notifications) is invoked on
-- a schedule via pg_net from pg_cron — the same "scheduled scan" shape
-- Phase 08/09/10 already use for expire_stale_assignments()/
-- release_expired_reservations()/scan_notification_alerts(), just
-- reaching an Edge Function instead of only querying tables directly
-- (needed here because calling an external HTTPS API — Expo's push
-- service — from inside a database function isn't something plain SQL
-- does; pg_net is the supported bridge).
--
-- The service-role credential the cron job needs to authenticate to
-- the Edge Function is deliberately NOT in this file — it's stored in
-- Supabase Vault (create extension below) under the name
-- 'push_worker_service_key', seeded by a one-off, never-committed SQL
-- command (see docs/push-notifications.md) rather than a value baked
-- into a migration that lives in git history forever.

create extension if not exists "pg_net";
create extension if not exists "supabase_vault";

-- ---------------------------------------------------------------------
-- RPCs the Edge Function calls — typed parameters throughout, no raw
-- SQL ever crosses the Deno/Postgres boundary (section 46: never trust
-- a client-constructed query, even from server-side code).
-- ---------------------------------------------------------------------

create or replace function get_pending_push_deliveries()
returns table (
  id uuid, device_id uuid, attempt_count int, device_token text, platform device_platform,
  title text, body text, data jsonb, priority notification_priority
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A delivery row whose device was deactivated after the row was
  -- created (token refresh, DeviceNotRegistered from an earlier
  -- attempt, logout) would otherwise sit in 'pending' forever, invisible
  -- to the join below — expire it explicitly instead.
  update notification_deliveries nd set status = 'expired'
  where nd.channel = 'push' and nd.status = 'pending' and nd.next_attempt_at <= now()
    and not exists (select 1 from user_devices ud where ud.id = nd.device_id and ud.is_active);

  -- eventType is merged into the outbound payload alongside whatever
  -- create_notification() put in `data` (orderId/deliveryId) — the app's
  -- tap-to-navigate mapping (navigateForNotification) needs the event
  -- type, and this is the one place the push payload gets assembled.
  return query
  select nd.id, nd.device_id, nd.attempt_count, ud.device_token, ud.platform,
         n.title, n.body, n.data || jsonb_build_object('eventType', n.event_type), n.priority
  from notification_deliveries nd
  join user_devices ud on ud.id = nd.device_id and ud.is_active
  join notifications n on n.id = nd.notification_id
  where nd.channel = 'push' and nd.status = 'pending' and nd.next_attempt_at <= now()
  order by nd.created_at
  limit 500;
end;
$$;

create or replace function mark_push_delivery_sent(p_delivery_id uuid, p_provider_message_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_deliveries
  set status = 'sent', provider_message_id = p_provider_message_id, sent_at = now(), attempt_count = attempt_count + 1
  where id = p_delivery_id;
$$;

create or replace function mark_push_delivery_retry(p_delivery_id uuid, p_attempt_count int, p_backoff_seconds int, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_deliveries
  set attempt_count = p_attempt_count, next_attempt_at = now() + (p_backoff_seconds * interval '1 second'), last_error = p_error
  where id = p_delivery_id;
$$;

create or replace function mark_push_delivery_failed(p_delivery_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_deliveries
  set status = 'failed', last_error = p_error, attempt_count = attempt_count + 1
  where id = p_delivery_id;
$$;

create or replace function mark_push_delivery_dead_token(p_delivery_id uuid, p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update notification_deliveries set status = 'failed', last_error = 'DeviceNotRegistered' where id = p_delivery_id;
  update user_devices set is_active = false, updated_at = now() where id = p_device_id;
end;
$$;

comment on function get_pending_push_deliveries is 'The only thing the Edge Function reads. Every other RPC here is a single, narrow status update — the worker never runs arbitrary SQL (section 46).';

revoke all on function get_pending_push_deliveries, mark_push_delivery_sent, mark_push_delivery_retry, mark_push_delivery_failed, mark_push_delivery_dead_token
  from public, anon, authenticated;
grant execute on function get_pending_push_deliveries, mark_push_delivery_sent, mark_push_delivery_retry, mark_push_delivery_failed, mark_push_delivery_dead_token
  to service_role;

-- ---------------------------------------------------------------------
-- Invocation: pg_cron -> pg_net -> Edge Function, every minute (pg_cron's
-- standard minimum granularity — async either way, this is what makes
-- push delivery genuinely decoupled from the business transaction that
-- created the notification, section 17).
-- ---------------------------------------------------------------------

create or replace function invoke_push_worker()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_service_key text;
  v_project_url text := 'https://swgwcsfnimodloakamtv.supabase.co';
begin
  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'push_worker_service_key';
  if v_service_key is null then
    -- Not configured yet (see docs/push-notifications.md) — skip
    -- quietly rather than error every 30 seconds in the cron log.
    return;
  end if;

  perform net.http_post(
    url => v_project_url || '/functions/v1/send-push-notifications',
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_service_key, 'Content-Type', 'application/json'),
    body => '{}'::jsonb
  );
end;
$$;

comment on function invoke_push_worker is 'Reads the service-role key from Supabase Vault (seeded once, out-of-band — see docs/push-notifications.md) rather than embedding it in this migration. No-ops safely if the secret hasn''t been configured yet.';

revoke all on function invoke_push_worker from public, anon, authenticated;

select cron.schedule(
  'invoke-push-notification-worker',
  '* * * * *',
  $$select invoke_push_worker();$$
);
