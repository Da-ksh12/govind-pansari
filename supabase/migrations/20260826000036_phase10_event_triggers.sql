-- Phase 10: the EVENT HANDLER layer (section 15) — pure consumers of
-- three already-firing event sources, added without touching a single
-- line of Phase 05/07/08/09 business logic:
--   - `orders` INSERT/UPDATE (new triggers, alongside the existing
--     orders_log_status_change — that trigger is untouched)
--   - `delivery_events` INSERT (Phase 08, already firing)
-- `order_events` (Phase 07) is deliberately NOT hooked here — every
-- customer/store-meaningful moment it captures is either superseded by
-- an order_status_history transition (order_accepted/order_rejected)
-- or a delivery_events row (rider_assigned onward). Its item-level
-- entries (item_picked, item_unavailable, exception_resolved) stay
-- internal store-ops detail with no notification, matching section 13
-- ("do not spam customers for every internal event") — see
-- docs/notification-events.md for the full considered mapping.

create or replace function fmt_inr(p_amount numeric)
returns text
language sql
immutable
as $$
  select '₹' || trim(to_char(p_amount, 'FM999,999,999'));
$$;

-- =======================================================================
-- orders: creation (section 13's ORDER_CREATED, section 25's NEW_ORDER)
-- =======================================================================

create or replace function notify_on_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  perform create_notification(
    new.user_id, 'order_placed', 'order',
    'Order placed',
    format('We''ve received your order #%s. We''ll let you know as soon as the store confirms it.', new.order_number),
    jsonb_build_object('orderId', new.id),
    'normal', 'orders', new.id
  );

  for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
    perform create_notification(
      v_staff_id, 'store_new_order', 'order',
      'New order',
      format('Order #%s — %s. Tap to review and accept.', new.order_number, fmt_inr(new.total)),
      jsonb_build_object('orderId', new.id),
      'high', 'orders', new.id
    );
  end loop;

  return new;
end;
$$;

create trigger orders_notify_on_created
  after insert on orders
  for each row execute function notify_on_order_created();

comment on function notify_on_order_created is 'Fires once per new order — customer receipt + every active staff member of the fulfilling store (section 45: that store only). Separate trigger from nothing existing (order creation had no notification hook before Phase 10).';

-- =======================================================================
-- orders: status transitions that don't already have a delivery_events
-- row (confirmed/preparing/packed/cancelled). rider_assigned/
-- out_for_delivery/delivered are intentionally NOT handled here — the
-- matching delivery_events entry (below) carries richer rider context
-- and fires at the same instant; handling both would double-notify.
-- picking/packing reach this trigger too but have no case below, so
-- they silently produce nothing — internal store-ops sub-phases,
-- not customer-meaningful (section 13).
-- =======================================================================

create or replace function notify_on_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_event notification_event_type;
  v_title text;
  v_body text;
  -- orders.id is stable across an order's whole lifecycle, so it can't
  -- be the dedupe source_id on its own (a status can only be reached
  -- once under this app's forward-only state machine, but the id
  -- alone wouldn't distinguish "notified for confirmed" from "notified
  -- for packed"). A deterministic hash of (order id, status) gives a
  -- stable, collision-free per-transition key without a real backing
  -- row to point to.
  v_source_id uuid := md5(new.id::text || ':' || new.status::text)::uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'confirmed' then
      v_event := 'order_confirmed';
      v_title := 'Order confirmed';
      v_body := format('Your order #%s has been confirmed and will be prepared shortly.', new.order_number);
    when 'preparing' then
      v_event := 'order_preparing';
      v_title := 'Preparing your order';
      v_body := format('The store has started preparing order #%s.', new.order_number);
    when 'packed' then
      v_event := 'order_packed';
      v_title := 'Order packed';
      v_body := format('Order #%s is packed and ready — a rider will be assigned shortly.', new.order_number);
    when 'cancelled' then
      v_event := 'order_cancelled';
      v_title := 'Order cancelled';
      v_body := case
        when new.rejection_reason is not null then format('Order #%s was cancelled by the store (%s).', new.order_number, replace(new.rejection_reason::text, '_', ' '))
        else format('Order #%s has been cancelled.', new.order_number)
      end;
    else
      return new;
  end case;

  perform create_notification(
    new.user_id, v_event, 'order', v_title, v_body,
    jsonb_build_object('orderId', new.id),
    case when new.status = 'cancelled' then 'high' else 'normal' end::notification_priority,
    'order_status_history', v_source_id
  );

  if new.status = 'cancelled' then
    for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
      perform create_notification(
        v_staff_id, 'order_cancelled', 'order',
        'Order cancelled',
        format('Order #%s was cancelled.', new.order_number),
        jsonb_build_object('orderId', new.id),
        'normal', 'order_status_history', v_source_id
      );
    end loop;
  end if;

  return new;
end;
$$;

create trigger orders_notify_on_status_change
  after update on orders
  for each row execute function notify_on_order_status_change();

comment on function notify_on_order_status_change is 'A second, independent AFTER UPDATE trigger on orders alongside the existing orders_log_status_change (untouched) — Postgres runs both per statement. See the v_source_id comment for why the dedupe key is a hash, not a real row id.';

-- =======================================================================
-- delivery_events: everything from rider assignment onward. One
-- trigger, one CASE per event_type, each branch fans out to whichever
-- of customer/rider/store/admin actually cares (section 37's matrix,
-- reviewed against this app's real lifecycle rather than followed
-- literally — see docs/notification-events.md).
-- =======================================================================

create or replace function notify_on_delivery_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_store_name text;
  v_rider_profile_id uuid;
  v_rider_name text;
  v_staff_id uuid;
  v_admin_id uuid;
begin
  select * into v_order from orders where id = new.order_id;
  if v_order.id is null then
    return new;
  end if;

  if new.rider_id is not null then
    select r.profile_id, p.full_name into v_rider_profile_id, v_rider_name
    from riders r join profiles p on p.id = r.profile_id
    where r.id = new.rider_id;
  end if;

  case new.event_type
    when 'delivery_assigned' then
      select name into v_store_name from stores where id = new.store_id;

      perform create_notification(
        v_order.user_id, 'rider_assigned', 'delivery', 'Rider assigned',
        format('%s has been assigned to deliver order #%s.', coalesce(v_rider_name, 'A rider'), v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );

      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_assigned', 'delivery', 'New delivery',
          format('Order #%s — pickup at %s.', v_order.order_number, coalesce(v_store_name, 'the store')),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'high', 'delivery_events', new.id
        );
      end if;

      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'rider_assigned', 'delivery', 'Rider assigned',
          format('%s will pick up order #%s.', coalesce(v_rider_name, 'A rider'), v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'rider_at_store' then
      perform create_notification(
        v_order.user_id, 'rider_at_store', 'delivery', 'Rider at the store',
        format('Your rider has arrived at the store for order #%s.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'rider_at_store', 'delivery', 'Rider arrived',
          format('%s has arrived for order #%s.', coalesce(v_rider_name, 'The rider'), v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_picked_up' then
      perform create_notification(
        v_order.user_id, 'order_picked_up', 'delivery', 'Order picked up',
        format('Your order #%s has been picked up.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'order_picked_up', 'order', 'Order picked up',
          format('Order #%s has been picked up by the rider.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_started' then
      perform create_notification(
        v_order.user_id, 'order_out_for_delivery', 'delivery', 'Out for delivery',
        format('Order #%s is on its way to you. Track it live.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );

    when 'delivery_completed' then
      perform create_notification(
        v_order.user_id, 'order_delivered', 'order', 'Delivered',
        format('Order #%s has been delivered. Enjoy!', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'normal', 'delivery_events', new.id
      );
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'order_delivered', 'order', 'Order delivered',
          format('Order #%s was delivered successfully.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'low', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_failed' then
      perform create_notification(
        v_order.user_id, 'delivery_failed', 'delivery', 'Delivery issue',
        format('We couldn''t deliver order #%s. Our team will reach out shortly.', v_order.order_number),
        jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
        'high', 'delivery_events', new.id
      );
      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_exception', 'delivery', 'Delivery marked failed',
          format('Order #%s was recorded as a failed delivery.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end if;
      for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
        perform create_notification(
          v_staff_id, 'delivery_failed', 'system', 'Delivery issue',
          format('Delivery failed for order #%s.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'high', 'delivery_events', new.id
        );
      end loop;
      for v_admin_id in select admin_recipient_ids() loop
        perform create_notification(
          v_admin_id, 'admin_failed_delivery', 'system', 'Failed delivery',
          format('Order #%s failed delivery.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'urgent', 'delivery_events', new.id
        );
      end loop;

    when 'delivery_expired', 'delivery_cancelled' then
      -- Section 24: the PREVIOUS rider learns their delivery moved on.
      -- The customer isn't notified here — nothing about their order
      -- changed yet from their perspective; they'll get rider_assigned
      -- again once a new rider picks it up. The NEW rider's own
      -- DELIVERY_ASSIGNED notification comes from that fresh
      -- 'delivery_assigned' row when reassignment actually happens —
      -- a completely separate insert this trigger doesn't need to
      -- orchestrate.
      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_reassigned', 'delivery', 'Delivery reassigned',
          format('Order #%s has been reassigned to another rider.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end if;

    else
      -- delivery_accepted, delivery_declined: operational detail with
      -- no distinct audience to notify (the rider who accepted/
      -- declined already knows; the store's own "rider assigned"
      -- notification already covers the acceptance path adequately
      -- for this phase's scope).
      null;
  end case;

  return new;
end;
$$;

create trigger delivery_events_notify
  after insert on delivery_events
  for each row execute function notify_on_delivery_event();

comment on function notify_on_delivery_event is 'The delivery-lifecycle half of the event-to-notification matrix (section 37, reviewed against this app''s real state machine — docs/notification-events.md has the full reasoning per branch, including why a few spec-listed types like a standalone rider CUSTOMER_UNAVAILABLE were deliberately not given their own trigger).';

-- =======================================================================
-- DELIVERY_ARRIVING (section 47): the one notification this phase
-- lets a client trigger directly, because the triggering CONDITION —
-- ETA crossing the "arriving soon" threshold — genuinely lives
-- client-side (Phase 09's useLiveRoute/formatEta, computed from a
-- keyless routing provider with no server-side equivalent). The
-- DECISION/DEDUP/SEND still goes through create_notification() like
-- every other path, so this isn't "notification code in the UI" —
-- it's the one case where the event signal itself originates in the
-- UI layer, made safe by re-deriving everything else server-side and
-- deduping on the delivery_assignments row (stable per delivery, so a
-- chatty client calling this on every ETA recompute still produces at
-- most one notification).
-- =======================================================================

create or replace function notify_arriving_soon(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_assignment delivery_assignments%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order.id is null or v_order.user_id is distinct from auth.uid() then
    raise exception 'not authorized to notify for this order';
  end if;

  select * into v_assignment from delivery_assignments
    where order_id = p_order_id and status = 'in_transit'
    order by assigned_at desc
    limit 1;
  if v_assignment.id is null then
    return; -- stale/late client call outside the real in-transit window — ignore, don't error
  end if;

  perform create_notification(
    v_order.user_id, 'delivery_arriving', 'delivery', 'Arriving soon',
    format('Order #%s is arriving soon.', v_order.order_number),
    jsonb_build_object('orderId', v_order.id, 'deliveryId', v_assignment.id),
    'normal', 'delivery_assignments', v_assignment.id
  );
end;
$$;

comment on function notify_arriving_soon is 'Called once by app/track/[orderId].tsx when its own useLiveRoute ETA first crosses the arriving-soon threshold. Re-derives the order/assignment server-side and dedupes on delivery_assignments.id — a client bug calling this repeatedly still sends exactly one notification (section 47).';

revoke all on function notify_arriving_soon from public, anon;
grant execute on function notify_arriving_soon to authenticated;
