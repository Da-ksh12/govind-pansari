-- Rider "New Delivery" background/lock-screen alert hardening.
--
-- The push notification's title+body are the ONLY thing a rider sees
-- when the alert lands on a locked screen — unlike the in-app
-- NewDeliveryPrompt, there's no follow-up fetch of the full assignment
-- before they decide whether to act. The body previously only said
-- "Order #GP1234 — pickup at <store>." with no sense of the job's size
-- (item count, payout-relevant amount) until the rider opened the app.
-- Adds those two real, already-available numbers (order_items.quantity
-- sum, orders.total) — never invented, and deliberately still no
-- customer name/address/phone (see docs/notification-security.md).
--
-- Full function reproduced (Postgres requires the whole body for
-- create or replace); every branch except delivery_assigned's rider
-- notification is byte-for-byte unchanged from 20260826000036.
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
  v_item_count int;
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
        select coalesce(sum(quantity), 0)::int into v_item_count from order_items where order_id = v_order.id;

        perform create_notification(
          v_rider_profile_id, 'delivery_assigned', 'delivery', 'New Delivery',
          format('Order #%s • %s item%s • %s — pickup at %s.',
            v_order.order_number, v_item_count, case when v_item_count = 1 then '' else 's' end,
            fmt_inr(v_order.total), coalesce(v_store_name, 'the store')),
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
      if v_rider_profile_id is not null then
        perform create_notification(
          v_rider_profile_id, 'delivery_reassigned', 'delivery', 'Delivery reassigned',
          format('Order #%s has been reassigned to another rider.', v_order.order_number),
          jsonb_build_object('orderId', v_order.id, 'deliveryId', new.delivery_id),
          'normal', 'delivery_events', new.id
        );
      end if;

    else
      null;
  end case;

  return new;
end;
$$;

comment on function notify_on_delivery_event is 'The delivery-lifecycle half of the event-to-notification matrix (section 37, reviewed against this app''s real state machine — docs/notification-events.md has the full reasoning per branch). delivery_assigned''s rider notification body includes real item count + order total (20260826000090) — never customer name/address/phone, see docs/notification-security.md.';
