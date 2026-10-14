-- Phase 10: threshold-based alerts (section 23/26) that aren't a
-- discrete event — "still unaccepted after N minutes" is a fact about
-- the passage of time, not something any INSERT fires for. Scanned by
-- the same pg_cron mechanism Phase 08's expire_stale_assignments()
-- and the original release_expired_reservations() already use.

create or replace function scan_notification_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_order record;
  v_admin_id uuid;
begin
  -- Rider reminder (section 23): still 'assigned' (not yet accepted or
  -- declined) past half of assignment_expiry_minutes() — reuses Phase
  -- 08's own centralized window rather than a second hardcoded number.
  -- Deduped on the assignment row, so this fires at most once per
  -- assignment no matter how many times the scan runs before it's
  -- accepted/declined/expires.
  for v_assignment in
    select da.id, da.order_id, o.order_number, r.profile_id
    from delivery_assignments da
    join orders o on o.id = da.order_id
    join riders r on r.id = da.rider_id
    where da.status = 'assigned'
      and da.assigned_at < now() - (assignment_expiry_minutes() * interval '1 minute' / 2)
  loop
    perform create_notification(
      v_assignment.profile_id, 'delivery_reminder', 'delivery',
      'Delivery waiting for your response',
      format('Order #%s is still waiting for you to accept or decline.', v_assignment.order_number),
      jsonb_build_object('orderId', v_assignment.order_id, 'deliveryId', v_assignment.id),
      'high', 'delivery_assignments', v_assignment.id
    );
  end loop;

  -- Admin (section 26): a packed order with no active (non-terminal)
  -- delivery assignment for over 10 minutes — generous enough not to
  -- fire during normal dispatch, tight enough to be a real signal.
  for v_order in
    select o.id, o.order_number
    from orders o
    where o.status = 'packed'
      and o.ready_at < now() - interval '10 minutes'
      and not exists (
        select 1 from delivery_assignments da
        where da.order_id = o.id and not is_terminal_delivery_status(da.status)
      )
  loop
    for v_admin_id in select admin_recipient_ids() loop
      perform create_notification(
        v_admin_id, 'admin_unassigned_delivery', 'system', 'Unassigned delivery',
        format('Order #%s has been ready for pickup for over 10 minutes with no rider assigned.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id),
        'urgent', 'orders_unassigned', v_order.id
      );
    end loop;
  end loop;

  -- Admin (section 26): an order still unconfirmed by the store after
  -- 15 minutes.
  for v_order in
    select o.id, o.order_number
    from orders o
    where o.status = 'placed'
      and o.placed_at < now() - interval '15 minutes'
  loop
    for v_admin_id in select admin_recipient_ids() loop
      perform create_notification(
        v_admin_id, 'admin_system_alert', 'system', 'Order awaiting confirmation',
        format('Order #%s has been waiting over 15 minutes for the store to confirm it.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id),
        'high', 'orders_unconfirmed', v_order.id
      );
    end loop;
  end loop;
end;
$$;

comment on function scan_notification_alerts is 'Threshold scans, not event reactions — dedup source_id is a stable identifier for the CONDITION (the assignment/order row itself), so a re-scan before the condition clears never re-notifies. Once the condition resolves (rider responds, order gets assigned/confirmed), the query simply stops matching that row — no separate "clear the alert" step needed.';

revoke all on function scan_notification_alerts from public, anon, authenticated;

select cron.schedule(
  'scan-notification-alerts',
  '*/5 * * * *',
  $$select scan_notification_alerts();$$
);

-- ---------------------------------------------------------------------
-- Cleanup (section 49). Transactional notification HISTORY is kept —
-- this only prunes the idempotency ledger (which has no reason to
-- outlive the notifications it protected) and device tokens that have
-- gone quiet long enough to be almost certainly stale (uninstalled
-- app, factory-reset device, expired Expo token). notifications rows
-- themselves are left alone; a future retention policy for very old
-- read notifications is a product decision, not made here.
-- ---------------------------------------------------------------------

create or replace function cleanup_notification_infrastructure()
returns void
language sql
security definer
set search_path = public
as $$
  delete from notification_dedupe where created_at < now() - interval '90 days';
  delete from user_devices where is_active = false and updated_at < now() - interval '180 days';
$$;

revoke all on function cleanup_notification_infrastructure from public, anon, authenticated;

select cron.schedule(
  'cleanup-notification-infrastructure',
  '0 4 * * *',
  $$select cleanup_notification_infrastructure();$$
);
