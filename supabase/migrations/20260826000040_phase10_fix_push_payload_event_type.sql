-- Fix: get_pending_push_deliveries()'s payload only carried
-- create_notification()'s `data` (orderId/deliveryId) — the mobile
-- app's tap-to-navigate mapping (navigateForNotification) also needs
-- the notification's event_type to decide which screen to open, so a
-- background/killed-app push tap had nothing to route on. Merge it
-- into the outbound data payload here, the one place the push body is
-- assembled.

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
  update notification_deliveries nd set status = 'expired'
  where nd.channel = 'push' and nd.status = 'pending' and nd.next_attempt_at <= now()
    and not exists (select 1 from user_devices ud where ud.id = nd.device_id and ud.is_active);

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
